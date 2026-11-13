import type { ResolvedCharge } from '../types'

/** Normalize legacy snapshots without changing their offer, rules or tier breakdown. */
export function withChargeWaterfall(charge: ResolvedCharge): ResolvedCharge {
  const adjustments = charge.adjustments ?? []
  const rules = adjustments.filter((entry) => entry.origin !== 'manual')
  const manual = adjustments.find((entry) => entry.origin === 'manual')
  const listUnitPrice = charge.listUnitPrice ?? rules[0]?.unitPriceBefore ?? manual?.unitPriceBefore ?? charge.unitPrice
  const standardUnitPrice = charge.standardUnitPrice ?? rules.at(-1)?.unitPriceAfter ?? manual?.unitPriceBefore ?? charge.unitPrice
  // Keep the exact stored total when no recalculation is needed (tier averages
  // may not multiply back to the byte-identical stored total).
  const totalAt = (unit: number | null) => charge.totalPrice === null || unit === null ? null
    : unit === charge.unitPrice ? charge.totalPrice : unit * (charge.quantity ?? 1)
  return {
    ...charge,
    listUnitPrice,
    listTotalPrice: charge.listTotalPrice !== undefined ? charge.listTotalPrice : totalAt(listUnitPrice),
    standardUnitPrice,
    standardTotalPrice: charge.standardTotalPrice !== undefined ? charge.standardTotalPrice : totalAt(standardUnitPrice),
    ...(charge.adjustments ? { adjustments: adjustments.map((entry) => ({ ...entry, origin: entry.origin ?? 'rule' })) } : {}),
  }
}

/** Keep the public calculator's default response compatible and free of waterfall data. */
export function withoutChargeWaterfall(charge: ResolvedCharge): ResolvedCharge {
  const { listUnitPrice, listTotalPrice, standardUnitPrice, standardTotalPrice, ...publicCharge } = charge
  return publicCharge
}
