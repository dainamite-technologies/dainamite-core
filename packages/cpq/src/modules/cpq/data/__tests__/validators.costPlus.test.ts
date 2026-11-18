import {
  chargePricingShapeIssues,
  cpqProductChargeCreateSchema,
  cpqProductChargeUpdateSchema,
} from '../validators'

const costPlus = {
  productId: '11111111-1111-4111-8111-111111111111',
  code: 'tail_mrc',
  name: 'Partner tail',
  chargeType: 'mrc' as const,
  chargeModel: 'flat' as const,
  pricingMethod: 'cost_plus' as const,
  markupRule: 'markup_percent' as const,
  markupValue: 25,
}

function issuePaths(input: unknown): string[] {
  const result = cpqProductChargeCreateSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('V-CHG-1 cost-plus shape (cpqProductChargeCreateSchema)', () => {
  it('accepts a flat cost-plus charge with a markup rule and value', () => {
    const result = cpqProductChargeCreateSchema.safeParse(costPlus)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toMatchObject({ pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: 25 })
  })

  it.each(['markup_percent', 'target_margin_percent', 'markup_absolute'] as const)('accepts markup rule %s', (markupRule) => {
    expect(issuePaths({ ...costPlus, markupRule, currencyCode: 'EUR' })).toEqual([])
  })

  it.each(['nrc', 'mrc'] as const)('accepts chargeType %s', (chargeType) => {
    expect(issuePaths({ ...costPlus, chargeType })).toEqual([])
  })

  it('rejects usage charges', () => {
    expect(issuePaths({ ...costPlus, chargeType: 'usage' })).toEqual(['chargeType'])
  })

  it.each(['volume', 'tiered'] as const)('rejects chargeModel %s', (chargeModel) => {
    expect(issuePaths({ ...costPlus, chargeModel, quantityAttributeCode: 'qty' })).toEqual(['chargeModel'])
  })

  it('requires a quantity attribute for per_unit and forbids it for flat', () => {
    expect(issuePaths({ ...costPlus, chargeModel: 'per_unit' })).toEqual(['quantityAttributeCode'])
    expect(issuePaths({ ...costPlus, chargeModel: 'per_unit', quantityAttributeCode: 'ports' })).toEqual([])
    expect(issuePaths({ ...costPlus, quantityAttributeCode: 'ports' })).toEqual(['quantityAttributeCode'])
  })

  it('requires markupRule and markupValue', () => {
    expect(issuePaths({ ...costPlus, markupRule: undefined, markupValue: undefined }).sort()).toEqual(['markupRule', 'markupValue'])
  })

  it.each([[-1, 'markupValue'], [0.00001, 'markupValue']])('rejects markupValue %s', (markupValue, path) => {
    expect(issuePaths({ ...costPlus, markupValue })).toContain(path)
  })

  it('accepts a numeric string markup value and a zero markup', () => {
    expect(issuePaths({ ...costPlus, markupValue: '12.5' })).toEqual([])
    expect(issuePaths({ ...costPlus, markupValue: 0 })).toEqual([])
  })

  it('caps a target margin below 100%', () => {
    expect(issuePaths({ ...costPlus, markupRule: 'target_margin_percent', markupValue: 100 })).toEqual(['markupValue'])
    expect(issuePaths({ ...costPlus, markupRule: 'target_margin_percent', markupValue: 99.99 })).toEqual([])
    // Only target margins are capped; a 150% markup is valid.
    expect(issuePaths({ ...costPlus, markupValue: 150 })).toEqual([])
  })

  it('forbids table lookup fields', () => {
    expect(issuePaths({ ...costPlus, pricingTableId: '22222222-2222-4222-8222-222222222222', priceColumnKey: 'mrc' }).sort())
      .toEqual(['priceColumnKey', 'pricingTableId'])
  })

  it('requires a currency with an absolute markup or a fallback price', () => {
    expect(issuePaths({ ...costPlus, markupRule: 'markup_absolute', markupValue: 50 })).toEqual(['currencyCode'])
    expect(issuePaths({ ...costPlus, fixedPrice: '499' })).toEqual(['currencyCode'])
    expect(issuePaths({ ...costPlus, fixedPrice: '499', currencyCode: 'EUR' })).toEqual([])
  })

  it.each(['fixed', 'table'] as const)('forbids markup fields on a %s charge', (pricingMethod) => {
    const base = pricingMethod === 'fixed'
      ? { fixedPrice: '10', currencyCode: 'EUR' }
      : { pricingTableId: '22222222-2222-4222-8222-222222222222', priceColumnKey: 'mrc' }
    expect(issuePaths({ ...costPlus, ...base, pricingMethod }).sort()).toEqual(['markupRule', 'markupValue'])
    expect(issuePaths({ ...costPlus, ...base, pricingMethod, markupRule: null, markupValue: null })).toEqual([])
  })
})

describe('cpqProductChargeUpdateSchema (cost-plus)', () => {
  it('refines a cost-plus switch in the patch', () => {
    const result = cpqProductChargeUpdateSchema.safeParse({ id: '33333333-3333-4333-8333-333333333333', pricingMethod: 'cost_plus' })
    expect(result.success).toBe(false)
  })

  it('lets a markup-only patch through to the route merge check', () => {
    expect(cpqProductChargeUpdateSchema.safeParse({ id: '33333333-3333-4333-8333-333333333333', markupValue: 30 }).success).toBe(true)
  })
})

describe('chargePricingShapeIssues (merged charge)', () => {
  it('returns no issues for a valid merged cost-plus charge', () => {
    expect(chargePricingShapeIssues({ ...costPlus, markupValue: '25.0000' })).toEqual([])
  })

  it('reports markup on a merged fixed charge', () => {
    const issues = chargePricingShapeIssues({ chargeType: 'mrc', pricingMethod: 'fixed', chargeModel: 'flat', fixedPrice: '10', currencyCode: 'EUR', markupValue: 5 })
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['markupValue'])
  })
})
