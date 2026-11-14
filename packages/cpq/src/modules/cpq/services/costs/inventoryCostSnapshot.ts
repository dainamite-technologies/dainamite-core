import type { CpqInventoryCost } from '../../data/entities'

/**
 * Inventory costs inside change-log snapshots (feature spec Q7, Q10; App Spec I-4).
 *
 * `items[].costs` / `assets[].costs` are written by `snapshotSubscription` and are COMMERCIALLY CONFIDENTIAL:
 * the change-log read route strips them for callers without `cpq.costs.view` (or with the toggle off). This is
 * the single place that defines the snapshot cost shape, so the redaction helper can strip it by key.
 *
 *  - The `costs` key is OMITTED for an owner without any cost row, so snapshots of uncosted subscriptions are
 *    byte-identical to the ones produced before costs existed (Q10).
 *  - Ended rows are included (`status: 'ended'`, `endedAt` set): the snapshot is the state of the subscription,
 *    and the history of a cancelled cost is exactly what the change log is for. Every non-deleted row counts.
 *  - Rows are ordered by `costKey` so two snapshots of the same state are equal.
 */

/** The snapshot key holding an owner's costs (the only key the redaction helper has to remove). */
export const SNAPSHOT_COSTS_KEY = 'costs'

export type InventoryCostSnapshot = {
  id: string
  costKey: string
  name: string
  role: string
  costType: string
  chargeCode: string | null
  status: string
  valueStatus: string
  unitAmount: string | null
  instanceAmount: string | null
  totalAmount: string | null
  currencyCode: string | null
  fxRate: string | null
  fxRateDate: string | null
  supplierId: string | null
  supplierName: string | null
  supplierQuoteRef: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  startedAt: string
  endedAt: string | null
}

export function snapshotInventoryCost(row: CpqInventoryCost): InventoryCostSnapshot {
  return {
    id: row.id,
    costKey: row.costKey,
    name: row.name,
    role: row.role,
    costType: row.costType,
    chargeCode: row.chargeCode ?? null,
    status: row.status,
    valueStatus: row.valueStatus,
    unitAmount: row.unitAmount ?? null,
    instanceAmount: row.instanceAmount ?? null,
    totalAmount: row.totalAmount ?? null,
    currencyCode: row.currencyCode ?? null,
    fxRate: row.fxRate ?? null,
    fxRateDate: row.fxRateDate ?? null,
    supplierId: row.supplierId ?? null,
    supplierName: row.supplierName ?? null,
    supplierQuoteRef: row.supplierQuoteRef ?? null,
    validUntil: row.validUntil ?? null,
    supplierTermEnd: row.supplierTermEnd ?? null,
    supplierMinTermMonths: row.supplierMinTermMonths ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
  }
}

/** Groups one subscription's cost rows by owner: `{ items: itemId -> costs, assets: assetId -> costs }`. */
export function groupInventoryCostSnapshots(rows: CpqInventoryCost[]): {
  byItem: Map<string, InventoryCostSnapshot[]>
  byAsset: Map<string, InventoryCostSnapshot[]>
} {
  const byItem = new Map<string, InventoryCostSnapshot[]>()
  const byAsset = new Map<string, InventoryCostSnapshot[]>()
  const ordered = [...rows].sort((a, b) => (a.costKey < b.costKey ? -1 : a.costKey > b.costKey ? 1 : 0))
  for (const row of ordered) {
    const target = row.subscriptionItemId ? byItem : row.assetId ? byAsset : null
    const ownerId = row.subscriptionItemId ?? row.assetId
    if (!target || !ownerId) continue
    const list = target.get(ownerId) ?? []
    list.push(snapshotInventoryCost(row))
    target.set(ownerId, list)
  }
  return { byItem, byAsset }
}

/** `{ costs }` to spread into an owner's snapshot entry; `{}` when the owner has none (Q10). */
export function costsEntry(costs: InventoryCostSnapshot[] | undefined): { costs?: InventoryCostSnapshot[] } {
  return costs && costs.length > 0 ? { [SNAPSHOT_COSTS_KEY]: costs } : {}
}

/**
 * Redaction for the change-log read route (Q7): the snapshot without any `items[].costs` / `assets[].costs`
 * key. The one place that strips it, by key, so the snapshot cost shape can grow without a leak. Returns a copy;
 * a null / non-object snapshot is returned as is.
 */
export function stripSnapshotCosts<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const copy: Record<string, unknown> = { ...(snapshot as Record<string, unknown>) }
  for (const owners of ['items', 'assets']) {
    const list = copy[owners]
    if (Array.isArray(list)) {
      copy[owners] = list.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const { [SNAPSHOT_COSTS_KEY]: _omitted, ...rest } = entry as Record<string, unknown>
        return rest
      })
    }
  }
  return copy as T
}
