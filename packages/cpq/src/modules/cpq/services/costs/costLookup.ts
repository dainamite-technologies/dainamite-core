import type { TierBreakdown } from '../types'

/**
 * Pure pricing-table lookup shared by list-price charges and (from step 8)
 * cost elements priced from a cost table via `cost_column_key`. No I/O, no
 * entity classes: callers load the table and its entries and pass them in.
 */
export type LookupModel = 'flat' | 'per_unit' | 'tiered' | 'volume'

export interface LookupEntry {
  dimensionValues: Record<string, unknown>
  tierNumber?: number | null
  rangeFrom?: string | null
  rangeTo?: string | null
  prices: Record<string, number>
  currencyCode: string
}

export interface LookupTable {
  dimensions: Array<{ key: string }>
  entries: LookupEntry[]
}

export type TableLookupResult =
  /** No entry matches the dimensions (or none for the currency): caller keeps its unpriced default. */
  | { outcome: 'miss' }
  /** tiered / volume with quantity <= 0: nothing to bill, no table read. */
  | { outcome: 'zero_quantity' }
  | {
      outcome: 'priced'
      unitPrice: number
      quantity: number
      totalPrice: number
      /** Currency of the entry that priced the result; null only if no tier was consumed. */
      currencyCode: string | null
      tiers?: TierBreakdown['tiers']
    }

function entryMatchesDimensions(
  entry: LookupEntry,
  dimensions: Array<{ key: string }>,
  values: Record<string, unknown>,
): boolean {
  return dimensions.every((dim) => {
    const configVal = String(values[dim.key] ?? '')
    const entryVal = String(entry.dimensionValues[dim.key] ?? '')
    return configVal.toLowerCase() === entryVal.toLowerCase()
  })
}

const byTier = (a: LookupEntry, b: LookupEntry) => (a.tierNumber ?? 0) - (b.tierNumber ?? 0)

export interface LookupOptions {
  /**
   * Cost lookups: an entry the result would be priced from that has no value in `columnKey` makes the
   * whole lookup a `miss` (an unknown cost is never a known 0, App Spec R5). Price-table lookups leave it
   * off and keep pricing a missing column at 0.
   */
  requireColumn?: boolean
}

const hasColumn = (entry: LookupEntry, columnKey: string) => {
  const value = entry.prices?.[columnKey] as unknown
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @param table      table dimensions + its (active) entries
 * @param columnKey  price column to read (`priceColumnKey` / `cost_column_key`); a missing column prices at 0
 *                   unless `options.requireColumn`
 * @param model      flat | per_unit | tiered | volume
 * @param dimensions configured values keyed by dimension key (matched case-insensitively, exact otherwise)
 * @param quantity   billed quantity; ignored by `flat`
 * @param currency   when set, only entries in this currency are considered
 */
export function lookupTablePrice(
  table: LookupTable,
  columnKey: string,
  model: LookupModel,
  dimensions: Record<string, unknown>,
  quantity: number,
  currency?: string | null,
  options: LookupOptions = {},
): TableLookupResult {
  const entries = currency ? table.entries.filter((entry) => entry.currencyCode === currency) : table.entries
  const missingColumn = (entry: LookupEntry) => options.requireColumn === true && !hasColumn(entry, columnKey)

  if (model === 'flat' || model === 'per_unit') {
    const entry = entries.find((candidate) => entryMatchesDimensions(candidate, table.dimensions, dimensions))
    if (!entry || missingColumn(entry)) return { outcome: 'miss' }
    const unitPrice = entry.prices[columnKey] ?? 0
    if (model === 'flat') {
      return { outcome: 'priced', unitPrice, quantity: 1, totalPrice: unitPrice, currencyCode: entry.currencyCode }
    }
    return { outcome: 'priced', unitPrice, quantity, totalPrice: unitPrice * quantity, currencyCode: entry.currencyCode }
  }

  if (quantity <= 0) return { outcome: 'zero_quantity' }
  const matched = entries.filter((entry) => entryMatchesDimensions(entry, table.dimensions, dimensions))
  if (matched.length === 0) return { outcome: 'miss' }
  const sorted = [...matched].sort(byTier)

  if (model === 'volume') {
    // The WHOLE quantity is billed at the rate of the tier whose range contains it.
    // Ranges are [rangeFrom, rangeTo]; rangeTo null = infinity. Overflow falls back to the top tier.
    const entry =
      sorted.find((e) => {
        const from = e.rangeFrom != null ? Number(e.rangeFrom) : 0
        const to = e.rangeTo != null ? Number(e.rangeTo) : Infinity
        return quantity >= from && quantity <= to
      }) ?? sorted[sorted.length - 1]
    if (missingColumn(entry)) return { outcome: 'miss' }
    const unitPrice = entry.prices[columnKey] ?? 0
    return { outcome: 'priced', unitPrice, quantity, totalPrice: unitPrice * quantity, currencyCode: entry.currencyCode }
  }

  // tiered: each slice is billed at its own tier's rate.
  let allocated = 0
  let total = 0
  const tiers: TierBreakdown['tiers'] = []
  let currencyCode: string | null = null
  for (const entry of sorted) {
    if (allocated >= quantity) break
    const to = entry.rangeTo ? Number(entry.rangeTo) : Infinity
    const tierCeil = to === Infinity ? quantity : Math.min(to, quantity)
    const qty = tierCeil - allocated
    if (qty <= 0) continue
    if (missingColumn(entry)) return { outcome: 'miss' }
    const price = entry.prices[columnKey] ?? 0
    currencyCode = entry.currencyCode
    tiers.push({
      tier: entry.tierNumber ?? 0,
      from: allocated + 1,
      to: allocated + qty,
      pricePerUnit: price,
      quantity: qty,
      subtotal: qty * price,
    })
    total += qty * price
    allocated += qty
  }
  return { outcome: 'priced', unitPrice: quantity > 0 ? total / quantity : 0, quantity, totalPrice: total, currencyCode, tiers }
}
