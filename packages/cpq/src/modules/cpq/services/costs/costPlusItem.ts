/**
 * Whether a subscription item is "cost-plus" for the Renew freeze (feature spec Q4): its stored `charges`
 * (the item's contracted state) contain a charge priced with `pricingMethod: 'cost_plus'`. Nothing else is
 * consulted — not the item's costs, not today's offering — so the rule is deterministic and needs no query.
 */
export function isCostPlusItem(item: { charges?: unknown } | null | undefined): boolean {
  const charges = item?.charges
  if (!Array.isArray(charges)) return false
  return charges.some((charge) => (charge as Record<string, unknown> | null)?.pricingMethod === 'cost_plus')
}
