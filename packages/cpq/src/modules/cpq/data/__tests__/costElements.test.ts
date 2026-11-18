import {
  costElementContextError,
  costElementIndexError,
  costElementShapeError,
  cpqChargeCostElementCreateSchema,
  cpqChargeCostElementUpdateSchema,
  type CostElementShape,
} from '../costs'

const chargeId = '11111111-1111-4111-8111-111111111111'
const tableId = '22222222-2222-4222-8222-222222222222'
const fixed: CostElementShape = { role: 'margin_only', costType: 'nrc', source: 'fixed', costModel: 'flat', amount: 100, currencyCode: 'EUR' }
const table: CostElementShape = { role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', costTableId: tableId, costColumnKey: 'mrc' }
const indexElement: CostElementShape = { role: 'price_basis', costType: 'mrc', source: 'index', costModel: 'flat', costIndexId: tableId, indexFactor: 0.5, indexOffset: 2 }
const onRequest: CostElementShape = { role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat' }

describe('cpqChargeCostElementCreateSchema', () => {
  const valid = { productChargeId: chargeId, code: 'tail', name: 'Last-mile tail', ...onRequest, estimateAmount: 300, currencyCode: 'EUR' }

  it('parses a valid element', () => {
    expect(cpqChargeCostElementCreateSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['code', ''], ['code', 'has space'], ['name', ''], ['role', 'other'], ['costType', 'usage'],
    ['source', 'catalog'], ['costModel', 'stepped'], ['currencyCode', 'eur'], ['amount', -1],
    ['estimateAmount', 0.00001], ['defaultValidityDays', 0], ['costTableId', 'not-a-uuid'],
  ])('rejects %s = %j', (field, value) => {
    const result = cpqChargeCostElementCreateSchema.safeParse({ ...valid, [field]: value })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path[0]).toBe(field)
  })

  it('rejects unknown fields', () => {
    expect(cpqChargeCostElementCreateSchema.safeParse({ ...valid, bogus: 1 }).success).toBe(false)
  })

  it('parses an index element (factor, offset optional) and bounds factor > 0, offset >= 0', () => {
    const index = { productChargeId: chargeId, code: 'power', name: 'Power', ...indexElement }
    expect(cpqChargeCostElementCreateSchema.safeParse(index).success).toBe(true)
    expect(cpqChargeCostElementCreateSchema.safeParse({ ...index, indexFactor: undefined, indexOffset: undefined }).success).toBe(true)
    for (const [field, value] of [['indexFactor', 0], ['indexFactor', -1], ['indexFactor', 0.0000001], ['indexOffset', -0.0001], ['indexOffset', 0.00001], ['costIndexId', 'nope']] as const) {
      const result = cpqChargeCostElementCreateSchema.safeParse({ ...index, [field]: value })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0].path[0]).toBe(field)
    }
  })
})

describe('cpqChargeCostElementUpdateSchema', () => {
  it('accepts a partial patch', () => {
    expect(cpqChargeCostElementUpdateSchema.safeParse({ id: chargeId, isActive: false }).success).toBe(true)
  })

  it.each(['code', 'productChargeId'])('refuses the immutable field %s', (field) => {
    expect(cpqChargeCostElementUpdateSchema.safeParse({ id: chargeId, [field]: field === 'code' ? 'new' : tableId }).success).toBe(false)
  })
})

