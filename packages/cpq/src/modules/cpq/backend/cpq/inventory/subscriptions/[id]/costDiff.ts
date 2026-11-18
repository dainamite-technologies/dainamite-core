/**
 * Cost diffs for the subscription Change History (feature spec Q7, UI/UX "Change History").
 *
 * Pure: compares the `costs` arrays that `snapshotSubscription` writes under `items[]` and `assets[]` of a change-log
 * row's `before_snapshot` / `after_snapshot` (shape: services/costs/inventoryCostSnapshot.ts). The change-log route
 * strips every `costs` key for callers without `cpq.costs.view`; with no `costs` key anywhere the diff is empty, never
 * an error, so the page renders nothing for them.
 */

export type SnapshotCost = {
  id: string
  costKey?: string
  name?: string
  role?: string
  costType?: string
  status?: string
  valueStatus?: string
  unitAmount?: string | null
  instanceAmount?: string | null
  totalAmount?: string | null
  currencyCode?: string | null
  fxRate?: string | null
  supplierId?: string | null
  supplierName?: string | null
  validUntil?: string | null
  supplierTermEnd?: string | null
  supplierMinTermMonths?: number | null
}

type SnapshotOwner = { id: string; name?: string; costs?: SnapshotCost[] }
export type CostDiffSnapshot = { items?: SnapshotOwner[]; assets?: SnapshotOwner[] } | null | undefined

export type CostDiffKind = 'changed' | 'added' | 'ended' | 'moved'
export type CostDiffOwnerType = 'item' | 'asset'

/** Value, supplier, validity, supplier term and status fields compared between two snapshots of the same cost. */
export const COST_DIFF_FIELDS = [
  'valueStatus', 'status', 'unitAmount', 'instanceAmount', 'totalAmount', 'currencyCode', 'fxRate',
  'supplierId', 'supplierName', 'validUntil', 'supplierTermEnd', 'supplierMinTermMonths',
] as const satisfies ReadonlyArray<keyof SnapshotCost>

export type CostDiffEntry = {
  kind: CostDiffKind
  ownerType: CostDiffOwnerType
  ownerId: string
  ownerName: string | null
  costId: string
  name: string
  before: SnapshotCost | null
  after: SnapshotCost | null
  /** Names of the differing fields (`changed` only). */
  fields: string[]
  /** `moved` between owners of one snapshot pair: the previous owner. */
  fromOwnerId: string | null
}

export type CostDiffOptions = {
  /**
   * Merge change types, where the cost rows are re-pointed to another subscription: in a `merge-result` row every
   * cost of the after snapshot arrived from a source subscription, in a `merge-source` row every cost of the before
   * snapshot left for the result. Without it a cost missing from the after snapshot counts as `ended`.
   */
  merge?: 'result' | 'source' | null
}

type Located = { ownerType: CostDiffOwnerType; ownerId: string; ownerName: string | null; cost: SnapshotCost }

function locate(snapshot: CostDiffSnapshot): Map<string, Located> {
  const out = new Map<string, Located>()
  if (!snapshot) return out
  for (const [ownerType, owners] of [['item', snapshot.items], ['asset', snapshot.assets]] as const) {
    for (const owner of owners ?? []) {
      for (const cost of Array.isArray(owner.costs) ? owner.costs : []) {
        out.set(cost.id, { ownerType, ownerId: owner.id, ownerName: owner.name ?? null, cost })
      }
    }
  }
  return out
}

const differing = (before: SnapshotCost, after: SnapshotCost): string[] =>
  COST_DIFF_FIELDS.filter((field) => (before[field] ?? null) !== (after[field] ?? null))

/** Entries ordered as: after-snapshot order (items, then assets), then costs that left the snapshot. */
export function diffSnapshotCosts(before: CostDiffSnapshot, after: CostDiffSnapshot, options: CostDiffOptions = {}): CostDiffEntry[] {
  const was = locate(before)
  const now = locate(after)
  const entries: CostDiffEntry[] = []
  const entry = (kind: CostDiffKind, at: Located, prev: Located | null, next: Located | null, fields: string[] = [], fromOwnerId: string | null = null): CostDiffEntry => ({
    kind, ownerType: at.ownerType, ownerId: at.ownerId, ownerName: at.ownerName,
    costId: at.cost.id, name: at.cost.name ?? at.cost.costKey ?? '', before: prev?.cost ?? null, after: next?.cost ?? null, fields, fromOwnerId,
  })

  for (const [id, next] of now) {
    const prev = was.get(id)
    if (!prev) {
      entries.push(entry(options.merge === 'result' ? 'moved' : 'added', next, null, next))
    } else if (prev.ownerId !== next.ownerId) {
      entries.push(entry('moved', next, prev, next, [], prev.ownerId))
    } else if (prev.cost.status !== 'ended' && next.cost.status === 'ended') {
      entries.push(entry('ended', next, prev, next))
    } else {
      const fields = differing(prev.cost, next.cost)
      if (fields.length > 0) entries.push(entry('changed', next, prev, next, fields))
    }
  }
  for (const [id, prev] of was) {
    if (now.has(id)) continue
    if (options.merge === 'source') entries.push(entry('moved', prev, prev, null))
    else if (prev.cost.status !== 'ended') entries.push(entry('ended', prev, prev, null))
  }
  return entries
}

/** Item ids owning at least one diff entry, for the per-item filter (asset entries are listed under their asset id). */
export function diffOwners(entries: ReadonlyArray<CostDiffEntry>): Array<{ ownerType: CostDiffOwnerType; ownerId: string; ownerName: string | null }> {
  const seen = new Map<string, { ownerType: CostDiffOwnerType; ownerId: string; ownerName: string | null }>()
  for (const e of entries) if (!seen.has(e.ownerId)) seen.set(e.ownerId, { ownerType: e.ownerType, ownerId: e.ownerId, ownerName: e.ownerName })
  return [...seen.values()]
}

const display = (cost: SnapshotCost | null): string => {
  if (!cost) return '—'
  const raw = cost.totalAmount ?? cost.instanceAmount ?? cost.unitAmount
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return '—'
  return `${Number(raw)} ${cost.currencyCode ?? ''}`.trim()
}

/** "270 EUR → 300 EUR · Carrier X" for a changed cost; the single value for others. */
export function costDiffValueText(e: CostDiffEntry): string {
  const supplier = e.after?.supplierName ?? e.before?.supplierName ?? null
  const value = e.kind === 'changed' ? `${display(e.before)} → ${display(e.after)}` : display(e.after ?? e.before)
  return supplier ? `${value} · ${supplier}` : value
}
