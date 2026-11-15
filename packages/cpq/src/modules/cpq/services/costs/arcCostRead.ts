import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqInventoryCost, type CpqQuoteConfiguration, type CpqQuoteLineConfiguration, type CpqQuoteLineCost } from '../../data/entities'
import { isCostManagedRenewLine, isFrozenMirrorLine } from '../arcPriceFreeze'
import type { TenantScope } from '../types'
import { loadOpenItemCosts } from './arcCostCarry'

/**
 * Read-projection additions for ARC quotes (ARC costs spec step 18, §API Contracts `GET /quotes/{id}/costs`):
 *  - `frozen` / `renegotiationDue` per line and `carried` / `renegotiationDue` per cost: booleans, safe for everyone;
 *  - `previous` on carried cost lines and `droppedItemCosts` per line: cost data, `cpq.costs.view` only.
 * Nothing here is stored: `previous` is the carried-from item cost as it stands now, and the dropped list is computed from the
 * item's open costs against the line's cost rows.
 */

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const day = (value: unknown): string | null => (value ? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)) : null)

/** The values a carried cost line was copied from, for the "Was …" diff (`cpq.costs.view` only). */
export type CarriedPrevious = {
  unitAmount: string | null
  currencyCode: string | null
  supplierName: string | null
  validUntil: string | null
  supplierTermEnd: string | null
}

export type DroppedItemCost = { inventoryCostId: string; costKey: string; name: string; reason: 'no_longer_applies' }

export async function loadCarriedPrevious(em: EntityManager, costs: readonly CpqQuoteLineCost[], scope: TenantScope): Promise<Map<string, CarriedPrevious>> {
  const byCost = new Map<string, CarriedPrevious>()
  const sourceIds = [...new Set(costs.filter((row) => row.origin === 'carried' && row.carriedFromItemCostId).map((row) => row.carriedFromItemCostId as string))]
  if (sourceIds.length === 0) return byCost
  const sources = await em.find(CpqInventoryCost, { id: { $in: sourceIds }, ...scoped(scope) })
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  for (const row of costs) {
    const source = row.carriedFromItemCostId ? sourceById.get(row.carriedFromItemCostId) : undefined
    if (row.origin !== 'carried' || !source) continue
    byCost.set(row.id, {
      unitAmount: source.unitAmount ?? null, currencyCode: source.currencyCode ?? null, supplierName: source.supplierName ?? null,
      validUntil: day(source.validUntil), supplierTermEnd: day(source.supplierTermEnd),
    })
  }
  return byCost
}

/**
 * Open item costs of a cost-managed Renew line that the line no longer carries (R1c: their element stopped applying, or their charge
 * is gone): dropped at renewal, ended at activation. Only cost-managed standalone Renew lines have any.
 */
export async function loadDroppedItemCosts(
  em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'quoteType'>, lines: readonly CpqQuoteLineConfiguration[],
  costs: readonly CpqQuoteLineCost[], scope: TenantScope,
): Promise<Map<string, DroppedItemCost[]>> {
  const result = new Map<string, DroppedItemCost[]>()
  const managed = lines.filter((line) => isCostManagedRenewLine(line.configuration, quote.quoteType) && line.action !== 'cancel')
  const itemIdOf = (line: CpqQuoteLineConfiguration) => line.sourceSubscriptionItemId ?? ((line.configuration as Record<string, unknown> | null)?._arcMirroredFromItemId as string | undefined) ?? null
  const itemIds = [...new Set(managed.map(itemIdOf).filter((id): id is string => !!id))]
  if (itemIds.length === 0) return result
  const open = await loadOpenItemCosts(em, itemIds, scope)
  for (const line of managed) {
    const itemId = itemIdOf(line)
    if (!itemId) continue
    const own = costs.filter((row) => row.quoteLineId === line.quoteLineId)
    const dropped = (open.get(itemId) ?? [])
      .filter((item) => !own.some((row) => row.carriedFromItemCostId === item.id || row.costKey === item.costKey))
      .map((item): DroppedItemCost => ({ inventoryCostId: item.id, costKey: item.costKey, name: item.name, reason: 'no_longer_applies' }))
    if (dropped.length > 0) result.set(line.quoteLineId, dropped.sort((a, b) => a.costKey.localeCompare(b.costKey)))
  }
  return result
}

/** `frozen` (the line keeps the subscription's contracted price) and `renegotiationDue` (some carried cost needs renegotiation). */
export function lineArcFlags(quote: Pick<CpqQuoteConfiguration, 'quoteType'>, line: Pick<CpqQuoteLineConfiguration, 'configuration'> | undefined, rows: readonly Pick<CpqQuoteLineCost, 'renegotiationDue'>[]) {
  return {
    frozen: line ? isFrozenMirrorLine(line.configuration, quote.quoteType) : false,
    renegotiationDue: rows.some((row) => row.renegotiationDue === true),
  }
}
