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
  if (open.length === 0) return { rows: [], setHash: null }

  const rows = open.map((cost) => em.create(CpqQuoteLineCost, carriedQuoteCostData(cost, quote, line.quoteLineId, scope) as never))
  for (const row of rows) em.persist(row)
  const setHash = itemCostSetHash(open, item)
  line.configuration = { ...(line.configuration ?? {}), [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: setHash }
  return { rows, setHash }
}
