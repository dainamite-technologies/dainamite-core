import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqInventoryCost, type CpqOrderLineCost } from '../../data/entities'
import type { TenantScope } from '../types'

/**
 * Inventory cost sync (feature spec §Architecture, App Spec I-10). Creates and updates the `CpqInventoryCost`
 * rows of subscription items and assets from cost seeds (order line costs), and reports exactly what changed.
 *
 *  - One row per owner (item XOR asset) and `cost_key` for the life of the purchase: an existing row is updated
 *    in place (its id never changes). A row that was `ended` and whose key returns is reactivated (Q9), never
 *    duplicated.
 *  - No-op detection: a row whose value fields and status already equal the seed is neither written nor
 *    reported, so its `last_change_id` keeps pointing at the order that really changed it.
 *  - The caller owns the transaction, the flush and the change-log ordering; this module only persists rows on
 *    the given EM (the activation's transaction EM) and returns the real changes.
 *
 * Every query is tenant scoped and excludes soft-deleted rows, and each call reads existing rows with ONE query
 * for all its owners.
 */

/** The value fields of a cost, shared by quote, order line and inventory cost rows (identity `costKey` apart). */
export type CostSeed = {
  /** The order line cost this seed was built from (set on `last_order_line_cost_id` and reported back as a link). */
  orderLineCostId: string | null
  costKey: string
  chargeCode: string | null
  origin: string
  costElementId: string | null
  name: string
  role: string
  costType: string
  source: string
  costModel: string
  valueStatus: string
  valueOrigin: string | null
  unitAmount: string | null
  instanceAmount: string | null
  totalAmount: string | null
  currencyCode: string | null
  fxRate: string | null
  fxRateDate: string | null
  indexSnapshot: Record<string, unknown> | null
  supplierId: string | null
  supplierName: string | null
  supplierQuoteRef: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  note: string | null
}

type ValueField = Exclude<keyof CostSeed, 'orderLineCostId' | 'costKey'>

const VALUE_FIELDS: readonly ValueField[] = [
  'chargeCode', 'origin', 'costElementId', 'name', 'role', 'costType', 'source', 'costModel', 'valueStatus', 'valueOrigin',
  'unitAmount', 'instanceAmount', 'totalAmount', 'currencyCode', 'fxRate', 'fxRateDate', 'indexSnapshot',
  'supplierId', 'supplierName', 'supplierQuoteRef', 'validUntil', 'supplierTermEnd', 'supplierMinTermMonths', 'note',
]
const NUMERIC_FIELDS = new Set<ValueField>(['unitAmount', 'instanceAmount', 'totalAmount', 'fxRate'])

export type InventoryCostChange = {
  inventoryCostId: string
  subscriptionId: string
  ownerType: 'subscription_item' | 'asset'
  /** Null for an asset cost. */
  subscriptionItemId: string | null
  /** Null for an item cost. */
  assetId: string | null
  costKey: string
  supplierId: string | null
  kind: 'created' | 'changed' | 'ended' | 'repointed'
  orderLineCostId?: string | null
}

/** Order line cost -> the inventory cost it set (also reported for no-op rows, which are not changes). */
export type InventoryCostLink = { orderLineCostId: string; inventoryCostId: string }

export type InventoryCostSyncResult = {
  /** Every row now holding a seed (created, updated, reactivated or unchanged). */
  rows: CpqInventoryCost[]
  /** Real changes only: no-op rows are excluded. */
  changes: InventoryCostChange[]
  links: InventoryCostLink[]
}

export type ItemCostOwner = { subscriptionId: string; subscriptionItemId: string; seeds: CostSeed[] }
export type AssetCostOwner = { subscriptionId: string; assetId: string; seeds: CostSeed[] }
export type InventoryCostSyncContext = {
  scope: TenantScope
  /** Activation date (`YYYY-MM-DD`): `started_at` of created rows. */
  startedAt: string
}

/** Seed from an order line cost (the carry-through source of every activation write). */
export function costSeedFromOrderLineCost(row: CpqOrderLineCost): CostSeed {
  return {
    orderLineCostId: row.id,
    costKey: row.costKey,
    chargeCode: row.chargeCode ?? null,
    origin: row.origin,
    costElementId: row.costElementId ?? null,
    name: row.name,
    role: row.role,
    costType: row.costType,
    source: row.source,
    costModel: row.costModel,
    valueStatus: row.valueStatus,
    valueOrigin: row.valueOrigin ?? null,
    unitAmount: row.unitAmount ?? null,
    instanceAmount: row.instanceAmount ?? null,
    totalAmount: row.totalAmount ?? null,
    currencyCode: row.currencyCode ?? null,
    fxRate: row.fxRate ?? null,
    fxRateDate: row.fxRateDate ?? null,
    indexSnapshot: row.indexSnapshot ?? null,
    supplierId: row.supplierId ?? null,
    supplierName: row.supplierName ?? null,
    supplierQuoteRef: row.supplierQuoteRef ?? null,
    validUntil: row.validUntil ?? null,
    supplierTermEnd: row.supplierTermEnd ?? null,
    supplierMinTermMonths: row.supplierMinTermMonths ?? null,
    note: row.note ?? null,
  }
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, nested) =>
  nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : nested)

