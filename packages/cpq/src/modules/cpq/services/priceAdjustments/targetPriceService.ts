import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CpqQuoteConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { cpqPriceAdjustmentInputSchema, cpqTargetPriceInputSchema, type PriceAdjustment, type PriceAdjustmentInput, type TargetPriceInput } from '../../data/price-adjustments'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import type { QuoteResult, TenantScope } from '../types'
import { TargetPriceError, isOnTarget, planTargetWrite, rowsForTarget, type PriceTarget, type TargetWritePlan } from '../../lib/targetPrice'
import { adjustmentSnapshot, adjustmentsOverlap, snapshotKey, type AdjustmentSnapshot, type CpqAdjustmentService } from './adjustmentService'
import { loadQuoteAdjustments } from './loadQuoteAdjustments'

type Dependencies = {
  em: EntityManager
  quotingService: DefaultCpqQuotingService
  adjustmentService: CpqAdjustmentService
}

export interface TargetWriteResult {
  quoteId: string
  target: PriceTarget
  /** The target's rows before / after the write (unchanged rows appear in both). */
  before: AdjustmentSnapshot[]
  after: AdjustmentSnapshot[]
  quote: QuoteResult
}

export type TargetPreviewError = { adjustmentId: string; code: string; conflictsWith?: string }

/** A row the body wants on the target, with the id it keeps (or a new one). */
type PlannedRow = { id: string; input: PriceAdjustmentInput; kind: 'keep' | 'update' | 'create' }

interface TargetPlan {
  rows: TargetWritePlan<CpqQuotePriceAdjustment>
  planned: PlannedRow[]
  before: CpqQuotePriceAdjustment[]
  /** The quote's other active rows (other targets). */
  others: PriceAdjustment[]
  conflicts: TargetPreviewError[]
}

const byMonth = (a: { fromMonth?: number | null }, b: { fromMonth?: number | null }) => (a.fromMonth ?? 1) - (b.fromMonth ?? 1)

/**
 * One target's price in one write (UX feedback spec D4, §6.1 / §6.2 / §7):
 * every adjustment row of a target is replaced by the dialog's steps as one
 * undoable command. Rows that don't change keep their id, author and date.
 * The per-row POST / PATCH / DELETE stay in `adjustmentService`; this service
 * reuses its guards (toggle, quote lock, target, reason) so both paths apply
 * the same rules.
 */
export class CpqTargetPriceService {
  constructor(private readonly deps: Dependencies) {}

