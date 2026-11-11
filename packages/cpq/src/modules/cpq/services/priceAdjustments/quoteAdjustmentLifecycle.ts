import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { CpqQuoteLineConfiguration, CpqQuotePriceAdjustment } from '../../data/entities'
import type { TenantScope } from '../types'

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
    if (rows.length < 500) return
    after = rows[rows.length - 1].id
  }
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
  }
  const now = new Date()
  await withAtomicFlush(em, [() => {
    for (const line of selected) line.deletedAt = now
    for (const line of sales) line.deletedAt = now
    for (const adjustment of adjustments) { adjustment.deletedAt = now; adjustment.isActive = false }
  }])
}
