import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { COST_EXPIRY_LEAD_DAYS_DEFAULT, COST_EXPIRY_LEAD_DAYS_TOGGLE, COST_PLUS_TOGGLE } from '../../data/costs'
import { CpqCostExpiryWarning, CpqQuoteConfiguration, CpqQuoteLineCost } from '../../data/entities'
import { emitCpqEvent } from '../../events'
import { COST_EXPIRY_NOTIFICATION, notificationTypes } from '../../notifications'
import { notifyCostManagers, type CostNotificationService } from '../../lib/costNotifications'
import { loadCostNotificationNames } from '../../lib/costNotificationContext'
import type { TenantScope } from '../types'
import { COST_CLOSED_STATUSES } from './costLock'
import { liveQuoteConfigurationIds } from './costRequestQueue'
import { findQuoteOrder } from './quoteOrderLookup'

/** Body of the warning once the cost is already past its validity (the type's own body says "expires in N days"). */
const EXPIRED_COST_BODY = { bodyKey: 'cpq.notifications.costExpiring.bodyExpired' } as const

/**
 * Supplier cost expiry warnings (index-costs spec, Q2 / Q3 / Q5 / Q14 / Q15). One scan per organization:
 *
 * - Candidates (Q3): confirmed price-basis cost lines with a `valid_until` on or before `today + leadDays` (already expired
 *   ones included, Q5), not deleted, on a live quote that is not rejected / cancelled (`COST_CLOSED_STATUSES`; `accepted` is
 *   in) and has no order. The scan is tenant-scoped and keyset-paged (`BATCH_SIZE`), served by the partial candidate index.
 * - Dedupe: the ledger row (unique `(cost line, valid_until)`), inserted with `ON CONFLICT DO NOTHING ... RETURNING`; only
 *   the rows this run actually inserted are emitted, so a concurrent or repeated run never warns twice.
 * - Delivery (Q15): the ledger row commits first, then the non-broadcast `cpq.quote.cost_expiring` event goes out and the
 *   cost managers are notified, then `emitted_at` is stamped. A row left un-stamped for `STALE_MINUTES` is re-emitted by the
 *   next run (duplicates only after a crash between emit and stamp; consumers dedupe on `warningId`).
 *
 * Neither the event nor the notification carries an amount or a supplier. The cost line is never written.
 */

export const COST_EXPIRY_BATCH_SIZE = 200
export const COST_EXPIRY_STALE_MINUTES = 10

type Emit = (eventId: string, payload: Record<string, unknown>, options?: { persistent?: boolean }) => Promise<unknown> | unknown

type Dependencies = {
  em: EntityManager
  featureTogglesService: Pick<FeatureTogglesService, 'getBoolConfig' | 'getNumberConfig'>
  emit?: Emit
  /** Notifications are an optional peer: absent = events only. */
  notify?: { notificationService: CostNotificationService; rbacService: Pick<RbacService, 'userHasAllFeatures'> } | null
  batchSize?: number
}

export type CostExpiryRunInput = {
  scope: TenantScope
  /** UTC calendar date `YYYY-MM-DD` of the run (tests and the CLI pass a fixed one). */
  today: string
  /** N; defaults to the tenant's `cpq.cost_expiry_lead_days` toggle. */
  leadDays?: number
  /** Count what would be warned; write and emit nothing. */
  dryRun?: boolean
  now?: Date
}

export type CostExpiryRunResult = {
  /** New ledger rows (dry run: rows that would be created). */
  inserted: number
  /** Stale un-emitted rows delivered again. */
  reEmitted: number
  /** `true` when the cost-plus toggle is off for the tenant (nothing was done). */
  disabled?: true
}

type WarningRow = {
  id: string; organizationId: string; tenantId: string; quoteLineCostId: string; quoteId: string; quoteLineId: string
  validUntil: string; leadDays: number; expired: boolean
}

const DAY_MS = 86_400_000
const parseDay = (day: string) => Date.parse(`${day}T00:00:00Z`)
export const addDays = (day: string, days: number): string => new Date(parseDay(day) + days * DAY_MS).toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string): number => Math.round((parseDay(to) - parseDay(from)) / DAY_MS)
const dayOf = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10)

export class CpqCostExpiryService {
  constructor(private readonly deps: Dependencies) {}

  async leadDays(tenantId: string): Promise<number> {
    const flag = await this.deps.featureTogglesService.getNumberConfig(COST_EXPIRY_LEAD_DAYS_TOGGLE, tenantId).catch(() => null)
    const value = flag && flag.ok ? Number(flag.value) : NaN
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : COST_EXPIRY_LEAD_DAYS_DEFAULT
  }