  /** The draft rows priced without a write or an event. Overlaps are reported, not thrown. */
  async previewTarget(quoteId: string, input: TargetPriceInput, scope: TenantScope): Promise<{ quote: QuoteResult; errors: TargetPreviewError[] }> {
    const parsed = cpqTargetPriceInputSchema.parse(input)
    const adjustments = this.deps.adjustmentService
    await adjustments.requireEnabled(scope)
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const scoped = { ...scope, deletedAt: null }
    const quote = await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, id: quoteId }, undefined, scope)
      ?? await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, quoteId }, undefined, scope)
    if (!quote) throw new QuotingError(404, 'Quote not found')
    if (parsed.expectedRevision !== undefined && parsed.expectedRevision !== (quote.pricingRevision ?? 0)) throw new QuotingError(409, 'STALE_REVISION')
    await adjustments.assertMutable(em, quote, scope)
    const plan = await this.plan(em, quote, parsed, scope)
    const draft = [...plan.others, ...plan.planned.map((row) => ({ ...row.input, id: row.id }))]
    const result = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope, false, draft)
    const ids = new Set(plan.planned.map((row) => row.id))
    const errors = [...plan.conflicts]
    for (const error of result.adjustmentErrors ?? []) {
      if (!ids.has(error.adjustmentId) || errors.some((known) => known.adjustmentId === error.adjustmentId && known.code === error.code)) continue
      errors.push({ adjustmentId: error.adjustmentId, code: error.code })
    }
    return { quote: result, errors }
  }

  async replaceTarget(quoteId: string, input: TargetPriceInput, actor: string, scope: TenantScope): Promise<TargetWriteResult> {
    const parsed = cpqTargetPriceInputSchema.parse(input)
    const adjustments = this.deps.adjustmentService
    await adjustments.requireEnabled(scope)
    return adjustments.write(quoteId, scope, parsed.expectedRevision, async (em, quote) => {
      await adjustments.assertMutable(em, quote, scope)
      const plan = await this.plan(em, quote, parsed, scope)
      const conflict = plan.conflicts[0]
      if (conflict) throw new QuotingError(422, 'ADJUSTMENT_OVERLAP', undefined, { code: 'ADJUSTMENT_OVERLAP', adjustmentId: conflict.conflictsWith, conflictsWith: conflict.conflictsWith })
      const before = plan.before.map(adjustmentSnapshot)
      const now = new Date()
      const touched: CpqQuotePriceAdjustment[] = []
      for (const { row, input: values } of plan.rows.update) {
        // A changed price is the actor's price: the author follows the latest change (spec §10).
        em.assign(row, { ...adjustments.values(values), createdByUserId: actor, updatedByUserId: actor, updatedAt: now })
        touched.push(row)
      }
      const created = plan.planned.filter((row) => row.kind === 'create').map((row) => em.create(CpqQuotePriceAdjustment, {
        ...scope, id: row.id, quoteConfigurationId: quote.id, quoteId: quote.quoteId, ...adjustments.values(row.input), createdByUserId: actor,
      }))
      for (const row of plan.rows.remove) {
        row.deletedAt = now; row.isActive = false; row.updatedByUserId = actor; row.updatedAt = now
        touched.push(row)
      }
      const priced = await this.persistAndPrice(em, quote, [...touched, ...created], scope)
      const written = new Set([...plan.rows.update.map((entry) => entry.row.id), ...created.map((row) => row.id)])
      const invalid = priced.adjustmentErrors?.find((error) => written.has(error.adjustmentId))
      if (invalid) throw new QuotingError(422, invalid.code, undefined, { code: invalid.code, adjustmentId: invalid.adjustmentId })
      const after = [...plan.rows.keep, ...plan.rows.update.map((entry) => entry.row), ...created].sort(byMonth).map(adjustmentSnapshot)
      return { quoteId: quote.id, target: parsed.target, before, after, quote: priced }
    })
  }

  /**
   * Undo of one save (§7): under the quote lock, every `after` row must still
   * equal its snapshot (otherwise 409); rows the save created are removed and
   * the `before` rows restored, overlap-checked against the other targets.
   */
  async undoTarget(quoteId: string, target: PriceTarget, before: AdjustmentSnapshot[], after: AdjustmentSnapshot[], actor: string, scope: TenantScope): Promise<void> {
    const adjustments = this.deps.adjustmentService
    await adjustments.requireEnabled(scope)
    await adjustments.write(quoteId, scope, undefined, async (em, quote) => {
      await adjustments.assertMutable(em, quote, scope)
      for (const snapshot of [...before, ...after]) {
        if (snapshot.tenantId !== scope.tenantId || snapshot.organizationId !== scope.organizationId ||
          snapshot.quoteConfigurationId !== quote.id || !isOnTarget(snapshot, target)) {
          throw new QuotingError(403, 'Adjustment undo scope mismatch')
        }
      }
      const ids = [...new Set([...before, ...after].map((snapshot) => snapshot.id))]
      const rows = ids.length ? await findWithDecryption(em, CpqQuotePriceAdjustment, { id: { $in: ids }, quoteConfigurationId: quote.id, ...scope }, undefined, scope) : []
      const byId = new Map(rows.map((row) => [row.id, row]))
      for (const snapshot of after) {
        const row = byId.get(snapshot.id)
        if (!row || snapshotKey(adjustmentSnapshot(row)) !== snapshotKey(snapshot)) throw new QuotingError(409, 'Adjustment changed since this action')
      }
      const afterById = new Map(after.map((snapshot) => [snapshot.id, snapshot]))
      const beforeIds = new Set(before.map((snapshot) => snapshot.id))
      // Unchanged rows are in both lists with the same snapshot: nothing to restore.
      const restore = before.filter((snapshot) => { const kept = afterById.get(snapshot.id); return !kept || snapshotKey(kept) !== snapshotKey(snapshot) })
      const stored = await loadQuoteAdjustments(em, quote.id, scope)
      const others = stored.filter((row) => !afterById.has(row.id) && !beforeIds.has(row.id))
      const restored = restore.map((snapshot) => ({ snapshot, input: cpqPriceAdjustmentInputSchema.parse(adjustments.inputFromSnapshot(snapshot)) }))
      for (const { snapshot, input } of restored) {
        if (!snapshot.isActive || snapshot.deletedAt) continue
        const other = others.find((row) => adjustmentsOverlap({ id: snapshot.id, ...input }, row))
        if (other) throw new QuotingError(422, 'ADJUSTMENT_OVERLAP', undefined, { code: 'ADJUSTMENT_OVERLAP', adjustmentId: other.id, conflictsWith: other.id })
      }
      const now = new Date()
      const touched: CpqQuotePriceAdjustment[] = []
      for (const snapshot of after) {
        if (beforeIds.has(snapshot.id)) continue
        const row = byId.get(snapshot.id)!
        row.deletedAt = now; row.isActive = false; row.updatedByUserId = actor; row.updatedAt = now
        touched.push(row)
      }
      for (const { snapshot, input } of restored) {
        const row = byId.get(snapshot.id)
        if (!row) throw new QuotingError(409, 'Adjustment changed since this action')
        em.assign(row, { ...adjustments.values(input), createdByUserId: snapshot.createdByUserId,
          deletedAt: snapshot.deletedAt ? new Date(snapshot.deletedAt) : null, isActive: snapshot.isActive, updatedByUserId: actor, updatedAt: now })
        touched.push(row)
      }
      await this.persistAndPrice(em, quote, touched, scope)
    })
  }

  /** Target, rows and overlaps of one body; shared by preview and save so both apply the same rules. */
  private async plan(em: EntityManager, quote: CpqQuoteConfiguration, parsed: TargetPriceInput, scope: TenantScope): Promise<TargetPlan> {
    const { target } = parsed
    const line = await this.deps.adjustmentService.requireTarget(em, quote, target.quoteLineId, scope)
    // A body that writes nothing only removes the target's rows: allowed on a charge that left the
    // line, so its orphan rows (ADJUSTMENT_TARGET_MISSING) can still be removed. The line stays required.
    const writesNothing = parsed.phases.length === 0 && parsed.then === null
    if (!writesNothing && target.level === 'charge' && Array.isArray(line.charges) && !line.charges.some((charge) => charge.chargeCode === target.chargeCode)) {
      throw new QuotingError(404, 'Charge not found')
    }
    let wanted: PriceAdjustmentInput[]
    try {
      wanted = rowsForTarget(parsed, line.termMonths)
    } catch (error) {
      if (error instanceof TargetPriceError) throw new QuotingError(422, error.code, undefined, { code: error.code, ...(error.stepIndex !== undefined ? { stepIndex: error.stepIndex } : {}) })
      throw error
    }
    const filter = target.level === 'charge' ? { level: 'charge' as const, chargeCode: target.chargeCode } : { level: 'line' as const, chargeTypeFilter: target.chargeTypeFilter }
    const before = (await findWithDecryption(em, CpqQuotePriceAdjustment, {
      ...scope, quoteConfigurationId: quote.id, quoteLineId: target.quoteLineId, ...filter, deletedAt: null, isActive: true,
    }, { orderBy: { fromMonth: 'asc', id: 'asc' } }, scope)).filter((row) => isOnTarget(row, target))
    // A reason no longer offered may stay on a set that already uses it (as PATCH does).
    if (wanted.length && parsed.reasonCode && !before.some((row) => row.reasonCode === parsed.reasonCode)) {
      await this.deps.adjustmentService.requireReason(em, parsed.reasonCode, scope)
    }
    const rows = planTargetWrite(before, wanted)
    const planned: PlannedRow[] = [
      ...rows.keep.map((row) => ({ id: row.id, input: wanted.find((input) => sameMonths(input, row))!, kind: 'keep' as const })),
      ...rows.update.map((entry) => ({ id: entry.row.id, input: entry.input, kind: 'update' as const })),
      ...rows.create.map((input) => ({ id: randomUUID(), input, kind: 'create' as const })),
    ]
    const beforeIds = new Set(before.map((row) => row.id))
    const others = (await loadQuoteAdjustments(em, quote.id, scope)).filter((row) => !beforeIds.has(row.id))
    const conflicts: TargetPreviewError[] = []
    for (const row of planned) {
      const other = others.find((candidate) => adjustmentsOverlap({ id: row.id, ...row.input }, candidate))
      if (other) conflicts.push({ adjustmentId: row.id, code: 'ADJUSTMENT_OVERLAP', conflictsWith: other.id })
    }
    return { rows, planned, before, others, conflicts }
  }

  private async persistAndPrice(em: EntityManager, quote: CpqQuoteConfiguration, rows: CpqQuotePriceAdjustment[], scope: TenantScope): Promise<QuoteResult> {
    let priced: QuoteResult | undefined
    await withAtomicFlush(em, [
      () => { for (const row of rows) em.persist(row) },
      async () => { priced = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope) },
    ])
    if (!priced) throw new Error('Target price recalculation did not return a quote')
    return priced
  }
}

function sameMonths(a: { fromMonth?: number | null; toMonth?: number | null }, b: { fromMonth?: number | null; toMonth?: number | null }): boolean {
  return (a.fromMonth ?? 1) === (b.fromMonth ?? 1) && (a.toMonth ?? null) === (b.toMonth ?? null)
}
