import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CpqQuotePriceAdjustment } from '../../data/entities'
import { resolvedPriceAdjustmentSchema, type PriceAdjustment } from '../../data/price-adjustments'
import type { TenantScope } from '../types'

/** One aggregate load per recalculation; keyset batches avoid an unbounded query. */
export async function loadQuoteAdjustments(em: EntityManager, quoteConfigurationId: string, scope: TenantScope): Promise<PriceAdjustment[]> {
  const result: PriceAdjustment[] = []
  let after: string | undefined
  for (;;) {
    const rows = await findWithDecryption(em, CpqQuotePriceAdjustment, {
      quoteConfigurationId, ...scope, deletedAt: null, isActive: true,
      ...(after ? { id: { $gt: after } } : {}),
    }, { limit: 500, orderBy: { id: 'asc' } }, scope)
    for (const row of rows) result.push(resolvedPriceAdjustmentSchema.parse({
      id: row.id, level: row.level, quoteLineId: row.quoteLineId, chargeCode: row.chargeCode,
      chargeTypeFilter: row.chargeTypeFilter, adjustmentType: row.adjustmentType, value: Number(row.value),
      currencyCode: row.currencyCode, reasonCode: row.reasonCode, reasonNote: row.reasonNote,
      fromMonth: row.fromMonth, toMonth: row.toMonth, windowKind: row.windowKind, createdByUserId: row.createdByUserId,
    }))
    if (rows.length < 500) return result
    after = rows[rows.length - 1].id
  }
}