function sameValue(field: ValueField, current: unknown, next: unknown): boolean {
  const a = current === undefined ? null : current
  const b = next === undefined ? null : next
  if (a === null || b === null) return a === b
  if (NUMERIC_FIELDS.has(field)) return Number(a) === Number(b)
  if (field === 'indexSnapshot') return stable(a) === stable(b)
  return a === b
}

/** True when the row already holds the seed's values and is active: writing it would change nothing. */
export function isInventoryCostUnchanged(row: CpqInventoryCost, seed: CostSeed): boolean {
  return row.status === 'active' && VALUE_FIELDS.every((field) => sameValue(field, row[field], seed[field]))
}

type OwnerKind = 'subscription_item' | 'asset'
type AnyOwner = { subscriptionId: string; subscriptionItemId?: string; assetId?: string; seeds: CostSeed[] }

function assertOwner(kind: OwnerKind, owner: AnyOwner): string {
  const ownerId = kind === 'subscription_item' ? owner.subscriptionItemId : owner.assetId
  const other = kind === 'subscription_item' ? owner.assetId : owner.subscriptionItemId
  // Exactly one owner (mirrors the `num_nonnulls(subscription_item_id, asset_id) = 1` CHECK).
  if (!ownerId || other || !owner.subscriptionId) {
    throw new Error(`Inventory cost owner must be exactly one ${kind} with its subscription`)
  }
  const keys = owner.seeds.map((seed) => seed.costKey)
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Duplicate cost_key among the costs of ${kind} ${ownerId}`)
  }
  return ownerId
}

async function upsertOwnerCosts(
  em: EntityManager,
  kind: OwnerKind,
  owners: AnyOwner[],
  ctx: InventoryCostSyncContext,
): Promise<InventoryCostSyncResult> {
  const result: InventoryCostSyncResult = { rows: [], changes: [], links: [] }
  const seeded = owners.filter((owner) => owner.seeds.length > 0)
  const ownerIds = seeded.map((owner) => assertOwner(kind, owner))
  if (seeded.length === 0) return result

  const ownerField = kind === 'subscription_item' ? 'subscriptionItemId' : 'assetId'
  const existing = await em.find(CpqInventoryCost, {
    organizationId: ctx.scope.organizationId,
    tenantId: ctx.scope.tenantId,
    deletedAt: null,
    [ownerField]: { $in: ownerIds },
  })
  const byOwnerKey = new Map<string, CpqInventoryCost>()
  for (const row of existing ?? []) byOwnerKey.set(`${row[ownerField]}\u0000${row.costKey}`, row)

  seeded.forEach((owner, index) => {
    const ownerId = ownerIds[index]
    for (const seed of owner.seeds) {
      let row = byOwnerKey.get(`${ownerId}\u0000${seed.costKey}`)
      let kindOfChange: InventoryCostChange['kind'] | null = null
      if (!row) {
        row = em.create(CpqInventoryCost, {
          id: crypto.randomUUID(),
          organizationId: ctx.scope.organizationId,
          tenantId: ctx.scope.tenantId,
          subscriptionId: owner.subscriptionId,
          subscriptionItemId: kind === 'subscription_item' ? ownerId : null,
          assetId: kind === 'asset' ? ownerId : null,
          status: 'active',
          startedAt: ctx.startedAt,
          endedAt: null,
          lastOrderLineCostId: seed.orderLineCostId,
          costKey: seed.costKey,
          ...Object.fromEntries(VALUE_FIELDS.map((field) => [field, seed[field]])),
        } as never)
        em.persist(row)
        kindOfChange = 'created'
      } else if (!isInventoryCostUnchanged(row, seed)) {
        // Same row, same id (Q9: an ended key comes back as this row).
        Object.assign(row, Object.fromEntries(VALUE_FIELDS.map((field) => [field, seed[field]])))
        row.status = 'active'
        row.endedAt = null
        row.lastOrderLineCostId = seed.orderLineCostId
        kindOfChange = 'changed'
      }
      result.rows.push(row)
      if (seed.orderLineCostId) result.links.push({ orderLineCostId: seed.orderLineCostId, inventoryCostId: row.id })
      if (kindOfChange) {
        result.changes.push({
          inventoryCostId: row.id,
          subscriptionId: row.subscriptionId,
          ownerType: kind,
          subscriptionItemId: row.subscriptionItemId ?? null,
          assetId: row.assetId ?? null,
          costKey: row.costKey,
          supplierId: row.supplierId ?? null,
          kind: kindOfChange,
          orderLineCostId: seed.orderLineCostId,
        })
      }
    }
  })
  return result
}

/** Creates (or updates in place / reactivates) the item costs of the given items. */
export function createItemCosts(em: EntityManager, owners: ItemCostOwner[], ctx: InventoryCostSyncContext): Promise<InventoryCostSyncResult> {
  return upsertOwnerCosts(em, 'subscription_item', owners, ctx)
}

/** Creates (or updates in place / reactivates) the asset costs of the given assets. */
export function createAssetCosts(em: EntityManager, owners: AssetCostOwner[], ctx: InventoryCostSyncContext): Promise<InventoryCostSyncResult> {
  return upsertOwnerCosts(em, 'asset', owners, ctx)
}
