// XD-297: a charge's "shape" is two orthogonal axes:
//   ChargeModel   — how quantity drives the charge.
//   PricingSource — where the unit price comes from.
// Pure, dependency-free helpers live in the data layer so validators, routes,
// the pricing service, seeds, and the UI can all share them without reaching
// across layers.
export type ChargeModel = 'flat' | 'per_unit' | 'volume' | 'tiered'
export type PricingSource = 'fixed' | 'table'

/**
 * Resolve a charge's (chargeModel, pricingSource) from either the new split
 * columns or a legacy combined `pricingMethod` value (flat | per_unit | tiered).
 * Keeps the engine working for rows that predate the split / haven't been
 * migrated, and tolerates new clients that send the legacy value by mistake.
 */
export function normalizeChargePricing(charge: {
  chargeModel?: string | null
  pricingMethod?: string | null
  fixedPrice?: string | null
  pricingTableId?: string | null
}): { model: ChargeModel; source: PricingSource } {
  const pm = (charge.pricingMethod ?? '').toLowerCase()
  // Anything that historically meant "comes from a table" maps to source=table.
  const tableLike = pm === 'table' || pm === 'per_unit' || pm === 'tiered' || pm === 'volume'
  const source: PricingSource = tableLike
    ? 'table'
    : pm === 'fixed'
      ? 'fixed'
      // Legacy 'flat' could be a fixed price OR a flat table lookup (the old
      // `calculateFlat`-via-table path), empty, or unknown: infer from the
      // presence of a pricing table — preserving that legacy behaviour.
      : charge.pricingTableId
        ? 'table'
        : 'fixed'

  const rawModel = (charge.chargeModel ?? '').toLowerCase()
  const model: ChargeModel =
    rawModel === 'flat' || rawModel === 'per_unit' || rawModel === 'volume' || rawModel === 'tiered'
      ? (rawModel as ChargeModel)
      // No explicit model → derive from the legacy combined pricingMethod.
      : pm === 'per_unit'
        ? 'per_unit'
        : pm === 'tiered'
          ? 'tiered'
          : 'flat'

  return { model, source }
}
