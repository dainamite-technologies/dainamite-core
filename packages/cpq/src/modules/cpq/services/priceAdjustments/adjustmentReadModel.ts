import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CpqQuotePriceAdjustment } from '../../data/entities'
import { REASON_DICTIONARY } from '../../data/price-adjustments'
import type { TenantScope } from '../types'
import { adjustmentSnapshot, type AdjustmentSnapshot } from './adjustmentService'

export interface AdjustmentAuthor {
  createdByName: string | null
  createdByEmail: string | null
}

/**
 * Author name and email of adjustment rows (D7), the way core `customers`
 * resolves activity authors: one batched read of `auth` users by FK id,
 * within the tenant. No ORM relation crosses the module boundary. A deleted
 * user keeps their name (they did set the price); a user of another tenant
 * reads as null.
 */
export async function withAuthors<T extends { createdByUserId: string }>(
  em: EntityManager, rows: ReadonlyArray<T>, scope: TenantScope,
): Promise<Array<T & AdjustmentAuthor>> {
  const ids = [...new Set(rows.map((row) => row.createdByUserId).filter(Boolean))]
  const users = ids.length
    ? await findWithDecryption(em, User, { id: { $in: ids }, tenantId: scope.tenantId }, undefined, scope)
    : []
  const byId = new Map(users.map((user) => [user.id, user]))
  return rows.map((row) => {
    const user = byId.get(row.createdByUserId)
    return { ...row, createdByName: user?.name?.trim() || null, createdByEmail: user?.email ?? null }
  })
}

export type OrderPriceAdjustment = AdjustmentSnapshot & AdjustmentAuthor & { reasonLabel: string | null }

/**
 * The source quote's active adjustments for an order (D8): read-only, frozen
 * once the quote is converted. Served on the order GET so an order viewer
 * needs only `cpq.orders.view`. At most 500 rows (a quote never gets near it).
 */
export async function loadOrderPriceAdjustments(em: EntityManager, quoteConfigurationId: string | null | undefined, scope: TenantScope): Promise<OrderPriceAdjustment[]> {
  if (!quoteConfigurationId) return []
  const rows = await findWithDecryption(em, CpqQuotePriceAdjustment, { quoteConfigurationId, ...scope, deletedAt: null, isActive: true },
    { limit: 500, orderBy: { quoteLineId: 'asc', fromMonth: 'asc', createdAt: 'asc' } }, scope)
  if (!rows.length) return []
  const [items, labels] = await Promise.all([withAuthors(em, rows.map(adjustmentSnapshot), scope), reasonLabels(em, scope)])
  return items.map((item) => ({ ...item, reasonLabel: labels.get(item.reasonCode) ?? null }))
}

/** Reason code → label; an inactive dictionary still names the reasons stored with it. */
async function reasonLabels(em: EntityManager, scope: TenantScope): Promise<Map<string, string>> {
  const dictionary = await findOneWithDecryption(em, Dictionary, { key: REASON_DICTIONARY, ...scope, deletedAt: null }, undefined, scope)
  if (!dictionary) return new Map()
  const entries = await findWithDecryption(em, DictionaryEntry, { dictionary: dictionary.id, ...scope }, undefined, scope)
  return new Map(entries.map((entry) => [entry.value, entry.label]))
}
