import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import { cpqPriceAdjustmentInputSchema, cpqPriceAdjustmentPatchSchema, type PriceAdjustmentInput, type PriceAdjustmentPatch } from '../../data/price-adjustments'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import type { QuoteResult, TenantScope } from '../types'
import { withQuotePricingWrite } from './quotePricingWrite'

export const ADJUSTMENT_TOGGLE = 'cpq.manual_price_adjustments'
export const REASON_DICTIONARY = 'cpq.price_adjustment_reason'

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

  async create(quoteId: string, input: PriceAdjustmentInput, actor: string, scope: TenantScope): Promise<AdjustmentWriteResult> {
    const parsed = cpqPriceAdjustmentInputSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, async (em, quote) => {
      await this.assertMutable(em, quote, scope)
      await this.requireReason(em, parsed.reasonCode, scope)
      const row = em.create(CpqQuotePriceAdjustment, { ...scope, id: randomUUID(), quoteConfigurationId: quote.id,
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
      const merged = cpqPriceAdjustmentInputSchema.parse({ ...adjustmentInput(row), ...parsed })
      if (merged.reasonCode !== row.reasonCode) await this.requireReason(em, merged.reasonCode, scope)
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
    return withQuotePricingWrite(this.deps.em, quoteId, scope, execute, (status, message) => new QuotingError(status, message), revision)
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
