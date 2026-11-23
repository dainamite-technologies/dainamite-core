/**
 * #133 (TMF620 `ProductOffering.isSellable`): an offering with
 * `isSellable = false` can only be sold inside a bundle, i.e. as a child line
 * (`parentLineId` set). Quoting rejects such a top-level line and conversion
 * re-checks it, so quotes written before the flag was set can't slip through.
 *
 * Lines that act on an existing subscription item (ARC mirrors, or any action
 * other than `add`) are never blocked: the rule only stops *adding* a new
 * top-level line.
 */

export const NON_SELLABLE_TOP_LEVEL_CODE = 'V-QLINE-1'

export type SellabilityLine = {
  parentLineId?: string | null
  action?: string | null
  sourceSubscriptionItemId?: string | null
}

export function violatesSellability(offering: { isSellable: boolean } | null | undefined, line: SellabilityLine): boolean {
  // Only an explicit `false` blocks: the column defaults to true.
  if (!offering || offering.isSellable !== false) return false
  if (line.parentLineId) return false
  if ((line.action ?? 'add') !== 'add') return false
  if (line.sourceSubscriptionItemId) return false
  return true
}

export function nonSellableTopLevelMessage(offeringCode: string): string {
  return `${NON_SELLABLE_TOP_LEVEL_CODE}: Offering ${offeringCode} can only be sold as part of a bundle`
}
