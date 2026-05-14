import {
  cpqProductSpecificationCreateSchema,
  cpqProductSpecificationUpdateSchema,
  cpqProductOfferingCreateSchema,
  cpqBundleSlotCreateSchema,
  cpqProductRelationshipCreateSchema,
  cpqProductAttributeCreateSchema,
  cpqProductChargeCreateSchema,
  cpqPriceRuleCreateSchema,
  cpqPricingTableCreateSchema,
  cpqPricingTableEntryCreateSchema,
  cpqCreateQuoteSchema,
  cpqAddQuoteItemSchema,
  cpqUpdateQuoteItemSchema,
  cpqRecalculateSchema,
  cpqTransitionStatusSchema,
  cpqValidateRelationshipsSchema,
  cpqPricePreviewSchema,
  cpqWizardDefinitionCreateSchema,
  cpqInventorySubscriptionCreateSchema,
  cpqInventoryAssetCreateSchema,
  cpqConvertQuoteToOrderSchema,
  cpqOrderStatusTransitionSchema,
} from '../validators'

const VALID_UUID = '11111111-1111-4111-8111-111111111111'
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222'

describe('cpqProductSpecificationCreateSchema', () => {
  it('parses a minimal valid input and applies defaults', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({
      code: 'GIX-ACCESS-PORT',
      name: 'GIX Access Port',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({
      code: 'GIX-ACCESS-PORT',
      name: 'GIX Access Port',
      specType: 'simple',
      isAssetizable: false,
      lifecycleStatus: 'draft',
      version: 1,
      isActive: true,
    })
  })

  it('rejects missing code', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({ name: 'No Code' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'code')).toBe(true)
  })

  it('rejects an empty code (min(1))', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({ code: '', name: 'X' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'code')).toBe(true)
  })

  it('rejects an unknown specType enum value', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      specType: 'composite',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'specType')).toBe(true)
  })

  it('accepts both bundle and simple specTypes', () => {
    expect(
      cpqProductSpecificationCreateSchema.safeParse({ code: 'A', name: 'A', specType: 'simple' }).success,
    ).toBe(true)
    expect(
      cpqProductSpecificationCreateSchema.safeParse({ code: 'A', name: 'A', specType: 'bundle' }).success,
    ).toBe(true)
  })

  it('rejects invalid productId UUID', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      productId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'productId')).toBe(true)
  })

  it('rejects invalid datetime format on effectiveFrom', () => {
    const result = cpqProductSpecificationCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      effectiveFrom: '2026-04-28', // not a full ISO datetime
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'effectiveFrom')).toBe(true)
  })
})

