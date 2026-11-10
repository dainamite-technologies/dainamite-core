import { isArcMirrorLine } from '../arcPriceFreeze'
import { ADJUSTMENT_TOGGLE, REASON_DICTIONARY } from '../../data/price-adjustments'
export { ADJUSTMENT_TOGGLE, REASON_DICTIONARY } from '../../data/price-adjustments'
import { loadQuoteAdjustments } from './loadQuoteAdjustments'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { cpqPriceAdjustmentInputSchema, cpqPriceAdjustmentPatchSchema, type PriceAdjustmentInput, type PriceAdjustmentPatch } from '../../data/price-adjustments'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import type { QuoteResult, TenantScope } from '../types'
import { withQuotePricingWrite } from './quotePricingWrite'


type Dependencies = {
  em: EntityManager
  quotingService: DefaultCpqQuotingService
  featureTogglesService: Pick<FeatureTogglesService, 'getBoolConfig'>
}

export function adjustmentInput(row: CpqQuotePriceAdjustment): PriceAdjustmentInput {
  return cpqPriceAdjustmentInputSchema.parse({ level: row.level, quoteLineId: row.quoteLineId,
    chargeCode: row.chargeCode, chargeTypeFilter: row.chargeTypeFilter, adjustmentType: row.adjustmentType,
    value: Number(row.value), currencyCode: row.currencyCode, reasonCode: row.reasonCode, reasonNote: row.reasonNote })
}
export function adjustmentSnapshot(row: CpqQuotePriceAdjustment) {
  return { id: row.id, ...adjustmentInput(row), quoteConfigurationId: row.quoteConfigurationId,
    quoteId: row.quoteId, tenantId: row.tenantId, organizationId: row.organizationId,
    createdByUserId: row.createdByUserId, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null, isActive: row.isActive }
}
export type AdjustmentSnapshot = ReturnType<typeof adjustmentSnapshot>

type OverlapKey = { id: string; level: string; quoteLineId: string; chargeCode?: string | null; chargeTypeFilter?: string | null }
/** Same level and target; line filters overlap when either covers all charges or both match. */
export function adjustmentsOverlap(a: OverlapKey, b: OverlapKey): boolean {
  if (a.id === b.id || a.level !== b.level || a.quoteLineId !== b.quoteLineId) return false
  if (a.level === 'charge') return (a.chargeCode ?? null) === (b.chargeCode ?? null)
  return !a.chargeTypeFilter || !b.chargeTypeFilter || a.chargeTypeFilter === b.chargeTypeFilter
}
export interface AdjustmentWriteResult {
  adjustment: AdjustmentSnapshot
  before: AdjustmentSnapshot | null
  quote: QuoteResult
}

export class CpqAdjustmentService {
  constructor(private readonly deps: Dependencies) {}

  async enabled(tenantId: string): Promise<boolean> {
    const flag = await this.deps.featureTogglesService.getBoolConfig(ADJUSTMENT_TOGGLE, tenantId)
    return flag.ok && flag.value === true
  }