  async run(input: CostExpiryRunInput): Promise<CostExpiryRunResult> {
    const { scope, today } = input
    const flag = await this.deps.featureTogglesService.getBoolConfig(COST_PLUS_TOGGLE, scope.tenantId).catch(() => null)
    if (!flag || !flag.ok || flag.value !== true) return { inserted: 0, reEmitted: 0, disabled: true }
    const leadDays = input.leadDays ?? await this.leadDays(scope.tenantId)
    const now = input.now ?? new Date()
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const ctx = { em, scope, today, leadDays, now, names: new Map<string, { quoteNumber: string }>() }

    // Stale rows first: rows inserted below are fresh and must not be picked up as stale in the same run.
    const reEmitted = input.dryRun ? 0 : await this.reEmitStale(ctx)
    let inserted = 0
    let cursor: { validUntil: string; id: string } | null = null
    const batchSize = this.deps.batchSize ?? COST_EXPIRY_BATCH_SIZE
    for (;;) {
      const batch: CpqQuoteLineCost[] = await em.find(CpqQuoteLineCost, this.candidateFilter(ctx, cursor), {
        orderBy: [{ validUntil: 'asc' }, { id: 'asc' }], limit: batchSize,
      })
      if (batch.length === 0) break
      const last = batch[batch.length - 1]
      cursor = { validUntil: dayOf(last.validUntil), id: last.id }
      inserted += await this.warnBatch(ctx, batch, input.dryRun === true)
      if (batch.length < batchSize) break
    }
    return { inserted, reEmitted }
  }

  /** Q3 scope as one tenant-scoped filter; quote status / liveness is a semi-join, the order check is per quote below. */
  private candidateFilter(ctx: { em: EntityManager; scope: TenantScope; today: string; leadDays: number }, cursor: { validUntil: string; id: string } | null): FilterQuery<CpqQuoteLineCost> {
    const { scope } = ctx
    const filter: FilterQuery<CpqQuoteLineCost> = {
      organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
      role: 'price_basis', valueStatus: 'confirmed',
      validUntil: { $ne: null, $lte: addDays(ctx.today, ctx.leadDays) },
      quoteConfigurationId: { $in: liveQuoteConfigurationIds(ctx.em, scope, { cpqStatus: { $nin: [...COST_CLOSED_STATUSES] } }) },
    }
    if (!cursor) return filter
    return { $and: [filter, { $or: [{ validUntil: { $gt: cursor.validUntil } }, { validUntil: cursor.validUntil, id: { $gt: cursor.id } }] }] }
  }

  private async warnBatch(ctx: RunContext, batch: CpqQuoteLineCost[], dryRun: boolean): Promise<number> {
    const { em, scope } = ctx
    const existing = await em.find(CpqCostExpiryWarning, {
      organizationId: scope.organizationId, tenantId: scope.tenantId, quoteLineCostId: { $in: batch.map((line) => line.id) },
    })
    const warned = new Set(existing.map((row) => `${row.quoteLineCostId}|${dayOf(row.validUntil)}`))
    const fresh = batch.filter((line) => !warned.has(`${line.id}|${dayOf(line.validUntil)}`))
    // Converted quotes (an order exists) are out of scope; one check per quote with something to warn.
    const converted = new Map<string, boolean>()
    const candidates: CpqQuoteLineCost[] = []
    for (const line of fresh) {
      if (!converted.has(line.quoteConfigurationId)) {
        converted.set(line.quoteConfigurationId, !!(await findQuoteOrder(em, { id: line.quoteConfigurationId } as Pick<CpqQuoteConfiguration, 'id'>, scope)))
      }
      if (!converted.get(line.quoteConfigurationId)) candidates.push(line)
    }
    if (candidates.length === 0 || dryRun) return candidates.length

    const createdAt = ctx.now
    const rows = candidates.map((line) => ({
      organization_id: scope.organizationId, tenant_id: scope.tenantId, quote_line_cost_id: line.id, quote_id: line.quoteConfigurationId,
      quote_line_id: line.quoteLineId, valid_until: dayOf(line.validUntil), lead_days: ctx.leadDays,
      expired: dayOf(line.validUntil) < ctx.today, created_at: createdAt,
    }))
    const inserted = await em.getKysely<any>().insertInto('cpq_cost_expiry_warnings').values(rows)
      .onConflict((conflict: any) => conflict.columns(['quote_line_cost_id', 'valid_until']).doNothing())
      .returning(['id', 'quote_line_cost_id']).execute() as Array<{ id: string; quote_line_cost_id: string }>
    // One candidate per cost line in a batch (a line has one valid_until), so the cost line id identifies the inserted row.
    const lineById = new Map(candidates.map((line) => [line.id, line]))
    const toDeliver: Array<{ warning: WarningRow; line: CpqQuoteLineCost }> = []
    for (const row of inserted) {
      const line = lineById.get(row.quote_line_cost_id)
      if (!line) continue
      toDeliver.push({ line, warning: {
        id: row.id, organizationId: scope.organizationId, tenantId: scope.tenantId, quoteLineCostId: line.id, quoteId: line.quoteConfigurationId,
        quoteLineId: line.quoteLineId, validUntil: dayOf(line.validUntil), leadDays: ctx.leadDays, expired: dayOf(line.validUntil) < ctx.today,
      } })
    }
    await this.deliver(ctx, toDeliver)
    return inserted.length
  }

