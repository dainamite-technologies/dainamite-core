import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import {
  emitCrudSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { randomUUID } from 'node:crypto'
import { BillingAccount, BillingItem, BillingItemStatusPeriod } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import { findBySourceRef } from '../lib/idempotency'
import { getBillingSettings, taxRateColumn } from '../lib/billingSettings'
import { planPriceChange } from '../lib/itemPriceChange'
import { assertItemDates } from '../lib/itemDates'
import { previewCredit } from '../lib/creditPreview'
import { toCreditReason, type CreditReason, type CreditReasonInput } from '../lib/creditReason'
import {
  BILLING_PERIOD_CHANGE_BILLED,
  PHASE_EDIT_BILLED,
  PHASES_RECURRING_ONLY,
  phaseEditTouchesBilled,
  remainingPhasesFrom,
  resolvePhases,
  validatePhaseSchedule,
  type PhaseDefinition,
} from '../lib/pricePhases'
import { createPhaseRows, itemResolvedPhases, loadPhasesByItem, loadStatusPeriodsByItem, phaseRowToDefinition } from '../lib/itemSchedules'
import { toIsoDate } from '../lib/dateOnly'
import {
  billingItemBulkCreateSchema,
  billingItemChangePriceSchema,
  type BillingItemChangePriceInput,
  billingItemCreateSchema,
  billingItemDeleteSchema,
  billingItemUpdateSchema,
  billingPeriodIssue,
  BILLING_PERIOD_CHANGE_BILLED_MESSAGE,
  CHARGE_TIMING_RECURRING_ONLY_MESSAGE,
  LINE_PERIOD_RECURRING_ONLY_MESSAGE,
  GROSS_TIERED_UNSUPPORTED_MESSAGE,
  isTieredRate,
  validateRateJson,
  type BillingItemBulkCreateInput,
  type BillingItemCreateInput,
  type BillingItemDeleteInput,
  type BillingItemUpdateInput,
} from '../data/validators'

/**
 * BillingItem writes — create / update / soft-delete.
 *
 * Create is idempotent via `source_ref`: if the integrator POSTs the
 * same `(tenant_id, bill_account_id, source_ref)` twice, the second
 * call returns the existing item with `deduplicated: true`. The
 * underlying unique index is the correctness gate; this pre-check keeps
 * the happy path single-round-trip and the response body informative.
 */

export const CREDIT_REASON_REQUIRED = 'billing.item.credit_reason_required'

/**
 * Part 2 (D9): when ending `item` on `newEndDate` credits already-billed days,
 * a reason is required; returns it (to store on the item) or null when the
 * change credits nothing (a sent reason is then ignored).
 */
function requireCreditReason(
  item: Pick<BillingItem, 'type' | 'prorate' | 'billStartDate' | 'billedToDate'>,
  newEndDate: Date | null,
  input: CreditReasonInput,
): CreditReason | null {
  const preview = previewCredit(item, newEndDate)
  if (!preview.credited) return null
  const reason = toCreditReason(input)
  if (!reason) {
    throw new CrudHttpError(422, {
      error: 'This change credits days already billed — give a reason to show on the invoice',
      code: CREDIT_REASON_REQUIRED,
    })
  }
  return reason
}

/** Own period columns from a create / bulk payload (null = follow the account). */
function periodColumns(input: { billingPeriodUnit?: string | null; billingPeriodInterval?: number | null }) {
  return input.billingPeriodUnit
    ? {
        billingPeriodUnit: input.billingPeriodUnit as NonNullable<BillingItem['billingPeriodUnit']>,
        billingPeriodInterval: input.billingPeriodInterval ?? 1,
      }
    : { billingPeriodUnit: null, billingPeriodInterval: null }
}

/**
 * Phases of a create / bulk payload: the switch defaults to ON when phases
 * are sent without it (contract C1: the connector sends both anyway).
 */
function phasesFromInput(input: { phasesEnabled?: boolean; phases?: PhaseDefinition[] }): {
  enabled: boolean
  phases: PhaseDefinition[]
} {
  const phases = input.phases ?? []
  return { enabled: input.phasesEnabled ?? phases.length > 0, phases }
}

function invalid(message: string, code: string): CrudHttpError {
  return new CrudHttpError(422, { error: message, code })
}

const itemIndexer = { entityType: billingEntityIds.item } as const
const itemEvents = { module: 'billing', entity: 'item', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

async function assertAccountInScope(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; billAccountId: string },
): Promise<BillingAccount> {
  const account = await em.findOne(BillingAccount, {
    id: params.billAccountId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (!account) {
    throw new CrudHttpError(404, { error: 'Billing account not found' })
  }
  return account
}

// ─── Create (idempotent) ─────────────────────────────────────────

const createItemCommand: CommandHandler<
  BillingItemCreateInput,
  { id: string; deduplicated: boolean }
> = {
  id: 'billing.items.create',

  async execute(rawInput, ctx) {
    const parsed = billingItemCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const account = await assertAccountInScope(em, parsed)

    // Idempotency: if `source_ref` provided and matches an existing
    // (non-deleted) row, return that row. The unique index is the
    // final correctness gate — this is the happy-path early return.
    if (parsed.sourceRef) {
      const existing = await findBySourceRef(em, BillingItem, {
        tenantId: parsed.tenantId,
        billAccountId: parsed.billAccountId,
        sourceRef: parsed.sourceRef,
      })
      if (existing) {
        return { id: existing.id, deduplicated: true }
      }
    }

    // Re-validate the rate_json shape against the resolved type to
    // future-proof against schema drift between the API surface and
    // the persistence layer.
    validateRateJson(parsed.type, parsed.rateJson)
    assertItemDates(parsed.billStartDate, parsed.billEndDate)

    // Spec B (B-D1): an omitted rate takes the org default, stored on the item.
    const taxRate =
      parsed.taxRate !== undefined
        ? taxRateColumn(parsed.taxRate)
        : (await getBillingSettings(em, parsed)).defaultTaxRate

    const now = new Date()
    const schedule = phasesFromInput(parsed)
    const entity = em.create(BillingItem, {
      // Assigned here so the item and its phases go in one flush.
      id: randomUUID(),
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      billAccountId: account.id,
      type: parsed.type,
      billStartDate: parsed.billStartDate,
      billEndDate: parsed.billEndDate ?? null,
      description: parsed.description,
      rateJson: parsed.rateJson as Record<string, unknown>,
      uomCode: parsed.uomCode ?? null,
      subscriptionId: parsed.subscriptionId ?? null,
      subscriptionItemId: parsed.subscriptionItemId ?? null,
      sourceRef: parsed.sourceRef ?? null,
      // Spec A defaults: bill in advance, prorate partial periods.
      chargeTiming: parsed.chargeTiming ?? 'in_advance',
      prorate: parsed.prorate ?? true,
      taxRate,
      priceBasis: parsed.priceBasis ?? 'net',
      ...periodColumns(parsed),
      phasesEnabled: schedule.enabled,
      // `currency_mismatch` is set by Phase 2 / connectors when the
      // posted value's currency differs from the account's. Stays
      // false on create (operator opts in to flagging).
      currencyMismatch: false,
      // `billed_to_date` is set by the Bill Run engine on the first
      // real-run that emits this item. Always null on create.
      billedToDate: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(entity)
    createPhaseRows(em, entity, schedule.phases, now)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'created',
      entity,
      identifiers: {
        id: entity.id,
        tenantId: entity.tenantId,
        organizationId: entity.organizationId,
      },
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: entity.id, deduplicated: false }
  },
}

// ─── Update ──────────────────────────────────────────────────────

const updateItemCommand: CommandHandler<BillingItemUpdateInput, { id: string }> = {
  id: 'billing.items.update',

  async execute(rawInput, ctx) {
    const parsed = billingItemUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const record = await em.findOne(BillingItem, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing item not found' })
    }
    // Every read happens before the first mutation (no withAtomicFlush needed).
    const touchesSchedule =
      parsed.phases !== undefined || parsed.phasesEnabled !== undefined || parsed.billStartDate !== undefined
    const currentPhaseRows = touchesSchedule
      ? ((await loadPhasesByItem(em, parsed, [record.id])).get(record.id) ?? [])
      : []
    const scheduleBefore = itemResolvedPhases(record, currentPhaseRows)

    const previousEnd = record.billEndDate ? new Date(record.billEndDate).getTime() : null
    if (parsed.billStartDate !== undefined) record.billStartDate = parsed.billStartDate
    if (parsed.billEndDate !== undefined) record.billEndDate = parsed.billEndDate
    assertItemDates(record.billStartDate, record.billEndDate)
    const nextEnd = record.billEndDate ? new Date(record.billEndDate).getTime() : null
    if (nextEnd !== previousEnd) {
      // Part 2 (D9): moving the end date into the billed window credits days —
      // the customer-facing reason is then required.
      // Always overwrite: a later change that credits nothing must not leave a
      // stale reason behind for a future credit line.
      record.creditReason = requireCreditReason(record, record.billEndDate ?? null, parsed)
    }
    if (parsed.description !== undefined) record.description = parsed.description
    if (parsed.rateJson !== undefined) {
      // Re-validate against the current (immutable) type before persist.
      validateRateJson(record.type as 'one_time' | 'recurring' | 'usage', parsed.rateJson)
      record.rateJson = parsed.rateJson as Record<string, unknown>
    }
    if (parsed.uomCode !== undefined) record.uomCode = parsed.uomCode
    if (parsed.subscriptionId !== undefined) record.subscriptionId = parsed.subscriptionId
    if (parsed.subscriptionItemId !== undefined) {
      record.subscriptionItemId = parsed.subscriptionItemId
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    if (parsed.taxRate !== undefined) record.taxRate = taxRateColumn(parsed.taxRate)
    if (parsed.chargeTiming !== undefined || parsed.prorate !== undefined) {
      // Timing / proration only apply to recurring items (validators can't
      // check this on update — the item type isn't in the payload).
      const nonDefault =
        (parsed.chargeTiming !== undefined && parsed.chargeTiming !== 'in_advance') ||
        parsed.prorate === false
      if (record.type !== 'recurring' && nonDefault) {
        throw new CrudHttpError(400, {
          error: CHARGE_TIMING_RECURRING_ONLY_MESSAGE,
          code: 'billing.item.charge_timing_recurring_only',
        })
      }
      if (parsed.chargeTiming !== undefined) record.chargeTiming = parsed.chargeTiming
      if (parsed.prorate !== undefined) record.prorate = parsed.prorate
    }

    if (parsed.priceBasis !== undefined) record.priceBasis = parsed.priceBasis

    // ── Own billing period (L §4.2) ──
    if (parsed.billingPeriodUnit !== undefined || parsed.billingPeriodInterval !== undefined) {
      const unit = parsed.billingPeriodUnit !== undefined ? parsed.billingPeriodUnit : (record.billingPeriodUnit ?? null)
      const interval =
        parsed.billingPeriodInterval !== undefined
          ? parsed.billingPeriodInterval
          : unit
            ? (record.billingPeriodInterval ?? 1)
            : null
      if (unit && record.type !== 'recurring') {
        throw invalid(LINE_PERIOD_RECURRING_ONLY_MESSAGE, 'billing.item.billing_period_recurring_only')
      }
      const issue = billingPeriodIssue(unit, unit ? interval : null)
      if (issue) throw invalid(issue.message, 'billing.item.billing_period_invalid')
      const nextInterval = unit ? interval : null
      const changed = (unit ?? null) !== (record.billingPeriodUnit ?? null) || nextInterval !== (record.billingPeriodInterval ?? null)
      if (changed && record.billedToDate) throw invalid(BILLING_PERIOD_CHANGE_BILLED_MESSAGE, BILLING_PERIOD_CHANGE_BILLED)
      record.billingPeriodUnit = (unit ?? null) as BillingItem['billingPeriodUnit']
      record.billingPeriodInterval = unit ? interval : null
    }

    // ── Price phases (P §4.1): only periods not yet invoiced are editable ──
    let replacementPhases: PhaseDefinition[] | null = null
    if (touchesSchedule) {
      const enabled = parsed.phasesEnabled ?? record.phasesEnabled
      const definitions = parsed.phases ?? currentPhaseRows.map(phaseRowToDefinition)
      if ((enabled || (parsed.phases?.length ?? 0) > 0) && record.type !== 'recurring') {
        throw invalid(LINE_PERIOD_RECURRING_ONLY_MESSAGE, PHASES_RECURRING_ONLY)
      }
      const issue = validatePhaseSchedule(record.billStartDate, definitions)
      if (issue) throw invalid(issue.message, 'billing.item.phases_invalid')
      const scheduleAfter = enabled ? resolvePhases(record.billStartDate, definitions) : []
      const regular = (record.rateJson as { unit_price?: number } | null)?.unit_price ?? 0
      const firstDay = toIsoDate(
        Math.min(new Date(record.billStartDate).getTime(), scheduleBefore[0]?.start.getTime() ?? Infinity),
      )
      if (phaseEditTouchesBilled(scheduleBefore, scheduleAfter, record.billedToDate ?? null, regular, regular, firstDay)) {
        throw new CrudHttpError(422, {
          error:
            'This change would re-price days that are already invoiced. Only periods not yet invoiced can change — issue a credit memo to correct an invoiced period.',
          code: PHASE_EDIT_BILLED,
        })
      }
      record.phasesEnabled = enabled
      if (parsed.phases !== undefined) replacementPhases = parsed.phases
    }
    if (replacementPhases) {
      const now = new Date()
      for (const row of currentPhaseRows) {
        row.deletedAt = now
        row.updatedAt = now
      }
      createPhaseRows(em, record, replacementPhases, now)
    }

    // Spec F (P-D4): tiered usage rates are always net — checked on the
    // resulting state, since either field may change alone.
    if (record.priceBasis === 'gross' && isTieredRate(record.rateJson)) {
      throw new CrudHttpError(422, {
        error: 'Tiered usage rates are always entered net',
        code: GROSS_TIERED_UNSUPPORTED_MESSAGE,
      })
    }

    record.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: record.id }
  },
}

// ─── Delete (soft) ───────────────────────────────────────────────

const deleteItemCommand: CommandHandler<BillingItemDeleteInput, { id: string }> = {
  id: 'billing.items.delete',

  async execute(rawInput, ctx) {
    const parsed = billingItemDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const id = requireId(parsed)

    const em = getEm(ctx)
    const record = await em.findOne(BillingItem, {
      id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing item not found' })
    }

    record.deletedAt = new Date()
    record.updatedAt = record.deletedAt
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: record.id }
  },
}

// ─── Bulk create (idempotent, batched) ───────────────────────────
//
// Collapses N `billing.items.create` round-trips into one command.
// The CPQ connector activating a large subscription is the primary
// caller — it used to fire one create per charge.
//
// Idempotency is still per-`source_ref` but the existence check is a
// SINGLE query over all source_refs in the batch, instead of one
// `findOne` per item. Inserts are one `em.flush()` for the whole
// batch. So a 200-charge activation goes from ~200 round-trips +
// 200 flushes to ~3 queries + 1 flush.

type BulkCreateResultEntry = {
  sourceRef: string | null
  id: string
  deduplicated: boolean
}

const bulkCreateItemsCommand: CommandHandler<
  BillingItemBulkCreateInput,
  { created: number; deduplicated: number; items: BulkCreateResultEntry[] }
> = {
  id: 'billing.items.bulk_create',

  async execute(rawInput, ctx) {
    const parsed = billingItemBulkCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)

    // Validate every referenced account exists + is in scope. One
    // `$in` query for the distinct account ids, not one per item.
    const accountIds = Array.from(new Set(parsed.items.map((i) => i.billAccountId)))
    const accounts = await em.find(BillingAccount, {
      id: { $in: accountIds },
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    } as never)
    const knownAccountIds = new Set(accounts.map((a) => a.id))
    const missingAccount = accountIds.find((id) => !knownAccountIds.has(id))
    if (missingAccount) {
      throw new CrudHttpError(404, {
        error: 'Billing account not found',
        billAccountId: missingAccount,
      })
    }

    // Batched idempotency check — one query over every source_ref in
    // the batch. `source_ref` is unique per `(tenant, bill_account,
    // source_ref)`, so we key the existing-set on that triple.
    const sourceRefs = parsed.items
      .map((i) => i.sourceRef)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
    const existingBySourceKey = new Map<string, string>()
    if (sourceRefs.length > 0) {
      const existing = await em.find(BillingItem, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        billAccountId: { $in: accountIds },
        sourceRef: { $in: Array.from(new Set(sourceRefs)) },
        deletedAt: null,
      } as never)
      for (const row of existing) {
        if (row.sourceRef) {
          existingBySourceKey.set(`${row.billAccountId}::${row.sourceRef}`, row.id)
        }
      }
    }

    const now = new Date()
    const results: BulkCreateResultEntry[] = []
    const createdEntities: BillingItem[] = []
    // Result entries whose `id` is only known after the flush — the
    // BillingItem PK is a DB-generated UUID, unassigned until then.
    // Covers freshly-created rows and in-batch dedup rows that point
    // at a sibling created earlier in the same payload.
    const deferredIdLinks: Array<{ result: BulkCreateResultEntry; entity: BillingItem }> = []

    // Track source_refs created within THIS batch so a payload that
    // repeats the same source_ref twice dedups against itself (the
    // unique index would otherwise blow up the whole flush).
    const seenInBatch = new Set<string>()

    // Spec B (B-D1): org default rate, read once and only when an entry omits it.
    const defaultTaxRate = parsed.items.some((entry) => entry.taxRate === undefined)
      ? (await getBillingSettings(em, parsed)).defaultTaxRate
      : '0'

    for (const entry of parsed.items) {
      const sourceKey = entry.sourceRef
        ? `${entry.billAccountId}::${entry.sourceRef}`
        : null

      if (sourceKey) {
        const existingId = existingBySourceKey.get(sourceKey)
        if (existingId) {
          results.push({ sourceRef: entry.sourceRef ?? null, id: existingId, deduplicated: true })
          continue
        }
        if (seenInBatch.has(sourceKey)) {
          // Duplicate source_ref inside the same payload — first wins,
          // the repeat is reported deduplicated against the first.
          const firstCreated = createdEntities.find(
            (e) => e.billAccountId === entry.billAccountId && e.sourceRef === entry.sourceRef,
          )
          const dedupResult: BulkCreateResultEntry = {
            sourceRef: entry.sourceRef ?? null,
            id: '',
            deduplicated: true,
          }
          results.push(dedupResult)
          if (firstCreated) deferredIdLinks.push({ result: dedupResult, entity: firstCreated })
          continue
        }
        seenInBatch.add(sourceKey)
      }

      validateRateJson(entry.type, entry.rateJson)
      assertItemDates(entry.billStartDate, entry.billEndDate)
      const schedule = phasesFromInput(entry)
      const item = em.create(BillingItem, {
        id: randomUUID(),
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        billAccountId: entry.billAccountId,
        type: entry.type,
        billStartDate: entry.billStartDate,
        billEndDate: entry.billEndDate ?? null,
        description: entry.description,
        rateJson: entry.rateJson as Record<string, unknown>,
        uomCode: entry.uomCode ?? null,
        subscriptionId: entry.subscriptionId ?? null,
        subscriptionItemId: entry.subscriptionItemId ?? null,
        sourceRef: entry.sourceRef ?? null,
        chargeTiming: entry.chargeTiming ?? 'in_advance',
        prorate: entry.prorate ?? true,
        taxRate: entry.taxRate !== undefined ? taxRateColumn(entry.taxRate) : defaultTaxRate,
        priceBasis: entry.priceBasis ?? 'net',
        ...periodColumns(entry),
        phasesEnabled: schedule.enabled,
        currencyMismatch: false,
        billedToDate: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(item)
      createPhaseRows(em, item, schedule.phases, now)
      createdEntities.push(item)
      const createdResult: BulkCreateResultEntry = {
        sourceRef: entry.sourceRef ?? null,
        id: '',
        deduplicated: false,
      }
      results.push(createdResult)
      deferredIdLinks.push({ result: createdResult, entity: item })
    }

    // Single flush for the whole batch.
    if (createdEntities.length > 0) {
      await em.flush()
    }

    // The BillingItem UUID PK is assigned by the flush — backfill it
    // into the result entries now that the value exists.
    for (const link of deferredIdLinks) {
      link.result.id = link.entity.id
    }

    // Side effects after the commit. Emitting per-entity keeps the
    // query-index + event contract identical to single-create — the
    // engine / search index can't tell a bulk insert from N singles.
    const dataEngine = getDataEngine(ctx)
    for (const item of createdEntities) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity: item,
        identifiers: {
          id: item.id,
          tenantId: item.tenantId,
          organizationId: item.organizationId,
        },
        indexer: itemIndexer,
        events: itemEvents,
      })
    }

    return {
      created: createdEntities.length,
      deduplicated: results.filter((r) => r.deduplicated).length,
      items: results,
    }
  },
}

// ─── Change price (recurring) ────────────────────────────────────
//
// Ends the item the day before `effectiveDate` and creates a copy with the
// new unit price from `effectiveDate` on — one transaction, so the account
// never has both items or neither. The copy keeps everything else (account,
// description, timing, proration, VAT rate, price basis, references, end
// date). No `source_ref` on the copy: it is the idempotency key of the
// integration that created the original. Not undoable (like the run
// commands): reverse it by editing the two items.

const changeItemPriceCommand: CommandHandler<
  BillingItemChangePriceInput,
  { previousItemId: string; newItemId: string }
> = {
  id: 'billing.items.change_price',

  async execute(rawInput, ctx) {
    const parsed = billingItemChangePriceSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const { previous, created } = await em.transactional(async (tem) => {
      const record = await tem.findOne(BillingItem, {
        id: parsed.id,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      })
      if (!record) throw new CrudHttpError(404, { error: 'Billing item not found' })
      // Reads first: phases and status periods carried to the copy.
      const scope = { tenantId: record.tenantId, organizationId: record.organizationId }
      const phaseRows = (await loadPhasesByItem(tem, scope, [record.id])).get(record.id) ?? []
      const statusRows = (await loadStatusPeriodsByItem(tem, scope, [record.id])).get(record.id) ?? []
      const planned = planPriceChange(record, parsed.effectiveDate)
      if (!planned.ok) {
        throw new CrudHttpError(422, { error: 'The price cannot be changed on this date', code: planned.error })
      }
      const { plan } = planned
      const now = new Date()
      record.creditReason = requireCreditReason(record, plan.oldItemEndDate, parsed)
      record.billEndDate = plan.oldItemEndDate
      record.updatedAt = now
      const copy = tem.create(BillingItem, {
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        billAccountId: record.billAccountId,
        type: record.type,
        billStartDate: plan.newItemStartDate,
        billEndDate: plan.newItemEndDate,
        description: record.description,
        rateJson: { ...(record.rateJson ?? {}), unit_price: parsed.unitPrice },
        uomCode: record.uomCode ?? null,
        subscriptionId: record.subscriptionId ?? null,
        subscriptionItemId: record.subscriptionItemId ?? null,
        sourceRef: null,
        chargeTiming: record.chargeTiming,
        prorate: record.prorate,
        taxRate: record.taxRate,
        priceBasis: record.priceBasis,
        billingPeriodUnit: record.billingPeriodUnit ?? null,
        billingPeriodInterval: record.billingPeriodInterval ?? null,
        // P §4.1: the copy keeps the remaining phases on their original dates.
        phasesEnabled: record.phasesEnabled,
        currencyMismatch: record.currencyMismatch,
        billedToDate: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        id: randomUUID(),
      })
      tem.persist(copy)
      if (record.phasesEnabled) {
        createPhaseRows(tem, copy, remainingPhasesFrom(itemResolvedPhases(record, phaseRows), plan.newItemStartDate), now)
      }
      // A running or future status (pause, suspension) continues on the copy.
      const startMs = plan.newItemStartDate.getTime()
      for (const row of statusRows) {
        if (row.toDate && new Date(row.toDate).getTime() < startMs) continue
        tem.persist(
          tem.create(BillingItemStatusPeriod, {
            id: randomUUID(),
            organizationId: row.organizationId,
            tenantId: row.tenantId,
            billingItemId: copy.id,
            status: row.status,
            fromDate: toIsoDate(Math.max(new Date(row.fromDate).getTime(), startMs)),
            toDate: row.toDate ? toIsoDate(row.toDate) : null,
            chargeBehavior: row.chargeBehavior,
            reason: row.reason ?? null,
            appliedFrom: null,
            appliedTo: null,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await tem.flush()
      return { previous: record, created: copy }
    })

    // Side effects after commit.
    const dataEngine = getDataEngine(ctx)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: previous,
      identifiers: { id: previous.id, tenantId: previous.tenantId, organizationId: previous.organizationId },
      indexer: itemIndexer,
      events: itemEvents,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: created,
      identifiers: { id: created.id, tenantId: created.tenantId, organizationId: created.organizationId },
      indexer: itemIndexer,
      events: itemEvents,
    })
    return { previousItemId: previous.id, newItemId: created.id }
  },
}

registerCommand(createItemCommand)
registerCommand(updateItemCommand)
registerCommand(deleteItemCommand)
registerCommand(bulkCreateItemsCommand)
registerCommand(changeItemPriceCommand)

export {
  createItemCommand,
  updateItemCommand,
  deleteItemCommand,
  bulkCreateItemsCommand,
  changeItemPriceCommand,
}
