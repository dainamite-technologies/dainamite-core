import { DefaultCpqPricingService } from '../cpqPricingService'
import {
  CpqProductCharge,
  CpqPricingTable,
  CpqPricingTableEntry,
  CpqPriceRule,
} from '../../data/entities'

type EntityCtor =
  | typeof CpqProductCharge
  | typeof CpqPricingTable
  | typeof CpqPricingTableEntry
  | typeof CpqPriceRule

interface MockEm {
  findOne: jest.MockedFunction<
    (entity: EntityCtor, where: Record<string, unknown>) => Promise<unknown>
  >
  find: jest.MockedFunction<
    (
      entity: EntityCtor,
      where: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown[]>
  >
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
}

const SCOPE = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

interface ChargeStub {
  code: string
  name: string
  description?: string | null
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod: 'flat' | 'fixed' | 'tiered' | 'per_unit'
  pricingTableId?: string | null
  priceColumnKey?: string | null
  fixedPrice?: string | null
  currencyCode?: string | null
  quantityAttributeCode?: string | null
  applicabilityCondition?: Record<string, unknown> | null
}

function makeCharge(overrides: Partial<ChargeStub> & Pick<ChargeStub, 'code' | 'name' | 'chargeType' | 'pricingMethod'>): ChargeStub {
  return {
    description: null,
    pricingTableId: null,
    priceColumnKey: null,
    fixedPrice: null,
    currencyCode: 'USD',
    quantityAttributeCode: null,
    applicabilityCondition: null,
    ...overrides,
  }
}

describe('DefaultCpqPricingService.resolveProductCharges — entry point', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  it('returns [] when neither offeringId nor productId is provided', async () => {
    const result = await service.resolveProductCharges({
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('queries charges by offeringId when provided', async () => {
    em.find
      .mockResolvedValueOnce([]) // charges
      .mockResolvedValueOnce([]) // rules

    await service.resolveProductCharges({
      offeringId: 'offering-1',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const [, chargeWhere] = em.find.mock.calls[0]
    expect(chargeWhere).toMatchObject({
      offeringId: 'offering-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      isActive: true,
      deletedAt: null,
    })
    expect(chargeWhere).not.toHaveProperty('productId')
  })

  it('falls back to productId when offeringId is not provided', async () => {
    em.find.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await service.resolveProductCharges({
      productId: 'product-1',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const [, chargeWhere] = em.find.mock.calls[0]
    expect(chargeWhere).toMatchObject({ productId: 'product-1' })
    expect(chargeWhere).not.toHaveProperty('offeringId')
  })

  it('overrides resolved currencyCode with the quote-level currencyCode (R-CPRICE-8)', async () => {
    em.find
      .mockResolvedValueOnce([
        makeCharge({
          code: 'setup',
          name: 'Setup Fee',
          chargeType: 'nrc',
          pricingMethod: 'flat',
          fixedPrice: '100',
          currencyCode: 'EUR',
        }),
      ])
      .mockResolvedValueOnce([]) // no rules

    const result = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      currencyCode: 'USD',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toHaveLength(1)
    expect(result[0].currencyCode).toBe('USD')
  })

  it('skips charges whose applicability condition does not match', async () => {
    em.find
      .mockResolvedValueOnce([
        makeCharge({
          code: 'gold-only',
          name: 'Gold Surcharge',
          chargeType: 'nrc',
          pricingMethod: 'flat',
          fixedPrice: '50',
          applicabilityCondition: { attribute: 'tier', operator: 'eq', value: 'gold' },
        }),
      ])
      .mockResolvedValueOnce([])

    const result = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: { tier: 'silver' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([])
  })

  it('includes charges whose applicability condition (neq) matches', async () => {
    em.find
      .mockResolvedValueOnce([
        makeCharge({
          code: 'non-gold',
          name: 'Non-Gold',
          chargeType: 'nrc',
          pricingMethod: 'flat',
          fixedPrice: '25',
          applicabilityCondition: { attribute: 'tier', operator: 'neq', value: 'gold' },
        }),
      ])
      .mockResolvedValueOnce([])

    const result = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: { tier: 'silver' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toHaveLength(1)
    expect(result[0].chargeCode).toBe('non-gold')
  })
})

describe('DefaultCpqPricingService.calculateCharge — fixed price', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  it('uses fixedPrice directly when set and no pricingTable', async () => {
    const charge = makeCharge({
      code: 'setup',
      name: 'Setup Fee',
      chargeType: 'nrc',
      pricingMethod: 'flat',
      fixedPrice: '199.99',
      currencyCode: 'USD',
    })

    const result = await service.calculateCharge({
      charge: charge as unknown as never,
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toMatchObject({
      chargeCode: 'setup',
      chargeType: 'nrc',
      pricingMethod: 'flat',
      unitPrice: 199.99,
      quantity: 1,
      totalPrice: 199.99,
      currencyCode: 'USD',
    })
    expect(em.find).not.toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('returns base charge (zeros) when no pricingTableId and no fixedPrice', async () => {
    const charge = makeCharge({
      code: 'unlinked',
      name: 'Unlinked',
      chargeType: 'mrc',
      pricingMethod: 'flat',
    })

    const result = await service.calculateCharge({
      charge: charge as unknown as never,
      configuration: {},
      currencyCode: 'USD',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(0)
    expect(result.totalPrice).toBe(0)
  })

  // Legacy seeds (demo_puffin, demo_gix) emit `pricingMethod: 'fixed'`.
  // The service must treat it identically to `'flat'`.
  it('treats legacy `fixed` pricingMethod as `flat`', async () => {
    const charge = makeCharge({
      code: 'legacy_nrc',
      name: 'Legacy NRC',
      chargeType: 'nrc',
      pricingMethod: 'fixed',
      fixedPrice: '49.50',
      currencyCode: 'USD',
    })

    const result = await service.calculateCharge({
      charge: charge as unknown as never,
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.pricingMethod).toBe('flat')
    expect(result.unitPrice).toBe(49.5)
    expect(result.totalPrice).toBe(49.5)
  })
})

describe('DefaultCpqPricingService.calculateCharge — flat pricing via table', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  it('matches dimension and reads price for the priceColumnKey', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'table-1',
      dimensions: [{ key: 'dc' }],
    })
    em.find.mockResolvedValueOnce([
      {
        dimensionValues: { dc: 'frankfurt' },
        prices: { list: 100, partner: 80 },
        currencyCode: 'EUR',
        rangeFrom: null,
        rangeTo: null,
        tierNumber: null,
      },
      {
        dimensionValues: { dc: 'amsterdam' },
        prices: { list: 90, partner: 70 },
        currencyCode: 'EUR',
        rangeFrom: null,
        rangeTo: null,
        tierNumber: null,
      },
    ])

    const charge = makeCharge({
      code: 'port',
      name: 'Port',
      chargeType: 'mrc',
      pricingMethod: 'flat',
      pricingTableId: 'table-1',
      priceColumnKey: 'list',
    })

    const result = await service.calculateCharge({
      charge: charge as unknown as never,
      configuration: { dc: 'frankfurt' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(100)
    expect(result.totalPrice).toBe(100)
    expect(result.currencyCode).toBe('EUR')
  })

  it('matches case-insensitively on dimension values', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      {
        dimensionValues: { dc: 'Frankfurt' },
        prices: { list: 100 },
        currencyCode: 'USD',
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'port',
        name: 'Port',
        chargeType: 'mrc',
        pricingMethod: 'flat',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
      }) as unknown as never,
      configuration: { dc: 'FRANKFURT' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(100)
  })

  it('returns base zero when no entry matches the configured dimensions', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'frankfurt' }, prices: { list: 100 }, currencyCode: 'USD' },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'port',
        name: 'Port',
        chargeType: 'mrc',
        pricingMethod: 'flat',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
      }) as unknown as never,
      configuration: { dc: 'tokyo' },
      currencyCode: 'USD',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(0)
    expect(result.totalPrice).toBe(0)
  })

  it('treats usage flat charges specially (totalPrice null, quantity null)', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      {
        dimensionValues: { dc: 'eu' },
        prices: { list: 0.05 },
        currencyCode: 'USD',
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'data_xfer',
        name: 'Data Transfer',
        description: 'Per GB',
        chargeType: 'usage',
        pricingMethod: 'flat',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
      }) as unknown as never,
      configuration: { dc: 'eu' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(0.05)
    expect(result.quantity).toBeNull()
    expect(result.totalPrice).toBeNull()
    expect(result.note).toBe('Per GB')
  })
})

describe('DefaultCpqPricingService.calculateCharge — per_unit pricing', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  it('reads quantity from configuration and multiplies by unit price', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      {
        dimensionValues: { dc: 'eu' },
        prices: { list: 10 },
        currencyCode: 'USD',
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'seats',
        name: 'Seats',
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        quantityAttributeCode: 'seat_count',
      }) as unknown as never,
      configuration: { dc: 'eu', seat_count: 7 },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.quantity).toBe(7)
    expect(result.unitPrice).toBe(10)
    expect(result.totalPrice).toBe(70)
  })

  it('treats missing quantity attribute as quantity=0 → totalPrice=0', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'eu' }, prices: { list: 10 }, currencyCode: 'USD' },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'seats',
        name: 'Seats',
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        quantityAttributeCode: 'seat_count',
      }) as unknown as never,
      configuration: { dc: 'eu' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.quantity).toBe(0)
    expect(result.totalPrice).toBe(0)
  })
})