  /** Q15: rows committed but never stamped (crash between emit and stamp, or a failed delivery) are delivered again. */
  private async reEmitStale(ctx: RunContext): Promise<number> {
    const { em, scope } = ctx
    const cutoff = new Date(ctx.now.getTime() - COST_EXPIRY_STALE_MINUTES * 60_000)
    const stale = await em.find(CpqCostExpiryWarning, {
      organizationId: scope.organizationId, tenantId: scope.tenantId, emittedAt: null, createdAt: { $lt: cutoff },
    }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], limit: this.deps.batchSize ?? COST_EXPIRY_BATCH_SIZE })
    if (stale.length === 0) return 0
    const lines = await em.find(CpqQuoteLineCost, { organizationId: scope.organizationId, tenantId: scope.tenantId, id: { $in: stale.map((row) => row.quoteLineCostId) } })
    const lineById = new Map(lines.map((line) => [line.id, line]))
    const deliverable: Array<{ warning: WarningRow; line: CpqQuoteLineCost }> = []
    const orphaned: string[] = []
    for (const row of stale) {
      const line = lineById.get(row.quoteLineCostId)
      // The cost line is gone (hard-deleted or soft-deleted): nothing left to warn about, close the row.
      if (!line || line.deletedAt) orphaned.push(row.id)
      else deliverable.push({ line, warning: { ...row, validUntil: dayOf(row.validUntil) } })
    }
    if (orphaned.length > 0) await this.stamp(ctx, orphaned)
    return this.deliver(ctx, deliverable)
  }

  /** Emits, notifies, then stamps `emitted_at`; a failure leaves the row un-stamped for the next run. Returns the rows delivered. */
  private async deliver(ctx: RunContext, items: Array<{ warning: WarningRow; line: CpqQuoteLineCost }>): Promise<number> {
    const delivered: string[] = []
    for (const { warning, line } of items) {
      try {
        await this.emitWarning(ctx, warning, line)
        await this.notifyWarning(ctx, warning, line)
        delivered.push(warning.id)
      } catch (error) {
        console.error(`[cpq] cost expiry warning ${warning.id} not delivered, left for the next run`, error)
      }
    }
    if (delivered.length > 0) await this.stamp(ctx, delivered)
    return delivered.length
  }

  private async stamp(ctx: RunContext, ids: string[]): Promise<void> {
    await ctx.em.getKysely<any>().updateTable('cpq_cost_expiry_warnings')
      .set({ emitted_at: ctx.now })
      .where('organization_id', '=', ctx.scope.organizationId).where('tenant_id', '=', ctx.scope.tenantId).where('id', 'in', ids)
      .execute()
  }

  private async emitWarning(ctx: RunContext, warning: WarningRow, line: CpqQuoteLineCost): Promise<void> {
    const emit: Emit = this.deps.emit ?? (emitCpqEvent as unknown as Emit)
    await emit('cpq.quote.cost_expiring', {
      tenantId: warning.tenantId, organizationId: warning.organizationId, warningId: warning.id, quoteId: warning.quoteId,
      quoteLineId: warning.quoteLineId, costLineId: warning.quoteLineCostId, costKey: line.costKey, chargeCode: line.chargeCode,
      validUntil: warning.validUntil, daysLeft: daysBetween(ctx.today, warning.validUntil), expired: warning.expired,
      leadDays: warning.leadDays, occurredAt: ctx.now.toISOString(),
    }, { persistent: true })
  }

  private async notifyWarning(ctx: RunContext, warning: WarningRow, line: CpqQuoteLineCost): Promise<void> {
    const notify = this.deps.notify
    if (!notify) return
    const typeDef = notificationTypes.find((type) => type.type === COST_EXPIRY_NOTIFICATION.expiring)
    if (!typeDef) return
    let names = ctx.names.get(line.quoteId)
    if (!names) {
      names = await loadCostNotificationNames(ctx.em, ctx.scope, { salesQuoteId: line.quoteId })
      ctx.names.set(line.quoteId, names)
    }
    await notifyCostManagers({ tenantId: ctx.scope.tenantId }, ctx.scope.organizationId, {
      typeDef,
      bodyKey: warning.expired ? EXPIRED_COST_BODY.bodyKey : typeDef.bodyKey,
      titleVariables: { quoteNumber: names.quoteNumber },
      bodyVariables: { costName: line.name, validUntil: warning.validUntil },
      linkHref: `/backend/cpq/quotes/${encodeURIComponent(warning.quoteId)}#costs`,
      sourceEntityType: 'cpq:cpq_quote_line_cost',
      sourceEntityId: warning.quoteId,
      groupKey: `${COST_EXPIRY_NOTIFICATION.expiring}:${warning.quoteLineCostId}:${warning.validUntil}`,
      data: { quoteId: warning.quoteId, costLineId: warning.quoteLineCostId, validUntil: warning.validUntil, expired: String(warning.expired) },
    }, { em: ctx.em as never, notificationService: notify.notificationService, rbacService: notify.rbacService })
  }
}

type RunContext = {
  em: EntityManager; scope: TenantScope; today: string; leadDays: number; now: Date; names: Map<string, { quoteNumber: string }>
}
