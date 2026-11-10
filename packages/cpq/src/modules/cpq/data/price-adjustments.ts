import { z } from 'zod'

export const adjustmentTypeSchema = z.enum(['discount_percent', 'discount_absolute', 'price_override'])
const adjustmentFields = {
  adjustmentType: adjustmentTypeSchema,
  value: z.number().finite().min(0),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullish(),
  chargeTypeFilter: z.enum(['nrc', 'mrc']).nullish(),
  reasonCode: z.string().trim().min(1).max(100),
  reasonNote: z.string().trim().max(500).nullish(),
  expectedRevision: z.number().int().min(0).optional(),
}
export const cpqPriceAdjustmentInputSchema = z.object({
  ...adjustmentFields,
  level: z.enum(['charge', 'line']),
  quoteLineId: z.string().uuid(),
  chargeCode: z.string().trim().min(1).max(255).nullish(),
  windowKind: z.literal('relative').optional(),
  fromMonth: z.literal(1).optional(),
  toMonth: z.null().optional(),
}).strict().superRefine((input, ctx) => {
  const error = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (input.level === 'charge' && !input.chargeCode) error('chargeCode', 'TARGET_NOT_FOUND')
  if (input.level === 'charge' && input.chargeTypeFilter) error('chargeTypeFilter', 'TYPE_NOT_ALLOWED')
  if (input.level === 'line' && input.chargeCode) error('chargeCode', 'TYPE_NOT_ALLOWED')
  if (input.level === 'line' && input.adjustmentType !== 'discount_percent') error('adjustmentType', 'TYPE_NOT_ALLOWED')
  if (input.adjustmentType === 'discount_percent' && (input.value <= 0 || input.value > 100)) error('value', 'INVALID_PERCENT')
  if (input.adjustmentType === 'discount_absolute' && input.value <= 0) error('value', 'INVALID_AMOUNT')
  if (input.adjustmentType !== 'discount_percent' && !input.currencyCode) error('currencyCode', 'CURRENCY_REQUIRED')
  if (input.reasonCode === 'other' && !input.reasonNote) error('reasonNote', 'REASON_NOTE_REQUIRED')
})
export const cpqPriceAdjustmentPatchSchema = z.object(adjustmentFields).partial().strict()
export type PriceAdjustmentInput = z.infer<typeof cpqPriceAdjustmentInputSchema>
export type PriceAdjustmentPatch = z.infer<typeof cpqPriceAdjustmentPatchSchema>

/** Pure pricing representation; persistence metadata stays outside the resolver. */
export const resolvedPriceAdjustmentSchema = cpqPriceAdjustmentInputSchema.safeExtend({
  id: z.string().uuid(),
  createdByUserId: z.string().uuid().optional(),
})
export type PriceAdjustment = z.infer<typeof resolvedPriceAdjustmentSchema>
export const adjustmentErrorSchema = z.object({
  adjustmentId: z.string(),
  quoteLineId: z.string(),
  chargeCode: z.string().optional(),
  code: z.enum(['ADJUSTMENT_TARGET_MISSING', 'TARGET_AMBIGUOUS', 'ABOVE_STANDARD', 'CURRENCY_MISMATCH', 'TYPE_NOT_ALLOWED', 'LINE_NOT_ELIGIBLE', 'ADJUSTMENT_OVERLAP']),
})
export type AdjustmentError = z.infer<typeof adjustmentErrorSchema>
