import {
  allowedCostModels,
  buildCostElementPayload,
  costElementFormError,
  costElementToForm,
  costErrorMessage,
  costPlusAllowed,
  countActivePriceBasis,
  emptyCostElementForm,
  type CostElementRow,
} from '../costPlusView'

const row: CostElementRow = {
  id: 'e1', productChargeId: 'c1', code: 'transport', name: 'Transport', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat',
  amount: null, currencyCode: null, costTableId: 't1', costColumnKey: 'cost', estimateAmount: null, defaultSupplierName: null, defaultValidityDays: 30,
  requiresSourcing: false, isActive: true,
}

describe('costElementFormError', () => {
  it('needs a code on create and a name always', () => {
    expect(costElementFormError(emptyCostElementForm('mrc'), 'create')).toBe('CODE_REQUIRED')
    expect(costElementFormError({ ...emptyCostElementForm('mrc'), code: 'a' }, 'create')).toBe('NAME_REQUIRED')
    expect(costElementFormError({ ...emptyCostElementForm('mrc'), name: 'x' }, 'edit')).toBe('AMOUNT_REQUIRED')
  })

  it('applies the per-source rules', () => {
    const base = { ...emptyCostElementForm('mrc'), code: 'a', name: 'A' }
    expect(costElementFormError({ ...base, amount: '12.5' })).toBeNull()
    expect(costElementFormError({ ...base, amount: '12.5', currencyCode: '' })).toBe('CURRENCY_REQUIRED')
    expect(costElementFormError({ ...base, source: 'table' })).toBe('TABLE_REQUIRED')
    expect(costElementFormError({ ...base, source: 'table', costTableId: 't', costColumnKey: 'c' })).toBeNull()
    expect(costElementFormError({ ...base, source: 'on_request' })).toBeNull()
    expect(costElementFormError({ ...base, source: 'on_request', estimateAmount: '5', currencyCode: '' })).toBe('CURRENCY_REQUIRED')
    expect(costElementFormError({ ...base, amount: 'abc' })).toBe('AMOUNT_INVALID')
    expect(costElementFormError({ ...base, costModel: 'tiered' })).toBe('MODEL_REQUIRES_TABLE')
  })
})

describe('buildCostElementPayload', () => {
  it('nulls the fields of the other sources so an edit clears them', () => {
    const form = { ...costElementToForm(row), source: 'fixed' as const, amount: '10', currencyCode: 'EUR' }
    expect(buildCostElementPayload(form, 'edit', { id: 'e1' })).toMatchObject({
      id: 'e1', source: 'fixed', amount: 10, currencyCode: 'EUR', costTableId: null, costColumnKey: null, estimateAmount: null, defaultValidityDays: 30,
    })
  })

  it('sends the charge id and code on create only', () => {
    const form = { ...costElementToForm(row), code: ' transport ' }
    const created = buildCostElementPayload(form, 'create', { productChargeId: 'c1' })
    expect(created).toMatchObject({ productChargeId: 'c1', code: 'transport', source: 'table', costTableId: 't1', amount: null })
    expect(buildCostElementPayload(form, 'edit', { id: 'e1' })).not.toHaveProperty('code')
  })

  it('keeps the currency of an on-request cost only when an estimate is given', () => {
    const base = { ...emptyCostElementForm('mrc'), source: 'on_request' as const, name: 'S', currencyCode: 'USD' }
    expect(buildCostElementPayload(base, 'edit', { id: 'e' })).toMatchObject({ estimateAmount: null, currencyCode: null })
    expect(buildCostElementPayload({ ...base, estimateAmount: '7' }, 'edit', { id: 'e' })).toMatchObject({ estimateAmount: 7, currencyCode: 'USD' })
  })
})

describe('small helpers', () => {
  it('defaults new elements to margin-only on a charge that is not cost-plus', () => {
    expect(emptyCostElementForm('nrc', 'EUR', false)).toMatchObject({ role: 'margin_only', costType: 'nrc', currencyCode: 'EUR' })
    expect(emptyCostElementForm('mrc').role).toBe('price_basis')
  })
  it('offers per-unit / tiered / volume only with a quantity attribute', () => {
    expect(allowedCostModels(null)).toEqual(['flat'])
    expect(allowedCostModels('seats')).toContain('tiered')
  })
  it('allows cost-plus for flat / per-unit NRC and MRC charges only', () => {
    expect(costPlusAllowed({ chargeType: 'mrc', chargeModel: 'flat' })).toBe(true)
    expect(costPlusAllowed({ chargeType: 'nrc', chargeModel: null })).toBe(true)
    expect(costPlusAllowed({ chargeType: 'usage', chargeModel: 'flat' })).toBe(false)
    expect(costPlusAllowed({ chargeType: 'mrc', chargeModel: 'tiered' })).toBe(false)
  })
  it('counts active price-basis elements', () => {
    expect(countActivePriceBasis([row, { ...row, isActive: false }, { ...row, role: 'margin_only' }])).toBe(1)
  })
  it('maps rule codes to text and passes unknown codes through', () => {
    expect(costErrorMessage('NO_PRICE_BASIS_ELEMENT')).toMatch(/price-basis/)
    expect(costErrorMessage('WEIRD')).toBe('WEIRD')
    expect(costErrorMessage(null, 'x')).toBe('x')
  })
})
