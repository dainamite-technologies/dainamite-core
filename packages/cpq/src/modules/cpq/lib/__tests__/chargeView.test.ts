import { anyChargeHasMarkup, chargeMarkupFields, withoutChargeMarkup } from '../chargeView'

describe('chargeView markup redaction', () => {
  const charge = { code: 'tail', pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: '25.0000' }

  it('returns markup fields only with cpq.costs.view', () => {
    expect(chargeMarkupFields(charge, false)).toEqual({})
    expect(chargeMarkupFields(charge, true)).toEqual({ markupRule: 'markup_percent', markupValue: '25.0000' })
    expect(chargeMarkupFields({}, true)).toEqual({ markupRule: null, markupValue: null })
  })

  it('copies a record without markup and leaves the original intact', () => {
    expect(withoutChargeMarkup(charge)).toEqual({ code: 'tail', pricingMethod: 'cost_plus' })
    expect(charge.markupValue).toBe('25.0000')
  })

  it('detects whether any charge carries markup', () => {
    expect(anyChargeHasMarkup([{ markupRule: null, markupValue: null }, {}])).toBe(false)
    expect(anyChargeHasMarkup([{}, { markupValue: '0.0000' }])).toBe(true)
  })
})
