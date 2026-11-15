import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  CpqInventoryCost,
  CpqQuoteLineCost,
  type CpqInventorySubscriptionItem,
  type CpqQuoteConfiguration,
  type CpqQuoteLineConfiguration,
} from '../../data/entities'
import { ARC_CARRIED_COST_SET_HASH_KEY, ARC_COSTS_CARRIED_KEY } from '../arcPriceFreeze'
import type { TenantScope } from '../types'
import { itemCostSetHash, itemCostStateHash } from './itemCostState'

/**
 * Carry-over of subscription item costs onto an ARC mirror line (ARC costs spec, "Amend carries subscription item
 * costs"). One `carried` quote cost line per OPEN item cost (`status = active`, live owner), with every field the
 * item cost holds, so the mirror line shows what the subscription really costs without re-resolving the catalog:
 * `cost_key`, `charge_code`, `role`, `cost_type`, `source`, `cost_model`, `name`, `cost_element_id`, `unit_amount`,
 * `instance_amount`, `currency_code`, the four `fx_*` fields (the stored FX snapshot is reused, never re-resolved:
 * FX spec policy), `index_snapshot`, supplier id / name / quote ref, `valid_until`, `supplier_term_end`,
 * `supplier_min_term_months` and `note`. The line is `origin = carried`, `value_origin = carried`,
 * `value_status = confirmed` (the item cost's own status while it has no amount) and links back through
 * `carried_from_item_cost_id` / `carried_from_hash` (`itemCostStateHash`, the I-12 baseline).
 *
 * On the line configuration it sets `_arcCostsCarried` and `_arcCarriedCostSetHash` (`itemCostSetHash` of the same open
 * costs): the COST_SOURCE_CHANGED guard at conversion and activation compares that hash with the live set. An item
 * without open costs gets neither marker (nothing to keep consistent; the line then follows the unmarked activation rules).
 *
 * Carried lines are never opened for sourcing: the rows are created `sourcing_status = not_requested`, and the
 * auto-open predicate never fires on an unreconfigured mirror.
 *
 * Persists on `em`; the caller flushes. With `replace`, the line's existing non-deleted cost rows are soft-deleted
 * and flushed first (the partial unique index on `(quote_line_id, cost_key)` would otherwise reject the new rows).
 */

type CarryScope = TenantScope

export type CarryItemCostsInput = {
  quote: Pick<CpqQuoteConfiguration, 'id' | 'quoteId'>
  line: CpqQuoteLineConfiguration
  item: Pick<CpqInventorySubscriptionItem, 'id' | 'status'> & { deletedAt?: Date | null }
  scope: CarryScope
  /** The item's open costs when the caller already loaded them (one query for a whole subscription). */
  openCosts?: readonly CpqInventoryCost[]
  /** Soft-delete the line's existing cost rows first (restore, refresh). */
  replace?: boolean
  /**
   * Standalone Renew mirrors are cost-managed even when the item has no open costs (a catalog element may apply today,
   * R1c): mark the line with the hash of the empty set so a cost added to the item later still counts as stale.
   */
  markEmpty?: boolean
}

export type CarryItemCostsResult = { rows: CpqQuoteLineCost[]; setHash: string | null }

/** The open costs of the given items, grouped by item id (one query). */
export async function loadOpenItemCosts(em: EntityManager, itemIds: readonly string[], scope: CarryScope): Promise<Map<string, CpqInventoryCost[]>> {
  const byItem = new Map<string, CpqInventoryCost[]>()
  if (itemIds.length === 0) return byItem
  const rows = await em.find(CpqInventoryCost, {
    subscriptionItemId: { $in: [...itemIds] }, status: 'active',
    organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null,
  })
  for (const row of rows ?? []) {
    if (!row.subscriptionItemId) continue
    byItem.set(row.subscriptionItemId, [...(byItem.get(row.subscriptionItemId) ?? []), row])
  }
  return byItem
}

const day = (value: string | Date | null | undefined): string | null => (value ? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)) : null)

