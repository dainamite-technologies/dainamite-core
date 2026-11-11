/**
 * Frozen Amend mirror lines.
 *
 * An Amend quote mirrors every live subscription item as a `modify` line.
 * Engine-priced mirror lines used to be re-priced at today's catalog price on
 * every recalculation, and activation wrote that price back to the
 * subscription item — so amending one item silently moved every other item's
 * price. A mirror line on an Amend quote is therefore created **frozen**: it
 * keeps the source item's stored charges until a pricing input of that line
 * changes, at which point it is re-priced as before.
 *
 * The flag lives in the line configuration jsonb next to the existing
 * `_arcMirrored*` markers, so no schema change is needed.
 */

export const ARC_PRICE_FROZEN_KEY = '_arcPriceFrozen'

/**
 * Set when the server unfreezes an Amend mirror line because a pricing input
 * changed — drives the "re-priced at the current catalog price" notice (an
 * explicit marker, so Amend quotes created before freezing existed don't
 * show it).
 */
export const ARC_REPRICED_KEY = '_arcRepriced'

/** Markers that describe quote-time pricing state and never leave the quote. */
const QUOTE_ONLY_ARC_KEYS = [ARC_PRICE_FROZEN_KEY, ARC_REPRICED_KEY] as const

const ARC_MARKER_PREFIX = '_arc'

export type ArcMirrorQuoteType = 'amend' | 'cancel' | 'renew'

export function isArcPriceFrozen(configuration: Record<string, unknown> | null | undefined): boolean {
  return configuration?.[ARC_PRICE_FROZEN_KEY] === true
}

/**
 * Whether recalculation must keep a line's stored charges. Only server-made
 * mirror lines on Amend quotes qualify — the flag alone is never trusted
 * (client input is stripped of `_arc*` keys, and a clone of an Amend quote
 * is a new quote).
 */
export function isArcMirrorLine(configuration: Record<string, unknown> | null | undefined, quoteType: string | null | undefined): boolean {
  return (quoteType === 'amend' || quoteType === 'renew' || quoteType === 'cancel') && typeof configuration?._arcMirroredFromItemId === 'string'
}

export function isFrozenAmendMirrorLine(
  configuration: Record<string, unknown> | null | undefined,
  quoteType: string | null | undefined,
): boolean {
  return (
    quoteType === 'amend' &&
    typeof configuration?._arcMirroredFromItemId === 'string' &&
    isArcPriceFrozen(configuration)
  )
}

/**
 * Configuration for a mirror line: the item's configuration plus the ARC
 * markers. Only Amend lines are frozen — Renew re-prices by product decision
 * and Cancel lines are not priced.
 */
export function buildArcMirrorConfiguration(
  itemConfiguration: Record<string, unknown> | null | undefined,
  item: { id: string; name: string },
  quoteType: ArcMirrorQuoteType,
): Record<string, unknown> {
  return {
    // An item's configuration can carry markers from an earlier ARC quote
    // (activation copies line configuration onto the item); never inherit them.
    ...stripArcMarkers(itemConfiguration),
    _arcMirroredFromItemId: item.id,
    _arcMirroredName: item.name,
    ...(quoteType === 'amend' ? { [ARC_PRICE_FROZEN_KEY]: true } : {}),
  }
}

/**
 * Line configuration as it may leave the quote (order lines, subscription
 * items, clones): quote-only pricing markers are dropped; the descriptive
 * `_arcMirrored*` markers stay.
 */
export function stripQuoteOnlyArcMarkers(
  configuration: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!configuration || !QUOTE_ONLY_ARC_KEYS.some((key) => key in configuration)) return configuration
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(configuration)) {
    if (!(QUOTE_ONLY_ARC_KEYS as readonly string[]).includes(key)) out[key] = value
  }
  return out
}

/**
 * Configuration without any `_arc*` marker. ARC markers are server-owned:
 * client-supplied configuration goes through this before it is stored.
 */
export function stripArcMarkers(configuration: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(configuration ?? {})) {
    if (!key.startsWith(ARC_MARKER_PREFIX)) out[key] = value
  }
  return out
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export type ArcLinePricingState = {
  configuration: Record<string, unknown> | null | undefined
  quantity: number
  termMonths?: number | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  usageEstimates?: Array<{ chargeCode: string; estimatedQuantity: number }> | null
}

export type ArcLinePricingUpdate = {
  configuration: Record<string, unknown>
  quantity?: number
  termMonths?: number
  startDate?: string
  endDate?: string
  usageEstimates?: Array<{ chargeCode: string; estimatedQuantity: number }>
}

/**
 * Whether an update changes any input the pricing engine reads. The quote UI
 * always resubmits the full configuration, so "a field was sent" is not a
 * change — values are compared (ARC markers ignored, key order ignored).
 * Fields the update omits keep their stored value.
 */
export function arcPricingInputsChanged(before: ArcLinePricingState, update: ArcLinePricingUpdate): boolean {
  if (canonical(stripArcMarkers(before.configuration)) !== canonical(stripArcMarkers(update.configuration))) {
    return true
  }
  if (update.quantity !== undefined && update.quantity !== before.quantity) return true
  if (update.termMonths !== undefined && update.termMonths !== (before.termMonths ?? undefined)) return true
  if (update.startDate !== undefined && isoDay(update.startDate) !== isoDay(before.startDate)) return true
  if (update.endDate !== undefined && isoDay(update.endDate) !== isoDay(before.endDate)) return true
  if (update.usageEstimates !== undefined) {
    const normalize = (list: Array<{ chargeCode: string; estimatedQuantity: number }> | null | undefined) =>
      canonical(
        [...(list ?? [])]
          .map((e) => ({ chargeCode: e.chargeCode, estimatedQuantity: e.estimatedQuantity }))
          .sort((a, b) => a.chargeCode.localeCompare(b.chargeCode)),
      )
    if (normalize(update.usageEstimates) !== normalize(before.usageEstimates)) return true
  }
  return false
}
