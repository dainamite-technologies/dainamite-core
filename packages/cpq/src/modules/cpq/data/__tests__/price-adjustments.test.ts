import { cpqPriceAdjustmentInputSchema, cpqPriceAdjustmentPatchSchema } from '../price-adjustments'
const valid = {
  level: 'charge', quoteLineId: '11111111-1111-4111-8111-111111111111', chargeCode: 'setup',
  adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match',
}
it('allows a zero override and percentage discounts with no currency', () => {
  expect(cpqPriceAdjustmentInputSchema.parse({ ...valid, value: 0 }).value).toBe(0)
  expect(cpqPriceAdjustmentInputSchema.parse({ ...valid, adjustmentType: 'discount_percent', value: 100, currencyCode: undefined }).value).toBe(100)
})
it.each([
  { level: 'quote' }, { quoteLineId: 'bad' }, { chargeCode: null }, { value: -1 }, { value: Infinity },
  { adjustmentType: 'discount_percent', value: 101 }, { adjustmentType: 'discount_percent', value: 0 },
  { adjustmentType: 'discount_absolute', value: 0 }, { currencyCode: null }, { currencyCode: 'usd' },
  { reasonCode: 'other', reasonNote: '' }, { reasonNote: 'x'.repeat(501) },
  { fromMonth: 2 }, { toMonth: 3 }, { windowKind: 'absolute' },
  { level: 'line', chargeCode: undefined, adjustmentType: 'price_override' }, { chargeTypeFilter: 'mrc' },
])('rejects malformed or unsupported adjustments: %j', (patch) => {
  expect(cpqPriceAdjustmentInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
})
it('accepts filtered line percentages and an explanation for other', () => {
  expect(cpqPriceAdjustmentInputSchema.safeParse({ ...valid, level: 'line', chargeCode: undefined, chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: 20, reasonCode: 'other', reasonNote: 'One-time negotiation' }).success).toBe(true)
})
it('never accepts target changes through PATCH; merged patches are validated by the full schema', () => {
  expect(cpqPriceAdjustmentPatchSchema.safeParse({ quoteLineId: valid.quoteLineId }).success).toBe(false)
  expect(cpqPriceAdjustmentPatchSchema.parse({ reasonNote: 'New note' })).toEqual({ reasonNote: 'New note' })
})