/** The persisted-field projection of one open item cost as a carried quote cost line (exported for the unit tests). */
export function carriedQuoteCostData(
  cost: CpqInventoryCost,
  quote: Pick<CpqQuoteConfiguration, 'id' | 'quoteId'>,
  quoteLineId: string,
  scope: CarryScope,
): Record<string, unknown> {
  const hasAmount = cost.unitAmount !== null && cost.unitAmount !== undefined
  return {
    id: crypto.randomUUID(),
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    quoteConfigurationId: quote.id,
    quoteId: quote.quoteId,
    quoteLineId,
    costKey: cost.costKey,
    chargeCode: cost.chargeCode ?? null,
    origin: 'carried',
    costElementId: cost.costElementId ?? null,
    carriedFromItemCostId: cost.id,
    carriedFromHash: itemCostStateHash(cost),
    name: cost.name,
    role: cost.role,
    costType: cost.costType,
    source: cost.source,
    costModel: cost.costModel,
    valueStatus: hasAmount ? 'confirmed' : cost.valueStatus,
    valueOrigin: 'carried',
    unitAmount: cost.unitAmount ?? null,
    instanceAmount: cost.instanceAmount ?? null,
    currencyCode: cost.currencyCode ?? null,
    fxRate: cost.fxRate ?? null,
    fxRateDate: day(cost.fxRateDate),
    fxRateSource: cost.fxRateSource ?? null,
    fxRateDerivation: cost.fxRateDerivation ?? null,
    indexSnapshot: cost.indexSnapshot ?? null,
    supplierId: cost.supplierId ?? null,
    supplierName: cost.supplierName ?? null,
    supplierQuoteRef: cost.supplierQuoteRef ?? null,
    validUntil: day(cost.validUntil),
    supplierTermEnd: day(cost.supplierTermEnd),
    supplierMinTermMonths: cost.supplierMinTermMonths ?? null,
    note: cost.note ?? null,
    sourcingStatus: 'not_requested',
    renegotiationDue: false,
  }
}