describe('cpqProductSpecificationUpdateSchema', () => {
  it('requires id', () => {
    const result = cpqProductSpecificationUpdateSchema.safeParse({ name: 'New Name' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'id')).toBe(true)
  })

  it('accepts id with partial fields', () => {
    const result = cpqProductSpecificationUpdateSchema.safeParse({
      id: VALID_UUID,
      name: 'New Name',
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqProductOfferingCreateSchema', () => {
  it('requires specId UUID', () => {
    const result = cpqProductOfferingCreateSchema.safeParse({
      code: 'O',
      name: 'O',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'specId')).toBe(true)
  })

  it('defaults designTimeValues to {}', () => {
    const result = cpqProductOfferingCreateSchema.safeParse({
      specId: VALID_UUID,
      code: 'O',
      name: 'O',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.designTimeValues).toEqual({})
  })
})

describe('cpqBundleSlotCreateSchema', () => {
  it('rejects negative cardinalityMin', () => {
    const result = cpqBundleSlotCreateSchema.safeParse({
      specId: VALID_UUID,
      targetSpecId: VALID_UUID_2,
      componentGroup: 'access',
      name: 'Access slot',
      cardinalityMin: -1,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'cardinalityMin')).toBe(true)
  })

  it('accepts cardinalityMax: null', () => {
    const result = cpqBundleSlotCreateSchema.safeParse({
      specId: VALID_UUID,
      targetSpecId: VALID_UUID_2,
      componentGroup: 'access',
      name: 'Access slot',
      cardinalityMax: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqProductRelationshipCreateSchema', () => {
  it.each(['parent_child', 'requires', 'excludes'] as const)(
    'accepts relationshipType=%s',
    (type) => {
      const result = cpqProductRelationshipCreateSchema.safeParse({
        sourceSpecId: VALID_UUID,
        targetSpecId: VALID_UUID_2,
        relationshipType: type,
      })
      expect(result.success).toBe(true)
    },
  )

  it('rejects unknown relationshipType', () => {
    const result = cpqProductRelationshipCreateSchema.safeParse({
      sourceSpecId: VALID_UUID,
      targetSpecId: VALID_UUID_2,
      relationshipType: 'depends_on',
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqProductAttributeCreateSchema', () => {
  it('requires attributeType from the enum', () => {
    const result = cpqProductAttributeCreateSchema.safeParse({
      code: 'port_speed',
      name: 'Port Speed',
      attributeType: 'unknown',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'attributeType')).toBe(true)
  })

  it('defaults resolutionTime to run_time and isRequired to true', () => {
    const result = cpqProductAttributeCreateSchema.safeParse({
      code: 'port_speed',
      name: 'Port Speed',
      attributeType: 'enum',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.resolutionTime).toBe('run_time')
    expect(result.data.isRequired).toBe(true)
  })

  it('accepts options array with value/label pairs', () => {
    const result = cpqProductAttributeCreateSchema.safeParse({
      code: 'port_speed',
      name: 'Port Speed',
      attributeType: 'select',
      options: [
        { value: '1G', label: '1 Gbps' },
        { value: '10G', label: '10 Gbps' },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqProductChargeCreateSchema', () => {
  // Baseline flat-pricing payload — fixedPrice + currencyCode required by V-CHG-1.
  const flatBase = {
    code: 'setup',
    name: 'Setup Fee',
    chargeType: 'nrc' as const,
    pricingMethod: 'flat' as const,
    fixedPrice: '1500.00',
    currencyCode: 'USD',
  }

  const perUnitBase = {
    code: 'bw',
    name: 'Bandwidth',
    chargeType: 'mrc' as const,
    pricingMethod: 'per_unit' as const,
    pricingTableId: VALID_UUID,
    priceColumnKey: 'per_mb',
    quantityAttributeCode: 'bandwidth_mb',
  }

  it('coerces numeric fixedPrice to string (per the union/transform)', () => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...flatBase, fixedPrice: 1500 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.fixedPrice).toBe('1500')
  })

  it('keeps string fixedPrice as-is', () => {
    const result = cpqProductChargeCreateSchema.safeParse(flatBase)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.fixedPrice).toBe('1500.00')
  })

  it.each(['nrc', 'mrc', 'usage'] as const)('accepts chargeType=%s', (chargeType) => {
    expect(cpqProductChargeCreateSchema.safeParse({ ...flatBase, chargeType }).success).toBe(true)
  })

  it('rejects unknown pricingMethod', () => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...flatBase, pricingMethod: 'graduated' })
    expect(result.success).toBe(false)
  })

  // ─── V-CHG-1: flat pricing shape ────────────────────────────
  it('V-CHG-1: rejects flat without fixedPrice', () => {
    const { fixedPrice: _, ...partial } = flatBase
    const result = cpqProductChargeCreateSchema.safeParse(partial)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'fixedPrice')).toBe(true)
  })

  it('V-CHG-1: rejects flat without currencyCode', () => {
    const { currencyCode: _, ...partial } = flatBase
    const result = cpqProductChargeCreateSchema.safeParse(partial)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'currencyCode')).toBe(true)
  })

  it('V-CHG-1: rejects flat with stray pricingTableId', () => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...flatBase, pricingTableId: VALID_UUID })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'pricingTableId')).toBe(true)
  })

  // ─── V-CHG-1: per_unit / tiered pricing shape ──────────────
  it.each(['per_unit', 'tiered'] as const)('V-CHG-1: accepts complete %s config', (method) => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...perUnitBase, pricingMethod: method })
    expect(result.success).toBe(true)
  })

  it.each(['per_unit', 'tiered'] as const)('V-CHG-1: rejects %s without pricingTableId', (method) => {
    const { pricingTableId: _, ...partial } = perUnitBase
    const result = cpqProductChargeCreateSchema.safeParse({ ...partial, pricingMethod: method })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'pricingTableId')).toBe(true)
  })

  it.each(['per_unit', 'tiered'] as const)('V-CHG-1: rejects %s without priceColumnKey', (method) => {
    const { priceColumnKey: _, ...partial } = perUnitBase
    const result = cpqProductChargeCreateSchema.safeParse({ ...partial, pricingMethod: method })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'priceColumnKey')).toBe(true)
  })

  it.each(['per_unit', 'tiered'] as const)('V-CHG-1: rejects %s without quantityAttributeCode', (method) => {
    const { quantityAttributeCode: _, ...partial } = perUnitBase
    const result = cpqProductChargeCreateSchema.safeParse({ ...partial, pricingMethod: method })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'quantityAttributeCode')).toBe(true)
  })

  it.each(['per_unit', 'tiered'] as const)('V-CHG-1: rejects %s with stray fixedPrice', (method) => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...perUnitBase, pricingMethod: method, fixedPrice: '5' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'fixedPrice')).toBe(true)
  })

  // ─── Legacy `fixed` alias ──────────────────────────────────
  it('normalises legacy `fixed` to `flat` on input', () => {
    const result = cpqProductChargeCreateSchema.safeParse({ ...flatBase, pricingMethod: 'fixed' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.pricingMethod).toBe('flat')
  })

  it('legacy `fixed` still requires fixedPrice + currencyCode', () => {
    const { fixedPrice: _, currencyCode: __, ...partial } = flatBase
    const result = cpqProductChargeCreateSchema.safeParse({ ...partial, pricingMethod: 'fixed' })
    expect(result.success).toBe(false)
  })
})

