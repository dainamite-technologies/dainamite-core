import { canonicalJson as canonical } from '../lib/stateHash'

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

/**
 * Set on a Renew mirror line of a cost-plus item (feature spec Q4) beside `_arcPriceFrozen`: the frozen
 * Renew line keeps its contracted charges until the rep reconfigures it.
 */
export const ARC_COST_PLUS_FROZEN_KEY = '_arcCostPlusFrozen'

/**
 * Set when a mirror line's pricing inputs change (Amend or Renew; un-freezing an Amend or cost-plus Renew
 * line sets it too). Only a mirror line carrying it gets catalog cost lines (Q13) and writes costs back at
 * activation (Q5).
 */
export const ARC_RECONFIGURED_KEY = '_arcReconfigured'

/**
 * Set on an ARC mirror line whose subscription item costs are carried onto the quote (ARC costs spec Q5): the
 * line is cost-managed and always syncs by `replace` at activation. Written by `carryItemCosts` (spec step 6).
 */
export const ARC_COSTS_CARRIED_KEY = '_arcCostsCarried'

/** `itemCostSetHash` of the item's open costs at mirroring: the baseline of the `COST_SOURCE_CHANGED` guard (I-12). */
export const ARC_CARRIED_COST_SET_HASH_KEY = '_arcCarriedCostSetHash'

/**
 * Set on an ORDER line at conversion: `_arcCarriedCostSetHash` as it was then. Activation compares the subscription's open
 * item costs with this frozen value, so nothing that happens to the quote afterwards can reset the I-12 baseline.
 */
export const ARC_CONVERTED_COST_SET_HASH_KEY = '_arcConvertedCostSetHash'

/** Markers that describe quote-time pricing state and never leave the quote. */
const QUOTE_ONLY_ARC_KEYS = [
  ARC_PRICE_FROZEN_KEY, ARC_REPRICED_KEY, ARC_COST_PLUS_FROZEN_KEY, ARC_RECONFIGURED_KEY, ARC_COSTS_CARRIED_KEY, ARC_CARRIED_COST_SET_HASH_KEY,
  ARC_CONVERTED_COST_SET_HASH_KEY,
] as const

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

/**
 * A mirror line that keeps the item's stored charges: an Amend mirror line carrying `_arcPriceFrozen`, or a
 * Renew mirror line carrying both `_arcPriceFrozen` and `_arcCostPlusFrozen` (a cost-plus item, Q4).
 */
export function isFrozenMirrorLine(
  configuration: Record<string, unknown> | null | undefined,
  quoteType: string | null | undefined,
): boolean {
  if (typeof configuration?._arcMirroredFromItemId !== 'string' || !isArcPriceFrozen(configuration)) return false
  return quoteType === 'amend' || (quoteType === 'renew' && configuration?.[ARC_COST_PLUS_FROZEN_KEY] === true)
}

/** Whether a mirror line was reconfigured (a pricing input changed): the only mirror line kind with catalog cost lines. */
export function isArcReconfigured(configuration: Record<string, unknown> | null | undefined): boolean {
  return configuration?.[ARC_RECONFIGURED_KEY] === true
}

/**
 * A cost-managed STANDALONE Renew mirror line (ARC costs spec, R1c): a Renew mirror that is not frozen and carries
 * `_arcCostsCarried` (set on every standalone Renew mirror, even for an item with no open costs). Its costs are
 * reconciled with today's catalog on every saved recalculation. Phase 1 frozen lines and merge-renew lines never match.
 */
export function isCostManagedRenewLine(
  configuration: Record<string, unknown> | null | undefined,
  quoteType: string | null | undefined,
): boolean {
  return quoteType === 'renew' && typeof configuration?._arcMirroredFromItemId === 'string'
    && configuration?.[ARC_COSTS_CARRIED_KEY] === true && !isArcPriceFrozen(configuration)
}

/**
 * Configuration for a mirror line: the item's configuration plus the ARC
 * markers. Amend lines are frozen; a merge-Renew line is frozen only for a cost-plus
 * item (`options.costPlus` + `options.mergeMode`, ARC costs spec Q10); a STANDALONE Renew line is no longer frozen
 * (ARC costs spec, "Renew mirror line pricing": it is re-priced at today's standard from reconciled costs).
 * Cancel lines are not priced.
 */
export function buildArcMirrorConfiguration(
  itemConfiguration: Record<string, unknown> | null | undefined,
  item: { id: string; name: string },
  quoteType: ArcMirrorQuoteType,
  options: { costPlus?: boolean; mergeMode?: boolean } = {},
): Record<string, unknown> {
  return {
    // An item's configuration can carry markers from an earlier ARC quote
    // (activation copies line configuration onto the item); never inherit them.
    ...stripArcMarkers(itemConfiguration),
    _arcMirroredFromItemId: item.id,
    _arcMirroredName: item.name,
    ...(quoteType === 'amend' ? { [ARC_PRICE_FROZEN_KEY]: true } : {}),
    ...(quoteType === 'renew' && options.costPlus === true && options.mergeMode === true
      ? { [ARC_PRICE_FROZEN_KEY]: true, [ARC_COST_PLUS_FROZEN_KEY]: true }
      : {}),
  }
}

/**
 * Line configuration as an API response carries it: the I-12 baseline hash is internal (an unsalted hash over cost values
 * is a guess-confirmation oracle for confidential costs) and never leaves the server. Nothing client-side reads it.
 */
export function stripCostHashMarkers(
  configuration: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!configuration || !(ARC_CARRIED_COST_SET_HASH_KEY in configuration || ARC_CONVERTED_COST_SET_HASH_KEY in configuration)) return configuration
  const { [ARC_CARRIED_COST_SET_HASH_KEY]: _carried, [ARC_CONVERTED_COST_SET_HASH_KEY]: _converted, ...rest } = configuration
  return rest
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