export async function carryItemCosts(em: EntityManager, input: CarryItemCostsInput): Promise<CarryItemCostsResult> {
  const { quote, line, item, scope } = input
  const open = (input.openCosts ?? (await loadOpenItemCosts(em, [item.id], scope)).get(item.id) ?? [])
    .filter((row) => row.status === 'active' && row.subscriptionItemId === item.id)
    // Deterministic order: by cost key, then id (the set hash sorts the same way).
    .sort((a, b) => (a.costKey < b.costKey ? -1 : a.costKey > b.costKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  if (input.replace) {
    const existing = await em.find(CpqQuoteLineCost, { quoteLineId: line.quoteLineId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
    if (existing.length > 0) {
      const now = new Date()
      await withAtomicFlush(em, [() => { for (const row of existing) row.deletedAt = now }])
    }
  }
  if (open.length === 0) {
    if (!input.markEmpty) return { rows: [], setHash: null }
    const emptyHash = itemCostSetHash([], item)
    line.configuration = { ...(line.configuration ?? {}), [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: emptyHash }
    return { rows: [], setHash: emptyHash }
  }

  const rows = open.map((cost) => em.create(CpqQuoteLineCost, carriedQuoteCostData(cost, quote, line.quoteLineId, scope) as never))
  for (const row of rows) em.persist(row)
  const setHash = itemCostSetHash(open, item)
  line.configuration = { ...(line.configuration ?? {}), [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: setHash }
  return { rows, setHash }
}

// ─── Renew reconciliation (R1c), renegotiation due (R13), index re-evaluation seam ─────────────────────────────

/** The cost-line fields reconciliation reads (a quote cost row, or its plain-object projection). */
export type RenewCostRow = Pick<
  CpqQuoteLineCost,
  'costKey' | 'origin' | 'role' | 'costType' | 'source' | 'chargeCode' | 'costElementId' | 'valueStatus' | 'valueOrigin' | 'unitAmount'
  | 'validUntil' | 'supplierTermEnd' | 'renegotiationDue'
> & Partial<Pick<CpqQuoteLineCost, 'sourcingStatus' | 'instanceAmount' | 'indexSnapshot'>>

/** The only fields renegotiation-due flagging writes. */
export type RenewDuePatch = { renegotiationDue: boolean; valueStatus?: 'estimated' | 'confirmed' }

/**
 * Renegotiation due (App Spec R13, ARC costs spec "Renegotiation due on Renew"). Only a RECURRING (`mrc`) cost still holding its
 * carried value is evaluated (`origin = carried`, `value_origin = carried`, no answered request: a supplier answer, manual
 * value or Keep current cost already confirmed it). It is due when its `valid_until` or `supplier_term_end` is before the
 * renewal's new term end: `value_status = estimated`, value kept. Evaluated on every saved recalculation, so a changed term
 * un-flags a cost that is no longer short (back to `confirmed` while it holds an amount). Margin-only costs are flagged
 * too; they never block conversion (the guard reads price-basis rows only). `null` = nothing to change.
 */
export function renewDuePatch(row: RenewCostRow, newTermEnd: string | Date | null | undefined): RenewDuePatch | null {
  const end = day(newTermEnd)
  if (!end || row.origin !== 'carried' || row.valueOrigin !== 'carried' || row.costType !== 'mrc') return null
  if (row.sourcingStatus === 'answered') return null
  const validUntil = day(row.validUntil)
  const termEnd = day(row.supplierTermEnd)
  const short = (validUntil !== null && validUntil < end) || (termEnd !== null && termEnd < end)
  const hasAmount = row.unitAmount !== null && row.unitAmount !== undefined
  if (short) {
    return row.renegotiationDue && row.valueStatus === 'estimated' ? null : { renegotiationDue: true, valueStatus: 'estimated' }
  }
  if (!row.renegotiationDue) return null
  return hasAmount ? { renegotiationDue: false, valueStatus: 'confirmed' } : { renegotiationDue: false }
}

export type ReconcileRenewInput = {
  /** The line's stored (non-deleted) cost rows. */
  rows: readonly RenewCostRow[]
  /** Cost keys of the catalog elements that apply to the line's configuration today. */
  applicableKeys: ReadonlySet<string>
  /** Codes of the charges the line's offering / product has today. */
  chargeCodes: ReadonlySet<string>
  newTermEnd: string | Date | null | undefined
}

export type ReconcileRenewResult = {
  /** Carried rows whose key matches an applicable element: they keep their carried value. */
  matched: RenewCostRow[]
  /** Carried rows no element ever claimed (no `cost_element_id`) that still resolve to a charge: carried unchanged. */
  carried: RenewCostRow[]
  /** Applicable element keys the line has no row for: the catalog loop instantiates them. */
  instantiate: string[]
  /** Carried rows whose element no longer applies, or whose `charge_code` no longer resolves: soft-deleted, listed on read as dropped at renewal. */
  dropped: RenewCostRow[]
  /** Due-flag changes per kept row. */
  due: Array<{ row: RenewCostRow; patch: RenewDuePatch }>
}

/**
 * R1c reconciliation of a cost-managed standalone Renew line with today's catalog. Pure: classifies the line's carried rows
 * (match / carried / drop) and the applicable elements (instantiate), and computes the renegotiation-due flags against
 * `newTermEnd`. The catalog loop of `resolveQuoteCosts` performs the instantiation and the keep-value matching; the
 * caller applies the drops and the due patches. Non-carried rows (catalog, manual) are not this function's concern.
 */
export function reconcileRenewCosts(input: ReconcileRenewInput): ReconcileRenewResult {
  const result: ReconcileRenewResult = { matched: [], carried: [], instantiate: [], dropped: [], due: [] }
  const present = new Set(input.rows.map((row) => row.costKey))
  result.instantiate = [...input.applicableKeys].filter((key) => !present.has(key)).sort()
  for (const row of input.rows) {
    if (row.origin !== 'carried') continue
    const chargeGone = !!row.chargeCode && !input.chargeCodes.has(row.chargeCode)
    if (input.applicableKeys.has(row.costKey) && !chargeGone) { result.matched.push(row) }
    else if (!row.costElementId && !chargeGone) { result.carried.push(row) }
    else { result.dropped.push(row); continue }
    const patch = renewDuePatch(row, input.newTermEnd)
    if (patch) result.due.push({ row, patch })
  }
  return result
}

/** A carried `index` line as the index re-evaluation sees it, after reconciliation. */
export type CarriedIndexLine = RenewCostRow

/** What index re-evaluation may change: the value and the snapshot, nothing else. */
export type IndexReevaluationPatch = { unitAmount?: string | null; instanceAmount?: string | null; indexSnapshot?: Record<string, unknown> | null }
export type IndexReevaluation = { row: CarriedIndexLine; patch: IndexReevaluationPatch }
export type ReevaluateCarriedIndexCosts = (input: { lines: readonly CarriedIndexLine[]; asOf: string }) => Promise<IndexReevaluation[]>

/**
 * Seam of the index-costs feature (`.ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md`): filled by the index-costs
 * feature. The `index` cost source is not available yet (`AVAILABLE_COST_SOURCES`), so there is nothing to re-evaluate and
 * this changes nothing. Contract it must keep: it receives ONLY carried `index` lines with `value_origin = carried` that
 * are not renegotiation due, and may change only `unit_amount` / `instance_amount` / `index_snapshot` (anything else it
 * returns is discarded by `reconcileRenewLine`).
 */
export const reevaluateCarriedIndexCosts: ReevaluateCarriedIndexCosts = async () => []

/** Whether a (post-reconciliation) cost line may be handed to `reevaluateCarriedIndexCosts`. */
export function isIndexReevaluable(row: RenewCostRow): boolean {
  return row.origin === 'carried' && row.source === 'index' && row.valueOrigin === 'carried' && row.renegotiationDue !== true
}

const INDEX_PATCH_KEYS = ['unitAmount', 'instanceAmount', 'indexSnapshot'] as const

export type ReconcileRenewLineInput = ReconcileRenewInput & {
  /** The date the index values are read as of (the recalculation date, `YYYY-MM-DD`). */
  asOf: string
  /** Row state AFTER the catalog loop (stored row merged with its pending patch); defaults to the row itself. */
  effective?: (row: RenewCostRow) => RenewCostRow
}

export type ReconcileRenewLineResult = ReconcileRenewResult & { indexPatches: IndexReevaluation[] }

/**
 * One Renew line: `reconcileRenewCosts` FIRST, then `reevaluateCarriedIndexCosts` on what survived. The second call sees only
 * carried `index` lines with `value_origin = carried` whose due flag (as computed by the reconciliation) is false, and its
 * result is reduced to the value / snapshot fields. `hooks` lets the index-costs feature (and the tests) supply the implementation.
 */
export async function reconcileRenewLine(
  input: ReconcileRenewLineInput,
  hooks: { reevaluateCarriedIndexCosts?: ReevaluateCarriedIndexCosts } = {},
): Promise<ReconcileRenewLineResult> {
  const result = reconcileRenewCosts(input)
  const effective = input.effective ?? ((row: RenewCostRow) => row)
  const dueByRow = new Map(result.due.map(({ row, patch }) => [row, patch]))
  const kept = [...result.matched, ...result.carried].map((row) => ({ ...effective(row), ...(dueByRow.get(row) ?? {}) }) as CarriedIndexLine)
  const eligible = kept.filter(isIndexReevaluable)
  const reevaluate = hooks.reevaluateCarriedIndexCosts ?? reevaluateCarriedIndexCosts
  const raw = eligible.length > 0 ? await reevaluate({ lines: eligible, asOf: input.asOf }) : []
  const originalOf = new Map([...result.matched, ...result.carried].map((row) => [row.costKey, row]))
  const indexPatches = raw.flatMap(({ row, patch }) => {
    const original = originalOf.get(row.costKey)
    if (!original) return []
    const allowed = Object.fromEntries(INDEX_PATCH_KEYS.filter((key) => key in patch).map((key) => [key, patch[key]])) as IndexReevaluationPatch
    return Object.keys(allowed).length > 0 ? [{ row: original as CarriedIndexLine, patch: allowed }] : []
  })
  return { ...result, indexPatches }
}

// ─── Cancel exposure (App Spec US-6.4, ARC costs spec "Cancel shows supplier early-exit exposure") ──────────────

/** The inventory-cost fields exposure reads (an item or an asset cost). */
export type ExposureCostRow = Pick<CpqInventoryCost, 'id' | 'costKey' | 'name' | 'costType' | 'supplierName' | 'supplierTermEnd'>

export type CancelExposureItem = {
  inventoryCostId: string
  costKey: string
  name: string
  supplierName: string | null
  supplierTermEnd: string | null
  /** Whole calendar months from the reference date to the supplier term end (at least 1); `null` while the term is unknown. */
  exposureMonths: number | null
  termUnknown: boolean
}

/**
 * Whole calendar months from `from` to `to` (`YYYY-MM-DD`, `to` after `from`): the month difference, minus one when
 * `to`'s day-of-month is before `from`'s, unless `to` is the last day of its month (so 2027-11-30 -> 2028-05-31 is 6, and
 * 2027-11-30 -> 2028-11-30 is 12). A term ending a few days after the reference date still counts as 1 month.
 */
export function exposureMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const lastDayOfTarget = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  let months = (ty - fy) * 12 + (tm - fm)
  if (td < fd && td !== lastDayOfTarget) months -= 1
  return Math.max(1, months)
}

/**
 * Supplier commitments that outlive a cancellation: of the given open inventory costs (items and assets), every cost whose
 * `supplier_term_end` is AFTER `referenceDate` with its months of exposure; a recurring (`mrc`) cost without a supplier term is
 * listed as `termUnknown`. Costs whose term ended on or before the reference date, and one-off costs without a term, are not
 * listed. No amount is part of the result and nothing is recorded as a cost (Q-D10). Sorted by term end, unknown last.
 */
export function computeCancelExposure(rows: readonly ExposureCostRow[], referenceDate: string | Date): CancelExposureItem[] {
  const reference = day(referenceDate)
  if (!reference) return []
  const items: CancelExposureItem[] = []
  for (const row of rows) {
    const termEnd = day(row.supplierTermEnd)
    const base = { inventoryCostId: row.id, costKey: row.costKey, name: row.name, supplierName: row.supplierName ?? null }
    if (termEnd) {
      if (termEnd > reference) items.push({ ...base, supplierTermEnd: termEnd, exposureMonths: exposureMonthsBetween(reference, termEnd), termUnknown: false })
    } else if (row.costType === 'mrc') {
      items.push({ ...base, supplierTermEnd: null, exposureMonths: null, termUnknown: true })
    }
  }
  return items.sort((a, b) => (a.supplierTermEnd ?? '9999-12-31').localeCompare(b.supplierTermEnd ?? '9999-12-31') || a.name.localeCompare(b.name) || a.inventoryCostId.localeCompare(b.inventoryCostId))
}
