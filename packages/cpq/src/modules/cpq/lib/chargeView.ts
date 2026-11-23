/**
 * Markup redaction for product-charge payloads (App Spec I-4, feature spec Q4).
 *
 * `pricingMethod: 'cost_plus'` is visible to every catalog reader — it reveals
 * no cost. `markupRule` / `markupValue` combined with a visible list price
 * would, so they are returned only to holders of `cpq.costs.view`. Every
 * response that serializes a charge goes through these helpers.
 */
export const CHARGE_MARKUP_FIELDS = ['markupRule', 'markupValue'] as const
type ChargeMarkupField = (typeof CHARGE_MARKUP_FIELDS)[number]

type ChargeMarkupSource = { markupRule?: string | null; markupValue?: string | null }

/** Markup fields to spread into a serialized charge: present only with `cpq.costs.view`. */
export function chargeMarkupFields(charge: ChargeMarkupSource, canViewCosts: boolean): Partial<Record<ChargeMarkupField, string | null>> {
  if (!canViewCosts) return {}
  return { markupRule: charge.markupRule ?? null, markupValue: charge.markupValue ?? null }
}

/** Copy of `charge` without the markup fields (for callers that return whole records). */
export function withoutChargeMarkup<T extends object>(charge: T): Omit<T, ChargeMarkupField> {
  const copy = { ...charge } as Record<string, unknown>
  for (const field of CHARGE_MARKUP_FIELDS) delete copy[field]
  return copy as Omit<T, ChargeMarkupField>
}

/** Whether any charge carries markup data, i.e. whether a costs-view check is needed at all. */
export function anyChargeHasMarkup(charges: readonly ChargeMarkupSource[]): boolean {
  return charges.some((charge) => charge.markupRule != null || charge.markupValue != null)
}