describe('costElementShapeError (§1.4.4 field rules)', () => {
  it.each([
    ['a fixed amount', fixed],
    ['a table lookup', table],
    ['on_request without estimate', onRequest],
    ['on_request with estimate', { ...onRequest, estimateAmount: 300, currencyCode: 'EUR' }],
    ['a tiered table lookup', { ...table, costModel: 'tiered' }],
    ['a per_unit fixed amount', { ...fixed, costModel: 'per_unit' }],
    ['an index element', indexElement],
    ['a per_unit index element', { ...indexElement, costModel: 'per_unit' }],
    ['an index element with the default factor and offset', { ...indexElement, indexFactor: undefined, indexOffset: null }],
  ])('accepts %s', (_label, element) => {
    expect(costElementShapeError(element as CostElementShape)).toBeNull()
  })

  it.each([
    ['an index element without an index', { ...indexElement, costIndexId: null }, 'INDEX_REQUIRED'],
    ['a tiered index element', { ...indexElement, costModel: 'tiered' }, 'MODEL_REQUIRES_TABLE'],
    ['a volume index element', { ...indexElement, costModel: 'volume' }, 'MODEL_REQUIRES_TABLE'],
    ['an index element with an amount', { ...indexElement, amount: 5 }, 'FIELD_NOT_ALLOWED'],
    ['an index element with a currency', { ...indexElement, currencyCode: 'EUR' }, 'FIELD_NOT_ALLOWED'],
    ['an index element with a table', { ...indexElement, costTableId: tableId }, 'FIELD_NOT_ALLOWED'],
    ['an index element with an estimate', { ...indexElement, estimateAmount: 5 }, 'FIELD_NOT_ALLOWED'],
    ['a fixed element with an index id', { ...fixed, costIndexId: tableId }, 'INDEX_FIELDS_NOT_ALLOWED'],
    ['a table element with a factor', { ...table, indexFactor: 1 }, 'INDEX_FIELDS_NOT_ALLOWED'],
    ['an on_request element with an offset', { ...onRequest, indexOffset: 0 }, 'INDEX_FIELDS_NOT_ALLOWED'],
    ['an unknown source', { ...fixed, source: 'catalog' }, 'SOURCE_NOT_AVAILABLE'],
    ['tiered without table', { ...fixed, costModel: 'tiered' }, 'MODEL_REQUIRES_TABLE'],
    ['volume on request', { ...onRequest, costModel: 'volume' }, 'MODEL_REQUIRES_TABLE'],
    ['fixed without amount', { ...fixed, amount: null }, 'AMOUNT_REQUIRED'],
    ['fixed without currency', { ...fixed, currencyCode: null }, 'CURRENCY_REQUIRED'],
    ['fixed with a table', { ...fixed, costTableId: tableId }, 'FIELD_NOT_ALLOWED'],
    ['fixed with an estimate', { ...fixed, estimateAmount: 5 }, 'FIELD_NOT_ALLOWED'],
    ['table without column', { ...table, costColumnKey: null }, 'TABLE_REQUIRED'],
    ['table without table id', { ...table, costTableId: undefined }, 'TABLE_REQUIRED'],
    ['table with an amount', { ...table, amount: 5 }, 'FIELD_NOT_ALLOWED'],
    ['on_request with an amount', { ...onRequest, amount: 5 }, 'FIELD_NOT_ALLOWED'],
    ['on_request estimate without currency', { ...onRequest, estimateAmount: 300 }, 'CURRENCY_REQUIRED'],
  ])('rejects %s with %s', (_label, element, code) => {
    expect(costElementShapeError(element as CostElementShape)).toBe(code)
  })

  it('costElementIndexError: a missing / deleted index is INDEX_REQUIRED, an inactive one INDEX_INACTIVE, other sources are ignored', () => {
    expect(costElementIndexError({ source: 'index' }, { isActive: true })).toBeNull()
    expect(costElementIndexError({ source: 'index' }, null)).toBe('INDEX_REQUIRED')
    expect(costElementIndexError({ source: 'index' }, { isActive: true, deletedAt: new Date() })).toBe('INDEX_REQUIRED')
    expect(costElementIndexError({ source: 'index' }, { isActive: false })).toBe('INDEX_INACTIVE')
    expect(costElementIndexError({ source: 'fixed' }, null)).toBeNull()
  })

  it('treats a zero amount as present', () => {
    expect(costElementShapeError({ ...fixed, amount: 0 })).toBeNull()
  })
})

describe('costElementContextError (§1.4.4 charge and table rules)', () => {
  const costPlusMrc = { pricingMethod: 'cost_plus', chargeType: 'mrc', quantityAttributeCode: 'ports' }
  const fixedMrc = { pricingMethod: 'fixed', chargeType: 'mrc', quantityAttributeCode: null }
  const costTable = { purpose: 'cost', priceColumns: [{ key: 'mrc' }] }

  it('accepts a price-basis table element on a cost-plus charge', () => {
    expect(costElementContextError(table, costPlusMrc, costTable)).toBeNull()
  })

  it.each([
    ['price_basis on a fixed charge', table, fixedMrc, costTable, 'PRICE_BASIS_REQUIRES_COST_PLUS'],
    ['price_basis with another cost type', { ...table, costType: 'nrc' }, costPlusMrc, costTable, 'COST_TYPE_MISMATCH'],
    ['non-flat model without a quantity attribute', { ...fixed, costModel: 'per_unit' }, fixedMrc, null, 'QUANTITY_ATTRIBUTE_REQUIRED'],
    ['a missing cost table', table, costPlusMrc, null, 'COST_TABLE_NOT_FOUND'],
    ['a price table', table, costPlusMrc, { ...costTable, purpose: 'price' }, 'WRONG_TABLE_PURPOSE'],
    ['an unknown column', { ...table, costColumnKey: 'nrc' }, costPlusMrc, costTable, 'COLUMN_NOT_FOUND'],
  ])('rejects %s with %s', (_label, element, charge, tableRow, code) => {
    expect(costElementContextError(element as CostElementShape, charge, tableRow)).toBe(code)
  })

  it('lets a margin-only element of any cost type sit on a fixed charge', () => {
    expect(costElementContextError({ ...fixed, costType: 'nrc' }, fixedMrc, null)).toBeNull()
  })
})
