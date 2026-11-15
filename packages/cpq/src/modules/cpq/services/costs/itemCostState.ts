import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqInventoryCost,
  CpqInventorySubscriptionItem,
  CpqQuoteLineCost,
  type CpqQuoteLineConfiguration,
} from '../../data/entities'
import { isItemLive } from '../../data/costs'
import { canonicalStateHash, normalizeDay, normalizeDecimal } from '../../lib/stateHash'
import { isArcTerminationLine } from '../arcLineRemoval'
import { ARC_CARRIED_COST_SET_HASH_KEY, ARC_COSTS_CARRIED_KEY } from '../arcPriceFreeze'
import type { TenantScope } from '../types'

/**
 * Item cost state hashes and the carried-cost freshness guard (ARC costs spec Q1, App Spec I-12).
 *
 * `itemCostStateHash(row)` digests everything an ARC activation can write to an item cost (the value fields of
 * `inventoryCostSync` plus the identity, owner item and status), so ANY change by another ARC order counts:
 * value, currency / FX snapshot, supplier, validity, term, status, a re-point to another item. Decimal columns and
 * dates are normalised first (`270` = `270.0000`). What it leaves out is bookkeeping that moves without a value
 * change: `created_at` / `updated_at`, `last_change_id`, `last_order_line_cost_id`, `started_at` / `ended_at`
 * (an ended row is not in a set at all) and `subscription_id`.
 *
 * `itemCostSetHash(rows)` digests one item's OPEN costs (status `active` and, when the owner is given, a live
 * owner: feature PR #94 Q6) sorted by key, so a created, ended, re-pointed or changed row changes it, and an item
 * without costs has the one hash of the empty set.
 */

export type ItemCostStateRow = Pick<CpqInventoryCost,
  'id' | 'subscriptionItemId' | 'costKey' | 'status' | 'chargeCode' | 'origin' | 'costElementId' | 'name' | 'role' | 'costType' | 'source'
  | 'costModel' | 'valueStatus' | 'valueOrigin' | 'unitAmount' | 'instanceAmount' | 'totalAmount' | 'currencyCode' | 'fxRate' | 'fxRateDate'
  | 'fxRateSource' | 'fxRateDerivation' | 'indexSnapshot' | 'supplierId' | 'supplierName' | 'supplierQuoteRef' | 'validUntil' | 'supplierTermEnd'
  | 'supplierMinTermMonths' | 'note'>

const text = (value: string | null | undefined) => value ?? null

/** The hashed projection of one item cost. Exported for the unit tests and for callers that diff by field. */
export function itemCostState(row: ItemCostStateRow) {
  return {
    id: row.id,
    subscriptionItemId: text(row.subscriptionItemId),
    costKey: row.costKey,
    status: row.status,
    chargeCode: text(row.chargeCode),
    origin: row.origin,
    costElementId: text(row.costElementId),
    name: row.name,
    role: row.role,
    costType: row.costType,
    source: row.source,
    costModel: row.costModel,
    valueStatus: row.valueStatus,
    valueOrigin: text(row.valueOrigin),
    unitAmount: normalizeDecimal(row.unitAmount),
    instanceAmount: normalizeDecimal(row.instanceAmount),
    totalAmount: normalizeDecimal(row.totalAmount),
    currencyCode: text(row.currencyCode),
    fxRate: normalizeDecimal(row.fxRate),
    fxRateDate: normalizeDay(row.fxRateDate),
    fxRateSource: text(row.fxRateSource),
    fxRateDerivation: text(row.fxRateDerivation),
    indexSnapshot: row.indexSnapshot ?? null,
    supplierId: text(row.supplierId),
    supplierName: text(row.supplierName),
    supplierQuoteRef: text(row.supplierQuoteRef),
    validUntil: normalizeDay(row.validUntil),
    supplierTermEnd: normalizeDay(row.supplierTermEnd),
    supplierMinTermMonths: row.supplierMinTermMonths ?? null,
    note: text(row.note),
  }
}

export function itemCostStateHash(row: ItemCostStateRow): string {
  return canonicalStateHash(itemCostState(row))
}

/** The item as the set hash needs it: only its liveness (PR #94 Q6). */
export type ItemCostOwner = Pick<CpqInventorySubscriptionItem, 'status'> & { deletedAt?: Date | null }

/**
 * Hash of an item's open costs. Rows that are not `active` are ignored; with `owner` given, a not-live owner
 * (terminated / expired / superseded / deleted) has no open costs at all.
 */
