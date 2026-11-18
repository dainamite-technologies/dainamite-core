import type { ValidationError } from '../services/types'

/**
 * V-LINE-1 — the offering defines charges, but none of them applies to this
 * line's configuration (every applicability condition evaluated false). The
 * line would otherwise be quoted at 0 without saying why.
 */
export const NO_APPLICABLE_CHARGE_CODE = 'V-LINE-1'

export type LineCompletenessInput = {
  lineId: string
  /** Attribute validation errors for the line's configuration. */
  attributeErrors: ValidationError[]
  /** Bundle slot cardinality errors raised on this line (V-QBUN-*). */
  bundleSlotErrors?: ValidationError[]
  /** Number of charges the pricing engine resolved for the line. */
  chargeCount: number
  /**
   * Whether the line's offering (or, without an offering, its product)
   * defines any active charge. `false` means the item is intentionally
   * free — e.g. included equipment — and a valid line is complete at 0.
   */
  hasChargeDefinitions: boolean
  /** The bundle line itself: its price lives on its component lines. */
  isBundleOffering: boolean
  /** XD-250 ARC line mirrored from a subscription item (carries its own charges). */
  isArcMirrored: boolean
  /** XD-250 ARC line marked for removal: it adds nothing and is complete. */
  isArcCancelled: boolean
}

export type LineCompletenessResult = {
  isConfigured: boolean
  /** Every error that explains why the line is not configured (empty when it is). */
  errors: ValidationError[]
}

/**
 * The single rule for a quote line's "configured" state. `recalculateInternal`
 * is the only caller: every quote write ends there and persists its result.
 *
 * A line that is not configured always carries at least one error naming the
 * reason (#125) — never a silent "incomplete".
 *
 * Price-adjustment errors are applied by the caller afterwards (they need the
 * whole quote's adjustment set) and can still turn a configured line
 * incomplete.
 */
export function evaluateLineCompleteness(input: LineCompletenessInput): LineCompletenessResult {
  if (input.isArcCancelled) return { isConfigured: true, errors: [] }

  const errors: ValidationError[] = [...input.attributeErrors, ...(input.bundleSlotErrors ?? [])]
  if (errors.length > 0) return { isConfigured: false, errors }

  const priced =
    input.chargeCount > 0 ||
    input.isArcMirrored ||
    input.isBundleOffering ||
    !input.hasChargeDefinitions
  if (priced) return { isConfigured: true, errors: [] }

  return {
    isConfigured: false,
    errors: [
      {
        lineId: input.lineId,
        type: 'charge',
        message: `${NO_APPLICABLE_CHARGE_CODE}: No charge of this offering applies to the line's configuration`,
      },
    ],
  }
}
