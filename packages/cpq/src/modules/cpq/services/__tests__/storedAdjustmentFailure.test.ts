import { storedAdjustmentFailure } from '../priceAdjustments/storedAdjustmentFailure'
it('refuses missing charge and orphaned line targets recorded in the stored snapshot', () => {
  expect(storedAdjustmentFailure({} as never, [{ quoteLineId: 'line', charges: [], validationErrors: [{ message: 'ADJUSTMENT_TARGET_MISSING' }] }] as never)).toEqual({ lineId: 'line', code: 'ADJUSTMENT_TARGET_MISSING' })
  expect(storedAdjustmentFailure({ validationResult: { errors: [{ lineId: 'removed', message: 'ADJUSTMENT_TARGET_MISSING' }] } } as never, [])).toEqual({ lineId: 'removed', code: 'ADJUSTMENT_TARGET_MISSING' })
})
it('fails closed on malformed charge error flags without changing legacy non-adjustment validation', () => {
  expect(storedAdjustmentFailure({} as never, [{ quoteLineId: 'line', charges: [{ adjustmentErrors: [{}] }] }] as never)).toEqual({ lineId: 'line', code: 'ADJUSTMENT_INVALID' })
  expect(storedAdjustmentFailure({} as never, [{ quoteLineId: 'line', validationErrors: [{ message: 'Required attribute missing' }] }] as never)).toBe(null)
})