export function itemCostSetHash(rows: readonly ItemCostStateRow[], owner?: ItemCostOwner): string {
  const open = owner && !isItemLive(owner) ? [] : rows.filter((row) => row.status === 'active')
  const entries = open
    .map((row) => ({ costKey: row.costKey, id: row.id, hash: itemCostStateHash(row) }))
    .sort((a, b) => (a.costKey < b.costKey ? -1 : a.costKey > b.costKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return canonicalStateHash(entries.map(({ costKey, hash }) => [costKey, hash]))
}

// ─── Carried-cost freshness guard (I-12) ────────────────────────

/** A cost-managed ARC mirror line: the item it mirrors and the set hash recorded when it was mirrored. */
export type CarriedCostLine = { quoteLineId: string; subscriptionItemId: string; expectedSetHash: string }

/** The `COST_SOURCE_CHANGED` body entry: a line whose item costs changed since mirroring, and the keys that differ. */
export type StaleCarriedCostLine = { quoteLineId: string; subscriptionItemId: string; costKeys: string[] }

type CarriedSourceLine = Pick<CpqQuoteLineConfiguration, 'quoteLineId' | 'action' | 'configuration' | 'sourceSubscriptionItemId'>

/**
 * The lines the guard covers: cost-managed mirror lines (`_arcCostsCarried` with a recorded set hash). Lines
 * without the markers (every line today, until the carry step ships; Phase 1 and merge-renew lines) are never
 * covered, so the guard is a no-op for them. Termination lines are skipped too: a cancelled line carries no
 * costs and ends its item's costs whatever they hold.
 */
export function carriedCostLines(lines: readonly CarriedSourceLine[], quoteType: string | null | undefined): CarriedCostLine[] {
  const covered: CarriedCostLine[] = []
  for (const line of lines) {
    const configuration = (line.configuration ?? {}) as Record<string, unknown>
    const expectedSetHash = configuration[ARC_CARRIED_COST_SET_HASH_KEY]
    if (configuration[ARC_COSTS_CARRIED_KEY] !== true || typeof expectedSetHash !== 'string') continue
    if (isArcTerminationLine(line, quoteType)) continue
    const subscriptionItemId = line.sourceSubscriptionItemId ?? configuration._arcMirroredFromItemId
    if (typeof subscriptionItemId !== 'string') continue
    covered.push({ quoteLineId: line.quoteLineId, subscriptionItemId, expectedSetHash })
  }
  return covered
}

/**
 * Compares each line's recorded set hash with the subscription item's current open costs. Reads nothing when
 * there is no covered line; otherwise two reads (the items, their costs) and, only for stale lines, a third (the
 * carried quote cost lines) to name the differing keys. Returns the stale lines, sorted by line id.
 */
export async function findStaleCarriedCosts(em: EntityManager, lines: readonly CarriedCostLine[], scope: TenantScope): Promise<StaleCarriedCostLine[]> {
  if (lines.length === 0) return []
  const itemIds = [...new Set(lines.map((line) => line.subscriptionItemId))]
  const tenant = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  const [items, costRows] = await Promise.all([
    em.find(CpqInventorySubscriptionItem, { id: { $in: itemIds }, ...tenant }),
    em.find(CpqInventoryCost, { subscriptionItemId: { $in: itemIds }, status: 'active', ...tenant }),
  ])
  const ownerById = new Map((items ?? []).map((item) => [item.id, item]))
  const openByItem = new Map<string, CpqInventoryCost[]>()
  for (const row of costRows ?? []) {
    if (!row.subscriptionItemId) continue
    openByItem.set(row.subscriptionItemId, [...(openByItem.get(row.subscriptionItemId) ?? []), row])
  }
  // A missing item is not live: it has no open costs.
  const openOf = (itemId: string): CpqInventoryCost[] => {
    const owner = ownerById.get(itemId)
    return owner && isItemLive(owner) ? openByItem.get(itemId) ?? [] : []
  }
  const stale = lines.filter((line) => itemCostSetHash(openOf(line.subscriptionItemId)) !== line.expectedSetHash)
  if (stale.length === 0) return []

  const carriedRows = await em.find(CpqQuoteLineCost, {
    quoteLineId: { $in: stale.map((line) => line.quoteLineId) }, carriedFromItemCostId: { $ne: null }, ...tenant,
  })
  const carriedByLine = new Map<string, CpqQuoteLineCost[]>()
  for (const row of carriedRows ?? []) carriedByLine.set(row.quoteLineId, [...(carriedByLine.get(row.quoteLineId) ?? []), row])

  return stale
    .map((line): StaleCarriedCostLine => {
      const open = new Map(openOf(line.subscriptionItemId).map((row) => [row.id, row]))
      const carried = carriedByLine.get(line.quoteLineId) ?? []
      const keys = new Set<string>()
      for (const row of carried) {
        const current = row.carriedFromItemCostId ? open.get(row.carriedFromItemCostId) : undefined
        // Gone (ended, re-pointed to another item, deleted) or changed since mirroring.
        if (!current || itemCostStateHash(current) !== row.carriedFromHash) keys.add(row.costKey)
      }
      // A key added to the item after mirroring.
      const known = new Set(carried.map((row) => row.carriedFromItemCostId))
      for (const row of open.values()) if (!known.has(row.id)) keys.add(row.costKey)
      return { quoteLineId: line.quoteLineId, subscriptionItemId: line.subscriptionItemId, costKeys: [...keys].sort() }
    })
    .sort((a, b) => a.quoteLineId.localeCompare(b.quoteLineId))
}

/** The refusal `assertCarriedCostsFresh` throws unless the caller supplies its own error. */
export class CostSourceChangedError extends Error {
  constructor(public readonly lines: StaleCarriedCostLine[]) {
    super('COST_SOURCE_CHANGED')
    this.name = 'CostSourceChangedError'
  }
}

/**
 * Throws when any covered line's item costs changed since it was mirrored (`409 COST_SOURCE_CHANGED`, nothing
 * written: callers run it before their first write). `makeError` lets a service raise its own error type.
 */
export async function assertCarriedCostsFresh(
  em: EntityManager,
  lines: readonly CarriedCostLine[],
  scope: TenantScope,
  makeError: (stale: StaleCarriedCostLine[]) => Error = (stale) => new CostSourceChangedError(stale),
): Promise<void> {
  const stale = await findStaleCarriedCosts(em, lines, scope)
  if (stale.length > 0) throw makeError(stale)
}