  async list(quoteId: string, scope: TenantScope, page: number, pageSize: number) {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const scoped = { ...scope, deletedAt: null }
    const quote = await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, id: quoteId }, undefined, scope)
      ?? await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, quoteId }, undefined, scope)
    if (!quote) throw new QuotingError(404, 'Quote not found')
    const filter = { ...scoped, quoteConfigurationId: quote.id, isActive: true }
    const [rows, total, enabled, reasons] = await Promise.all([
      findWithDecryption(em, CpqQuotePriceAdjustment, filter, { limit: pageSize, offset: (page - 1) * pageSize, orderBy: { createdAt: 'asc', id: 'asc' } }, scope),
      em.count(CpqQuotePriceAdjustment, filter),
      this.enabled(scope.tenantId),
      this.reasons(em, scope),
    ])
    return { items: rows.map(adjustmentSnapshot), total, page, pageSize, totalPages: Math.ceil(total / pageSize), pricingRevision: quote.pricingRevision ?? 0, enabled, reasons }
  }

  /**
   * Reason options for the adjustment dialog. Served here so reps need only
   * `cpq.quotes.view`, not `dictionaries.view`. An inactive dictionary yields
   * no options, matching `requireReason`.
   */
  async reasons(em: EntityManager, scope: TenantScope): Promise<Array<{ value: string; label: string }>> {
    const dictionary = await findOneWithDecryption(em, Dictionary, { key: REASON_DICTIONARY, ...scope, deletedAt: null, isActive: true }, undefined, scope)
    if (!dictionary) return []
    const entries = await findWithDecryption(em, DictionaryEntry, { dictionary: dictionary.id, ...scope }, { orderBy: { position: 'asc', label: 'asc' } }, scope)
    return entries.map((entry) => ({ value: entry.value, label: entry.label }))
  }

  async preview(quoteId: string, input: PriceAdjustmentInput, replaceAdjustmentId: string | undefined, scope: TenantScope) {
    const parsed = cpqPriceAdjustmentInputSchema.parse(input)
    await this.requireEnabled(scope)
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const scoped = { ...scope, deletedAt: null }
    const quote = await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, id: quoteId }, undefined, scope)
      ?? await findOneWithDecryption(em, CpqQuoteConfiguration, { ...scoped, quoteId }, undefined, scope)
    if (!quote) throw new QuotingError(404, 'Quote not found')
    if (parsed.expectedRevision !== undefined && parsed.expectedRevision !== (quote.pricingRevision ?? 0)) throw new QuotingError(409, 'STALE_REVISION')
    await this.assertMutable(em, quote, scope)
    await this.requireTarget(em, quote, parsed.quoteLineId, scope)
    const stored = await loadQuoteAdjustments(em, quote.id, scope)
    const replaced = stored.find((row) => row.id === replaceAdjustmentId)
    if (replaceAdjustmentId && !replaced) throw new QuotingError(404, 'Adjustment not found')
    if (replaced && (replaced.level !== parsed.level || replaced.quoteLineId !== parsed.quoteLineId || (replaced.chargeCode ?? null) !== (parsed.chargeCode ?? null))) throw new QuotingError(422, 'Adjustment target is immutable')
    if (!replaced || replaced.reasonCode !== parsed.reasonCode) await this.requireReason(em, parsed.reasonCode, scope)
    const draft = { ...parsed, id: replaceAdjustmentId ?? randomUUID() }
    const adjustments = [...stored.filter((row) => row.id !== replaceAdjustmentId), draft]
    const result = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope, false, adjustments)
    return { quote: result, errors: result.adjustmentErrors ?? [] }
  }

  async create(quoteId: string, input: PriceAdjustmentInput, actor: string, scope: TenantScope): Promise<AdjustmentWriteResult> {
    const parsed = cpqPriceAdjustmentInputSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, async (em, quote) => {
      await this.assertMutable(em, quote, scope)
      await this.requireReason(em, parsed.reasonCode, scope)
      await this.requireTarget(em, quote, parsed.quoteLineId, scope)
      const id = randomUUID()
      await this.rejectOverlap(em, quote, { id, ...parsed }, scope)
      const row = em.create(CpqQuotePriceAdjustment, { ...scope, id, quoteConfigurationId: quote.id,
        quoteId: quote.quoteId, ...this.values(parsed), createdByUserId: actor })
      return this.save(em, quote, row, null, scope, true)
    })
  }

  async update(quoteId: string, id: string, patch: PriceAdjustmentPatch, actor: string, scope: TenantScope): Promise<AdjustmentWriteResult> {
    const parsed = cpqPriceAdjustmentPatchSchema.parse(patch)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, async (em, quote) => {
      await this.assertMutable(em, quote, scope)
      const row = await this.loadRow(em, quote.id, id, scope)
      const before = adjustmentSnapshot(row)
      await this.requireTarget(em, quote, row.quoteLineId, scope)
      const merged = cpqPriceAdjustmentInputSchema.parse({ ...adjustmentInput(row), ...parsed })
      if (merged.reasonCode !== row.reasonCode) await this.requireReason(em, merged.reasonCode, scope)
      await this.rejectOverlap(em, quote, { id: row.id, ...merged }, scope)
      em.assign(row, { ...this.values(merged), updatedByUserId: actor, updatedAt: new Date() })
      return this.save(em, quote, row, before, scope, true)
    })
  }

  async remove(quoteId: string, id: string, actor: string, scope: TenantScope, expectedRevision?: number): Promise<AdjustmentWriteResult> {
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, expectedRevision, async (em, quote) => {
      const row = await this.loadRow(em, quote.id, id, scope)
      const preview = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope, false)
      const invalid = preview.adjustmentErrors?.some((error) => error.adjustmentId === id) ?? false
      await this.assertMutable(em, quote, scope, invalid)
      const before = adjustmentSnapshot(row)
      row.deletedAt = new Date(); row.isActive = false; row.updatedByUserId = actor; row.updatedAt = new Date()
      return this.save(em, quote, row, before, scope, false)
    })
  }

  /** Restores an audited previous row under the same quote lock; never reopens a locked quote. */
  async undo(quoteId: string, id: string, before: AdjustmentSnapshot | null, after: AdjustmentSnapshot, actor: string, scope: TenantScope): Promise<void> {
    await this.requireEnabled(scope)
    await this.write(quoteId, scope, undefined, async (em, quote) => {
      await this.assertMutable(em, quote, scope)
      for (const snapshot of [before, after]) {
        if (snapshot && (snapshot.tenantId !== scope.tenantId || snapshot.organizationId !== scope.organizationId || snapshot.quoteConfigurationId !== quote.id || snapshot.id !== id)) {
          throw new QuotingError(403, 'Adjustment undo scope mismatch')
        }
      }
      const row = await this.loadRow(em, quote.id, id, scope, true)
      if (snapshotKey(adjustmentSnapshot(row)) !== snapshotKey(after)) throw new QuotingError(409, 'Adjustment changed since this action')
      if (before) em.assign(row, { ...this.values(cpqPriceAdjustmentInputSchema.parse(this.inputFromSnapshot(before))),
        deletedAt: before.deletedAt ? new Date(before.deletedAt) : null, isActive: before.isActive, updatedByUserId: actor, updatedAt: new Date() })
      else { row.deletedAt = new Date(); row.isActive = false; row.updatedByUserId = actor; row.updatedAt = new Date() }
      await this.save(em, quote, row, adjustmentSnapshot(row), scope, false)
    })
  }

  private inputFromSnapshot(snapshot: AdjustmentSnapshot): PriceAdjustmentInput {
    const { id, quoteConfigurationId, quoteId, tenantId, organizationId, createdByUserId, createdAt, updatedAt, deletedAt, isActive, ...input } = snapshot
    return input
  }

  private values(input: PriceAdjustmentInput) {
    return { level: input.level, quoteLineId: input.quoteLineId, chargeCode: input.chargeCode ?? null,
      chargeTypeFilter: input.chargeTypeFilter ?? null, adjustmentType: input.adjustmentType, value: String(input.value),
      currencyCode: input.currencyCode ?? null, reasonCode: input.reasonCode, reasonNote: input.reasonNote ?? null }
  }

  private write<T>(quoteId: string, scope: TenantScope, revision: number | undefined, execute: (em: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>) {
    return withQuotePricingWrite(this.deps.em, quoteId, scope, execute, (status, message) => new QuotingError(status, message), revision, undefined, { pricingCause: 'adjustment' })
  }

  private async save(em: EntityManager, quote: CpqQuoteConfiguration, row: CpqQuotePriceAdjustment, before: AdjustmentSnapshot | null, scope: TenantScope, rejectInvalid: boolean): Promise<AdjustmentWriteResult> {
    let priced: QuoteResult | undefined
    await withAtomicFlush(em, [
      () => { em.persist(row) },
      async () => { priced = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope) },
    ])
    if (!priced) throw new Error('Adjustment recalculation did not return a quote')
    const invalid = priced.adjustmentErrors?.find((error) => error.adjustmentId === row.id)
    if (rejectInvalid && invalid) throw new QuotingError(422, invalid.code, undefined, { code: invalid.code, adjustmentId: row.id })
    return { adjustment: adjustmentSnapshot(row), before, quote: priced }
  }

  private async requireEnabled(scope: TenantScope) {
    if (!(await this.enabled(scope.tenantId))) throw new QuotingError(403, 'Manual price adjustments are disabled')
  }

  private async requireTarget(em: EntityManager, quote: CpqQuoteConfiguration, quoteLineId: string, scope: TenantScope) {
    const line = await findOneWithDecryption(em, CpqQuoteLineConfiguration, { quoteConfigurationId: quote.id, quoteLineId, ...scope, deletedAt: null }, undefined, scope)
    if (!line) throw new QuotingError(404, 'Quote line not found')
    if (!(line.offeringId || line.productId) || isArcMirrorLine(line.configuration, quote.quoteType)) throw new QuotingError(422, 'LINE_NOT_ELIGIBLE')
  }

  /**
   * Refuse overlaps against every stored row, valid or not: an overlap hidden
   * behind a currently-invalid row would start applying once that row is
   * deleted, changing the price of a submitted quote. Runs before any mutation.
   */
  private async rejectOverlap(em: EntityManager, quote: CpqQuoteConfiguration, candidate: Parameters<typeof adjustmentsOverlap>[0], scope: TenantScope) {
    const stored = await loadQuoteAdjustments(em, quote.id, scope)
    if (stored.some((other) => adjustmentsOverlap(candidate, other))) {
      throw new QuotingError(422, 'ADJUSTMENT_OVERLAP', undefined, { code: 'ADJUSTMENT_OVERLAP', adjustmentId: candidate.id })
    }
  }

  private async requireReason(em: EntityManager, code: string, scope: TenantScope) {
    const dictionary = await findOneWithDecryption(em, Dictionary, { key: REASON_DICTIONARY, ...scope, deletedAt: null, isActive: true }, undefined, scope)
    const entry = dictionary && await findOneWithDecryption(em, DictionaryEntry, { dictionary: dictionary.id, ...scope, value: code }, undefined, scope)
    if (!entry) throw new QuotingError(422, 'REASON_NOT_FOUND')
  }

  private async assertMutable(em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope, invalidDelete = false) {
    const order = await findOneWithDecryption(em, CpqOrderConfiguration, { sourceQuoteId: quote.id, ...scope, deletedAt: null }, undefined, scope)
    const allowed = ['new', 'incomplete', 'ready'].includes(quote.cpqStatus)
    const invalidException = invalidDelete && !['accepted', 'rejected', 'cancelled'].includes(quote.cpqStatus)
    if (order || (!allowed && !invalidException)) throw new QuotingError(409, 'ADJUSTMENT_LOCKED')
  }

  private async loadRow(em: EntityManager, quoteConfigurationId: string, id: string, scope: TenantScope, deleted = false) {
    const row = await findOneWithDecryption(em, CpqQuotePriceAdjustment, { id, quoteConfigurationId, ...scope, ...(deleted ? {} : { deletedAt: null, isActive: true }) }, undefined, scope)
    if (!row) throw new QuotingError(404, 'Adjustment not found')
    return row
  }
}

function snapshotKey(snapshot: AdjustmentSnapshot): string {
  return JSON.stringify(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)))
}