describe('cpqPriceRuleCreateSchema', () => {
  it('rejects negative value (min(0))', () => {
    const result = cpqPriceRuleCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      ruleType: 'discount_percent',
      value: -5,
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'value')).toBe(true)
  })

  it.each([
    'discount_percent',
    'discount_absolute',
    'surcharge_percent',
    'surcharge_absolute',
    'price_override',
  ] as const)('accepts ruleType=%s', (ruleType) => {
    const result = cpqPriceRuleCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      ruleType,
      value: 10,
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown ruleType', () => {
    const result = cpqPriceRuleCreateSchema.safeParse({
      code: 'X',
      name: 'X',
      ruleType: 'unknown_rule',
      value: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqPricingTableCreateSchema', () => {
  it('requires at least one currency code', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: 'Datacenter' }],
      priceColumns: [{ key: 'list', label: 'List' }],
      currencyCodeList: [],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'currencyCodeList')).toBe(true)
  })

  it('accepts a fully-formed pricing table', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: 'Datacenter' }],
      priceColumns: [{ key: 'list', label: 'List' }],
      currencyCodeList: ['USD', 'EUR'],
    })
    expect(result.success).toBe(true)
  })

  // ─── V-PT-1: key/label required + unique ──────────────────
  it('V-PT-1: rejects dimension with empty key', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: '', label: 'Datacenter' }],
      priceColumns: [{ key: 'list', label: 'List' }],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.includes('dimensions') && i.path.includes('key'))).toBe(true)
  })

  it('V-PT-1: rejects dimension with empty label', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: '' }],
      priceColumns: [{ key: 'list', label: 'List' }],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.includes('dimensions') && i.path.includes('label'))).toBe(true)
  })

  it('V-PT-1: rejects priceColumn with empty key', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: 'Datacenter' }],
      priceColumns: [{ key: '', label: 'List' }],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.includes('priceColumns') && i.path.includes('key'))).toBe(true)
  })

  it('V-PT-1: rejects priceColumn with empty label', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: 'Datacenter' }],
      priceColumns: [{ key: 'list', label: '' }],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.includes('priceColumns') && i.path.includes('label'))).toBe(true)
  })

  it('V-PT-1: rejects duplicate dimension keys', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [
        { key: 'dc', label: 'Datacenter' },
        { key: 'dc', label: 'Datacenter again' },
      ],
      priceColumns: [{ key: 'list', label: 'List' }],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => /duplicate/.test(i.message))).toBe(true)
  })

  it('V-PT-1: rejects duplicate priceColumn keys', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [{ key: 'dc', label: 'Datacenter' }],
      priceColumns: [
        { key: 'list', label: 'List' },
        { key: 'list', label: 'List dup' },
      ],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => /duplicate/.test(i.message))).toBe(true)
  })

  it('V-PT-1: accepts empty dimensions / priceColumns arrays (table with no lookup keys yet)', () => {
    const result = cpqPricingTableCreateSchema.safeParse({
      code: 'PT',
      name: 'PT',
      dimensions: [],
      priceColumns: [],
      currencyCodeList: ['USD'],
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqPricingTableEntryCreateSchema', () => {
  it('defaults currencyCode to USD', () => {
    const result = cpqPricingTableEntryCreateSchema.safeParse({
      pricingTableId: VALID_UUID,
      dimensionValues: { dc: 'equinix-ld5' },
      prices: { list: 100 },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.currencyCode).toBe('USD')
  })

  it('rejects missing prices', () => {
    const result = cpqPricingTableEntryCreateSchema.safeParse({
      pricingTableId: VALID_UUID,
      dimensionValues: { dc: 'equinix-ld5' },
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqCreateQuoteSchema', () => {
  it('requires customerId UUID', () => {
    const result = cpqCreateQuoteSchema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'customerId')).toBe(true)
  })

  it('accepts customerId only', () => {
    const result = cpqCreateQuoteSchema.safeParse({ customerId: VALID_UUID })
    expect(result.success).toBe(true)
  })
})

describe('cpqAddQuoteItemSchema', () => {
  it('defaults action=add, quantity=1, configuration={}', () => {
    const result = cpqAddQuoteItemSchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.action).toBe('add')
    expect(result.data.quantity).toBe(1)
    expect(result.data.configuration).toEqual({})
  })

  it('rejects quantity < 1', () => {
    const result = cpqAddQuoteItemSchema.safeParse({ quantity: 0 })
    expect(result.success).toBe(false)
  })

  it.each(['add', 'modify', 'cancel'] as const)('accepts action=%s', (action) => {
    expect(cpqAddQuoteItemSchema.safeParse({ action }).success).toBe(true)
  })

  it('accepts usage estimates with chargeCode and estimatedQuantity', () => {
    const result = cpqAddQuoteItemSchema.safeParse({
      usageEstimates: [{ chargeCode: 'data_xfer', estimatedQuantity: 100 }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative estimatedQuantity', () => {
    const result = cpqAddQuoteItemSchema.safeParse({
      usageEstimates: [{ chargeCode: 'data_xfer', estimatedQuantity: -1 }],
    })
    expect(result.success).toBe(false)
  })
})

describe('cpqUpdateQuoteItemSchema', () => {
  it('requires configuration', () => {
    const result = cpqUpdateQuoteItemSchema.safeParse({ quantity: 5 })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'configuration')).toBe(true)
  })
})

describe('cpqRecalculateSchema', () => {
  it('requires save: boolean', () => {
    expect(cpqRecalculateSchema.safeParse({ save: true }).success).toBe(true)
    expect(cpqRecalculateSchema.safeParse({ save: false }).success).toBe(true)
    expect(cpqRecalculateSchema.safeParse({}).success).toBe(false)
    expect(cpqRecalculateSchema.safeParse({ save: 'yes' }).success).toBe(false)
  })
})

describe('cpqTransitionStatusSchema', () => {
  it('requires non-empty targetStatus', () => {
    expect(cpqTransitionStatusSchema.safeParse({ targetStatus: 'ready' }).success).toBe(true)
    expect(cpqTransitionStatusSchema.safeParse({ targetStatus: '' }).success).toBe(false)
    expect(cpqTransitionStatusSchema.safeParse({}).success).toBe(false)
  })
})

describe('cpqValidateRelationshipsSchema', () => {
  it('accepts a list of UUIDs', () => {
    const result = cpqValidateRelationshipsSchema.safeParse({
      offeringIds: [VALID_UUID, VALID_UUID_2],
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID entries', () => {
    const result = cpqValidateRelationshipsSchema.safeParse({
      offeringIds: ['not-a-uuid'],
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional parentChildPairs', () => {
    const result = cpqValidateRelationshipsSchema.safeParse({
      offeringIds: [VALID_UUID],
      parentChildPairs: [{ parentOfferingId: VALID_UUID, childOfferingId: VALID_UUID_2 }],
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqPricePreviewSchema', () => {
  it('requires childItems even when empty', () => {
    expect(cpqPricePreviewSchema.safeParse({ childItems: [] }).success).toBe(true)
    expect(cpqPricePreviewSchema.safeParse({}).success).toBe(false)
  })

  it('refines: each item must supply offeringId or productId', () => {
    const result = cpqPricePreviewSchema.safeParse({
      primaryItem: { configuration: {} },
      childItems: [],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.message).toMatch(/offeringId or productId/)
  })

  it('accepts a primary with offeringId only', () => {
    const result = cpqPricePreviewSchema.safeParse({
      primaryItem: { offeringId: VALID_UUID, configuration: {} },
      childItems: [],
    })
    expect(result.success).toBe(true)
  })
})

describe('cpqWizardDefinitionCreateSchema', () => {
  it('requires at least one step', () => {
    const result = cpqWizardDefinitionCreateSchema.safeParse({
      code: 'wiz',
      name: 'Wiz',
      steps: [],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'steps')).toBe(true)
  })

  it('rejects an unknown transition operator', () => {
    const result = cpqWizardDefinitionCreateSchema.safeParse({
      code: 'wiz',
      name: 'Wiz',
      steps: [
        {
          stepId: 's1',
          type: 'form',
          title: 'Step 1',
          transitions: [
            {
              targetStepId: 's2',
              condition: { field: 'x', operator: 'unknown' as never },
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('defaults isOptional=false and surface=backend', () => {
    const result = cpqWizardDefinitionCreateSchema.safeParse({
      code: 'wiz',
      name: 'Wiz',
      steps: [{ stepId: 's1', type: 'form', title: 'Step 1' }],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.steps[0].isOptional).toBe(false)
    expect(result.data.surface).toBe('backend')
  })
})

describe('cpqInventorySubscriptionCreateSchema', () => {
  it('requires at least one item', () => {
    const result = cpqInventorySubscriptionCreateSchema.safeParse({
      customerId: VALID_UUID,
      name: 'Sub',
      items: [],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path[0] === 'items')).toBe(true)
  })

  it('defaults billingCycle to monthly and autoRenew to true', () => {
    const result = cpqInventorySubscriptionCreateSchema.safeParse({
      customerId: VALID_UUID,
      name: 'Sub',
      items: [{ name: 'Line 1' }],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.billingCycle).toBe('monthly')
    expect(result.data.autoRenew).toBe(true)
  })

  it.each(['monthly', 'quarterly', 'annually'] as const)(
    'accepts billingCycle=%s',
    (billingCycle) => {
      expect(
        cpqInventorySubscriptionCreateSchema.safeParse({
          customerId: VALID_UUID,
          name: 'Sub',
          billingCycle,
          items: [{ name: 'Line 1' }],
        }).success,
      ).toBe(true)
    },
  )
})

describe('cpqInventoryAssetCreateSchema', () => {
  it('defaults assetType to one_time and quantity to 1', () => {
    const result = cpqInventoryAssetCreateSchema.safeParse({
      customerId: VALID_UUID,
      name: 'Asset',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.assetType).toBe('one_time')
    expect(result.data.quantity).toBe(1)
  })

  it.each(['one_time', 'license', 'physical', 'logical'] as const)(
    'accepts assetType=%s',
    (assetType) => {
      expect(
        cpqInventoryAssetCreateSchema.safeParse({
          customerId: VALID_UUID,
          name: 'Asset',
          assetType,
        }).success,
      ).toBe(true)
    },
  )
})

describe('cpqConvertQuoteToOrderSchema', () => {
  it('requires quoteId UUID', () => {
    expect(cpqConvertQuoteToOrderSchema.safeParse({ quoteId: VALID_UUID }).success).toBe(true)
    expect(cpqConvertQuoteToOrderSchema.safeParse({}).success).toBe(false)
    expect(cpqConvertQuoteToOrderSchema.safeParse({ quoteId: 'nope' }).success).toBe(false)
  })
})

describe('cpqOrderStatusTransitionSchema', () => {
  it('requires non-empty targetStatus', () => {
    expect(cpqOrderStatusTransitionSchema.safeParse({ targetStatus: 'active' }).success).toBe(true)
    expect(cpqOrderStatusTransitionSchema.safeParse({ targetStatus: '' }).success).toBe(false)
  })
})
