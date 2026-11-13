import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride, CpqQuotePriceAdjustment } from '../../data/entities'
import type { TenantScope } from '../types'

/** Sourcing-request state belongs to the original quote: a clone starts from `not_requested`. */
const SOURCING_RESET = {
  sourcingStatus: 'not_requested', costRequestId: null, requestSeq: null, requestedAt: null, requestedByUserId: null,
  answeredAt: null, answeredByUserId: null, declineReason: null, proposedAmount: null,
} as const

/**
 * R16: copies cost lines and markup overrides to the clone with new ids, re-pointed to the cloned
 * quote and lines. Values, statuses, origins, supplier fields and validity are copied as-is (an
 * expired cost stays expired); sourcing request state is reset. Rows of lines missing from the
 * clone (orphans) are not copied.
 */
async function cloneQuoteCosts(em: EntityManager, sourceId: string, target: { id: string; quoteId: string }, lineIds: Map<string, string>, scope: TenantScope): Promise<void> {
  const base = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  let after: string | undefined
  for (;;) {
    const rows: CpqQuoteLineCost[] = await em.find(CpqQuoteLineCost, { quoteConfigurationId: sourceId, ...base, ...(after ? { id: { $gt: after } } : {}) }, { limit: 500, orderBy: { id: 'asc' } })
    for (const row of rows) {
      const quoteLineId = lineIds.get(row.quoteLineId)
      if (!quoteLineId) continue
      em.persist(em.create(CpqQuoteLineCost, {
        id: randomUUID(), ...scope, quoteConfigurationId: target.id, quoteId: target.quoteId, quoteLineId,
        costKey: row.costKey, chargeCode: row.chargeCode, origin: row.origin, costElementId: row.costElementId,
        carriedFromItemCostId: row.carriedFromItemCostId, carriedFromHash: row.carriedFromHash,
        name: row.name, role: row.role, costType: row.costType, source: row.source, costModel: row.costModel,
        valueStatus: row.valueStatus, valueOrigin: row.valueOrigin, unitAmount: row.unitAmount, instanceAmount: row.instanceAmount,
        currencyCode: row.currencyCode, fxRate: row.fxRate, fxRateDate: row.fxRateDate, driverHash: row.driverHash,
        indexSnapshot: row.indexSnapshot, supplierId: row.supplierId, supplierName: row.supplierName,
        supplierQuoteRef: row.supplierQuoteRef, validUntil: row.validUntil, supplierTermEnd: row.supplierTermEnd,
        supplierMinTermMonths: row.supplierMinTermMonths, note: row.note, errorCode: row.errorCode, ...SOURCING_RESET,
      } as never))
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  after = undefined
  for (;;) {
    const rows: CpqQuoteMarkupOverride[] = await em.find(CpqQuoteMarkupOverride, { quoteConfigurationId: sourceId, ...base, ...(after ? { id: { $gt: after } } : {}) }, { limit: 500, orderBy: { id: 'asc' } })
    for (const row of rows) {
      const quoteLineId = lineIds.get(row.quoteLineId)
      if (!quoteLineId) continue
      em.persist(em.create(CpqQuoteMarkupOverride, {
        id: randomUUID(), ...scope, quoteConfigurationId: target.id, quoteId: target.quoteId, quoteLineId,
        chargeCode: row.chargeCode, markupRule: row.markupRule, markupValue: row.markupValue, note: row.note,
        createdByUserId: row.createdByUserId, updatedByUserId: row.updatedByUserId,
      } as never))
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
}

export async function cloneQuoteAdjustments(em: EntityManager, sourceId: string, target: { id: string; quoteId: string }, lineIds: Map<string, string>, scope: TenantScope): Promise<void> {
  let after: string | undefined
  for (;;) {
    const rows = await findWithDecryption(em, CpqQuotePriceAdjustment, { quoteConfigurationId: sourceId, ...scope, deletedAt: null,
      ...(after ? { id: { $gt: after } } : {}) }, { limit: 500, orderBy: { id: 'asc' } }, scope)
    for (const row of rows) {
      em.persist(em.create(CpqQuotePriceAdjustment, { id: randomUUID(), ...scope, quoteConfigurationId: target.id, quoteId: target.quoteId,
        // An orphaned invalid target remains invalid, without pointing back into the source quote.
        quoteLineId: lineIds.get(row.quoteLineId) ?? randomUUID(), level: row.level, chargeCode: row.chargeCode,
        chargeTypeFilter: row.chargeTypeFilter, adjustmentType: row.adjustmentType, value: row.value, currencyCode: row.currencyCode,
        windowKind: row.windowKind, fromMonth: row.fromMonth, toMonth: row.toMonth,
        reasonCode: row.reasonCode, reasonNote: row.reasonNote, createdByUserId: row.createdByUserId, isActive: row.isActive }))
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  await cloneQuoteCosts(em, sourceId, target, lineIds, scope)
}

/** Delete the complete bundle subtree and its adjustments before recalculation reads it. */
export async function removeQuoteLineTree(em: EntityManager, quoteConfigurationId: string, root: CpqQuoteLineConfiguration, scope: TenantScope): Promise<void> {
  const children = new Map<string, CpqQuoteLineConfiguration[]>()
  let after: string | undefined
  for (;;) {
    const rows = await findWithDecryption(em, CpqQuoteLineConfiguration, { quoteConfigurationId, ...scope, deletedAt: null,
      ...(after ? { id: { $gt: after } } : {}) }, { limit: 500, orderBy: { id: 'asc' } }, scope)
    for (const row of rows) if (row.parentLineId) {
      const siblings = children.get(row.parentLineId) ?? []
      siblings.push(row); children.set(row.parentLineId, siblings)
    }
    if (rows.length < 500) break
    after = rows[rows.length - 1].id
  }
  const selected: CpqQuoteLineConfiguration[] = [], seen = new Set<string>()
  const queue = [root]
  for (let index = 0; index < queue.length; index++) {
    const line = queue[index]
    if (seen.has(line.quoteLineId)) continue
    seen.add(line.quoteLineId); selected.push(line); queue.push(...(children.get(line.quoteLineId) ?? []))
  }
  const sales: SalesQuoteLine[] = [], adjustments: CpqQuotePriceAdjustment[] = []
  const costRows: Array<CpqQuoteLineCost | CpqQuoteMarkupOverride> = []
  const costBase = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  const ids = selected.map((line) => line.quoteLineId)
  for (let index = 0; index < ids.length; index += 500) {
    const lineIds = ids.slice(index, index + 500)
    sales.push(...await findWithDecryption(em, SalesQuoteLine, { id: { $in: lineIds }, ...scope, deletedAt: null }, { limit: 500 }, scope))
    let cursor: string | undefined
    for (;;) {
      const rows = await findWithDecryption(em, CpqQuotePriceAdjustment, { quoteConfigurationId, quoteLineId: { $in: lineIds }, ...scope, deletedAt: null,
        ...(cursor ? { id: { $gt: cursor } } : {}) }, { limit: 500, orderBy: { id: 'asc' } }, scope)
      adjustments.push(...rows)
      if (rows.length < 500) break
      cursor = rows[rows.length - 1].id
    }
    // Cost lines and markup overrides of a removed line go with it (R16); no toggle check: stored data is always cleaned.
    for (const entity of [CpqQuoteLineCost, CpqQuoteMarkupOverride] as const) {
      let costCursor: string | undefined
      for (;;) {
        const rows = await em.find(entity as never, { quoteConfigurationId, quoteLineId: { $in: lineIds }, ...costBase,
          ...(costCursor ? { id: { $gt: costCursor } } : {}) } as never, { limit: 500, orderBy: { id: 'asc' } } as never) as Array<CpqQuoteLineCost | CpqQuoteMarkupOverride>
        costRows.push(...rows)
        if (rows.length < 500) break
        costCursor = rows[rows.length - 1].id
      }
    }
  }
  const now = new Date()
  await withAtomicFlush(em, [() => {
    for (const line of selected) line.deletedAt = now
    for (const line of sales) line.deletedAt = now
    for (const adjustment of adjustments) { adjustment.deletedAt = now; adjustment.isActive = false }
    for (const row of costRows) row.deletedAt = now
  }])
}
