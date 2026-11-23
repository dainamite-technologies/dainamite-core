/**
 * #133 (TMF620 `ProductOffering.isSellable`): an offering with
 * `isSellable = false` can only be sold inside a bundle, i.e. as a child line
 * (`parentLineId` set). Quoting rejects such a top-level line and conversion
 * re-checks it, so quotes written before the flag was set can't slip through.
 *
 * Lines that act on something already sold are never blocked: lines bound to
 * a subscription item (`sourceSubscriptionItemId`) and server-made ARC mirror
 * lines. Both are set only by the server, never by a caller; the line action
 * alone is caller input and does not exempt a line. The caller must also make
 * sure `parentLineId` points at a line that exists on the quote.
 */

export const NON_SELLABLE_TOP_LEVEL_CODE = 'V-QLINE-1'

export type SellabilityLine = {
  /** Only a parent that exists on the quote; pass null for an orphan. */
  parentLineId?: string | null
  sourceSubscriptionItemId?: string | null
  /** The line configuration; server-owned `_arcMirrored*` markers exempt it. */
  configuration?: Record<string, unknown> | null
}

/** Server-made ARC mirror line (client `_arc*` keys are stripped on input). */
function isServerMirrorLine(configuration: Record<string, unknown> | null | undefined): boolean {
  return typeof configuration?._arcMirroredFromItemId === 'string' || typeof configuration?._arcMirroredFromAssetId === 'string'
}

export function violatesSellability(offering: { isSellable: boolean } | null | undefined, line: SellabilityLine): boolean {
  // Only an explicit `false` blocks: the column defaults to true.
  if (!offering || offering.isSellable !== false) return false
  if (line.parentLineId) return false
  if (line.sourceSubscriptionItemId) return false
  if (isServerMirrorLine(line.configuration)) return false
  return true
}

export function nonSellableTopLevelMessage(offeringCode: string): string {
  return `${NON_SELLABLE_TOP_LEVEL_CODE}: Offering ${offeringCode} can only be sold as part of a bundle`
}
