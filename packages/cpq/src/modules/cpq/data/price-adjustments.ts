import { z } from 'zod'
import { MAX_PHASE_MONTH, isPhasedRange } from '../lib/priceSchedule'

export const adjustmentTypeSchema = z.enum(['discount_percent', 'discount_absolute', 'price_override'])
  .describe('price_override = set a price (charge: new unit price, or the charge total on volume / tiered charges; line: the line\'s recurring or one-time total). discount_percent = % off the standard price. discount_absolute = amount off the charge total (charge) or the line\'s recurring or one-time total (line). Any price is allowed, also above the standard price.')
/** Line-level types whose amount spans one charge type: they need `chargeTypeFilter` (spec F, rule "Recurring or One-time"). */
export const LINE_AMOUNT_TYPES = ['price_override', 'discount_absolute'] as const
const adjustmentFields = {
  adjustmentType: adjustmentTypeSchema,
  // Match numeric(18,4), so saving never silently rounds the previewed input.
  value: z.number().finite().min(0).max(99_999_999_999_999).multipleOf(0.0001)
    .describe('Percent (0–100] for discount_percent; otherwise an amount in the quote currency. A line-level amount is the line total (all line quantities); a Set price of 0 makes it free.'),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullish().describe('Quote currency; required for price_override and discount_absolute.'),
  chargeTypeFilter: z.enum(['nrc', 'mrc']).nullish()
    .describe('Line level only. mrc = recurring, nrc = one-time; omitted = both (discount_percent only). Required for a line-level price_override or discount_absolute.'),
  reasonCode: z.string().trim().min(1).max(100).describe('Value from the cpq.price_adjustment_reason dictionary.'),
  reasonNote: z.string().trim().max(500).nullish().describe('Required when reasonCode is "other".'),
  expectedRevision: z.number().int().min(0).optional().describe('Quote pricingRevision the caller saw; a mismatch answers 409 STALE_REVISION.'),
  // Price phases spec (Phase 2, D4 / D7): a month range makes the adjustment a phase.
  windowKind: z.literal('relative').optional().describe('Months are counted from the subscription start (the only kind).'),
  fromMonth: z.number().int().min(1).max(MAX_PHASE_MONTH).optional()
    .describe('First month the adjustment prices (1 = from the start). Default 1. With toMonth (or fromMonth > 1) it is a phase: recurring (MRC) prices only.'),
  toMonth: z.number().int().min(1).max(MAX_PHASE_MONTH).nullish()
    .describe('Last month the adjustment prices (inclusive); null = to the end. Must not pass the line term.'),
  phaseName: z.string().trim().max(100).nullish().describe('Optional phase name sent to billing, e.g. "Free trial", "Year 1".'),
}
export const cpqPriceAdjustmentInputSchema = z.object({
  ...adjustmentFields,
  level: z.enum(['charge', 'line']),
  quoteLineId: z.string().uuid(),
  chargeCode: z.string().trim().min(1).max(255).nullish(),
}).strict().superRefine((input, ctx) => {
  const error = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (input.level === 'charge' && !input.chargeCode) error('chargeCode', 'TARGET_NOT_FOUND')
  if (input.level === 'charge' && input.chargeTypeFilter) error('chargeTypeFilter', 'TYPE_NOT_ALLOWED')
  if (input.level === 'line' && input.chargeCode) error('chargeCode', 'TYPE_NOT_ALLOWED')
  if (input.level === 'line' && isLineAmountType(input.adjustmentType) && !input.chargeTypeFilter) error('chargeTypeFilter', 'CHARGE_TYPE_REQUIRED')
  if (input.adjustmentType === 'discount_percent' && (input.value <= 0 || input.value > 100)) error('value', 'INVALID_PERCENT')
  if (input.adjustmentType === 'discount_absolute' && input.value <= 0) error('value', 'INVALID_AMOUNT')
  if (input.adjustmentType !== 'discount_percent' && !input.currencyCode) error('currencyCode', 'CURRENCY_REQUIRED')
  if (input.reasonCode === 'other' && !input.reasonNote) error('reasonNote', 'REASON_NOTE_REQUIRED')
  if (input.toMonth != null && input.toMonth < (input.fromMonth ?? 1)) error('toMonth', 'PHASE_RANGE_INVALID')
  // Phases price recurring charges only; a charge-level target is checked against its charge type when priced.
  if (input.level === 'line' && isPhasedRange(input) && input.chargeTypeFilter !== 'mrc') error('chargeTypeFilter', 'PHASE_RECURRING_ONLY')
})
export function isLineAmountType(type: string): type is (typeof LINE_AMOUNT_TYPES)[number] {
  return (LINE_AMOUNT_TYPES as readonly string[]).includes(type)
}
export const cpqPriceAdjustmentPatchSchema = z.object(adjustmentFields).partial().strict()
export type PriceAdjustmentInput = z.infer<typeof cpqPriceAdjustmentInputSchema>
export type PriceAdjustmentPatch = z.infer<typeof cpqPriceAdjustmentPatchSchema>

/** Pure pricing representation; persistence metadata stays outside the resolver. */
export const resolvedPriceAdjustmentSchema = z.object({
  ...cpqPriceAdjustmentInputSchema.shape,
  id: z.string().uuid(),
  createdByUserId: z.string().uuid().optional(),
})
export type PriceAdjustment = z.infer<typeof resolvedPriceAdjustmentSchema>
export const adjustmentErrorSchema = z.object({
  adjustmentId: z.string(),
  quoteLineId: z.string(),
  chargeCode: z.string().optional(),
  // ABOVE_STANDARD is no longer raised (spec F-D1); kept so stored validation errors still parse.
  code: z.enum(['ADJUSTMENT_TARGET_MISSING', 'TARGET_AMBIGUOUS', 'ABOVE_STANDARD', 'CURRENCY_MISMATCH', 'TYPE_NOT_ALLOWED', 'LINE_NOT_ELIGIBLE', 'ADJUSTMENT_OVERLAP',
    // Price phases: a phase on a non-recurring charge, or past the line's term.
    'PHASE_RECURRING_ONLY', 'PHASE_PAST_TERM']),
})
export type AdjustmentError = z.infer<typeof adjustmentErrorSchema>

export const cpqPriceAdjustmentPreviewSchema = z.object({
  draft: cpqPriceAdjustmentInputSchema,
  replaceAdjustmentId: z.string().uuid().optional(),
}).strict()

export const ADJUSTMENT_TOGGLE = 'cpq.manual_price_adjustments'
export const REASON_DICTIONARY = 'cpq.price_adjustment_reason'
export const DEFAULT_ADJUSTMENT_REASONS = [
  { value: 'competitive_match', label: 'Competitive match' },
  { value: 'volume_commitment', label: 'Volume commitment' },
  { value: 'loyalty', label: 'Loyalty' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'strategic_deal', label: 'Strategic deal' },
  { value: 'price_correction', label: 'Price correction' },
  { value: 'other', label: 'Other' },
] as const