describe('DefaultCpqPricingService.calculateCharge — tiered pricing', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  it('returns 0 when quantity is 0 (no tiers consumed)', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [] })
    em.find.mockResolvedValueOnce([
      {
        tierNumber: 1,
        rangeFrom: 0,
        rangeTo: 10,
        prices: { list: 5 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'usage_tier',
        name: 'Tiered',
        chargeType: 'mrc',
        pricingMethod: 'tiered',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        quantityAttributeCode: 'units',
      }) as unknown as never,
      configuration: { units: 0 },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.quantity).toBe(0)
    expect(result.totalPrice).toBe(0)
  })

  it('charges across tiers in order, allocating partial quantities per tier', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [] })
    em.find.mockResolvedValueOnce([
      // tier 1: 1..10 @ 5
      {
        tierNumber: 1,
        rangeFrom: 0,
        rangeTo: 10,
        prices: { list: 5 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
      // tier 2: 11..50 @ 4
      {
        tierNumber: 2,
        rangeFrom: 10,
        rangeTo: 50,
        prices: { list: 4 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
      // tier 3: 51..∞ @ 3
      {
        tierNumber: 3,
        rangeFrom: 50,
        rangeTo: null,
        prices: { list: 3 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'usage_tier',
        name: 'Tiered',
        chargeType: 'mrc',
        pricingMethod: 'tiered',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        quantityAttributeCode: 'units',
      }) as unknown as never,
      configuration: { units: 60 },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    // 10 @ 5 = 50
    // 40 @ 4 = 160
    // 10 @ 3 = 30
    // total = 240
    expect(result.totalPrice).toBe(240)
    expect(result.quantity).toBe(60)
    expect(result.unitPrice).toBeCloseTo(240 / 60)
    expect(result.breakdown?.tiers).toHaveLength(3)
    expect(result.breakdown?.tiers[2]).toMatchObject({
      tier: 3,
      quantity: 10,
      pricePerUnit: 3,
      subtotal: 30,
    })
  })

  it('caps allocation when quantity stops within a tier', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [] })
    em.find.mockResolvedValueOnce([
      {
        tierNumber: 1,
        rangeFrom: 0,
        rangeTo: 10,
        prices: { list: 5 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
      {
        tierNumber: 2,
        rangeFrom: 10,
        rangeTo: 50,
        prices: { list: 4 },
        currencyCode: 'USD',
        dimensionValues: {},
      },
    ])

    const result = await service.calculateCharge({
      charge: makeCharge({
        code: 'usage_tier',
        name: 'Tiered',
        chargeType: 'mrc',
        pricingMethod: 'tiered',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        quantityAttributeCode: 'units',
      }) as unknown as never,
      configuration: { units: 25 },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    // 10 @ 5 = 50, 15 @ 4 = 60 → total 110
    expect(result.totalPrice).toBe(110)
    expect(result.breakdown?.tiers).toHaveLength(2)
    expect(result.breakdown?.tiers[1].quantity).toBe(15)
  })
})

describe('DefaultCpqPricingService — price rules application', () => {
  let em: MockEm
  let service: DefaultCpqPricingService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqPricingService(em as unknown as never)
  })

  function setupSingleFixedCharge(price: number) {
    em.find.mockResolvedValueOnce([
      makeCharge({
        code: 'setup',
        name: 'Setup',
        chargeType: 'nrc',
        pricingMethod: 'flat',
        fixedPrice: String(price),
        currencyCode: 'USD',
      }),
    ])
  }

  it('discount_percent reduces unitPrice by the percentage', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'WELCOME10',
        name: 'Welcome 10',
        ruleType: 'discount_percent',
        value: 10,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(90)
    expect(result.totalPrice).toBe(90)
    expect(result.adjustments).toHaveLength(1)
    expect(result.adjustments![0]).toMatchObject({
      ruleCode: 'WELCOME10',
      ruleType: 'discount_percent',
      unitPriceBefore: 100,
      unitPriceAfter: 90,
      delta: -10,
    })
  })

  it('discount_percent does not produce a negative price (floored at 0)', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'BIG',
        name: 'Big',
        ruleType: 'discount_percent',
        value: 200,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(0)
    expect(result.totalPrice).toBe(0)
  })

  it('discount_absolute subtracts a fixed amount from totalPrice (floored at 0)', async () => {
    setupSingleFixedCharge(50)
    em.find.mockResolvedValueOnce([
      {
        code: 'SAVE20',
        name: 'Save 20',
        ruleType: 'discount_absolute',
        value: 20,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.totalPrice).toBe(30)
    expect(result.unitPrice).toBe(30) // qty=1 → unitPrice = totalPrice / qty
  })

  it('surcharge_percent increases unitPrice by the percentage', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'PEAK',
        name: 'Peak',
        ruleType: 'surcharge_percent',
        value: 20,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(120)
    expect(result.totalPrice).toBe(120)
  })

  it('surcharge_absolute adds a fixed amount to total', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'INSTALL',
        name: 'Install',
        ruleType: 'surcharge_absolute',
        value: 25,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.totalPrice).toBe(125)
  })

  it('price_override replaces the unit price entirely', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'OVERRIDE',
        name: 'Override',
        ruleType: 'price_override',
        value: 7,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(7)
    expect(result.totalPrice).toBe(7)
  })

  it('chargeCodeFilter scopes a rule to one charge', async () => {
    em.find.mockResolvedValueOnce([
      makeCharge({
        code: 'setup',
        name: 'Setup',
        chargeType: 'nrc',
        pricingMethod: 'flat',
        fixedPrice: '100',
        currencyCode: 'USD',
      }),
      makeCharge({
        code: 'support',
        name: 'Support',
        chargeType: 'mrc',
        pricingMethod: 'flat',
        fixedPrice: '50',
        currencyCode: 'USD',
      }),
    ])
    em.find.mockResolvedValueOnce([
      {
        code: 'SETUP_DISC',
        name: 'Setup Discount',
        ruleType: 'discount_percent',
        value: 50,
        chargeCodeFilter: 'setup',
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const result = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const setup = result.find((r) => r.chargeCode === 'setup')!
    const support = result.find((r) => r.chargeCode === 'support')!
    expect(setup.unitPrice).toBe(50)
    expect(support.unitPrice).toBe(50) // unaffected
    expect(setup.adjustments).toHaveLength(1)
    expect(support.adjustments).toEqual([])
  })

  it('chargeTypeFilter scopes a rule to one charge type', async () => {
    em.find.mockResolvedValueOnce([
      makeCharge({
        code: 'setup',
        name: 'Setup',
        chargeType: 'nrc',
        pricingMethod: 'flat',
        fixedPrice: '100',
        currencyCode: 'USD',
      }),
      makeCharge({
        code: 'support',
        name: 'Support',
        chargeType: 'mrc',
        pricingMethod: 'flat',
        fixedPrice: '50',
        currencyCode: 'USD',
      }),
    ])
    em.find.mockResolvedValueOnce([
      {
        code: 'NRC_DISC',
        name: 'NRC Discount',
        ruleType: 'discount_percent',
        value: 100,
        chargeCodeFilter: null,
        chargeTypeFilter: 'nrc',
        applicabilityCondition: null,
      },
    ])

    const result = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const nrc = result.find((r) => r.chargeType === 'nrc')!
    const mrc = result.find((r) => r.chargeType === 'mrc')!
    expect(nrc.unitPrice).toBe(0)
    expect(mrc.unitPrice).toBe(50)
  })

  it('rule applicabilityCondition gates whether the rule fires', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'GOLD_ONLY',
        name: 'Gold-only Discount',
        ruleType: 'discount_percent',
        value: 50,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: { attribute: 'tier', operator: 'eq', value: 'gold' },
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: { tier: 'silver' }, // condition does not match
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.unitPrice).toBe(100)
    expect(result.adjustments).toEqual([])
  })

  it('multiple rules stack as adjustments in order', async () => {
    setupSingleFixedCharge(100)
    em.find.mockResolvedValueOnce([
      {
        code: 'R1',
        name: 'R1',
        ruleType: 'discount_percent',
        value: 10,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
      {
        code: 'R2',
        name: 'R2',
        ruleType: 'surcharge_percent',
        value: 20,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    // 100 → -10% → 90 → +20% → 108
    expect(result.unitPrice).toBe(108)
    expect(result.adjustments).toHaveLength(2)
    expect(result.adjustments!.map((a) => a.ruleCode)).toEqual(['R1', 'R2'])
  })

  it('rule application updates unitPrice but does not update totalPrice for usage charges (preserved from initial calc)', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'table-1', dimensions: [{ key: 'dc' }] })
    em.find.mockResolvedValueOnce([
      makeCharge({
        code: 'data',
        name: 'Data',
        description: 'Per GB',
        chargeType: 'usage',
        pricingMethod: 'flat',
        pricingTableId: 'table-1',
        priceColumnKey: 'list',
        currencyCode: 'USD',
      }),
    ])
    em.find.mockResolvedValueOnce([
      // pricing-table entries
      {
        dimensionValues: { dc: 'eu' },
        prices: { list: 0.05 },
        currencyCode: 'USD',
      },
    ])
    em.find.mockResolvedValueOnce([
      // rules
      {
        code: 'OFF',
        name: 'Off',
        ruleType: 'discount_percent',
        value: 50,
        chargeCodeFilter: null,
        chargeTypeFilter: null,
        applicabilityCondition: null,
      },
    ])

    const [result] = await service.resolveProductCharges({
      offeringId: 'o',
      configuration: { dc: 'eu' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result.chargeType).toBe('usage')
    expect(result.unitPrice).toBeCloseTo(0.025)
    // table-based usage path returns totalPrice: null and the rule pipeline preserves it
    expect(result.totalPrice).toBeNull()
  })
})
