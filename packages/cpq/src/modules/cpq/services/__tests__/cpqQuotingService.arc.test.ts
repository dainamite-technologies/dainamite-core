import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'
import { itemCostSetHash } from '../costs/itemCostState'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqInventoryCost,
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqQuoteTargetSubscription,
  CpqOrderConfiguration,
  CpqProductCharge,
  CpqProductOffering,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
} from '../../data/entities'

/**
 * XD-250 ARC unit tests for cpqQuotingService — focused on the
 * `validateArcQuote` hook wired into `transitionStatus`.
 *
 * Spec § Services / validateArcQuote: "Called automatically on the
 * submit-for-approval transition." If the ARC quote has missing target,
 * missing cancel-meta, or malformed merge term, the transition must reject
 * with HTTP-friendly error before persisting the new status.
 */

function makeService() {
  const em = createMockEm()
  const service = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: {} as never,
    cpqValidationService: {} as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
  })
  return { em, service }
}

const ARC_QUOTE_BASE = {
  id: 'cpq-1',
  quoteId: 'sq-1',
  cpqStatus: 'ready',
  customerId: 'cust-1',
  currencyCode: 'USD',
  version: 1,
  parentQuoteId: null,
  validationResult: { valid: true, errors: [] },
  pricingSummary: {
    nrcTotal: 0,
    mrcTotal: 0,
    usageCharges: [],
    usageTotalEstimated: null,
    discountTotal: 0,
    surchargeTotal: 0,
    currencyCode: 'USD',
  },
}

describe('transitionStatus → validateArcQuote hook', () => {
  it("transitions a 'new' quote ready → in_approval without invoking ARC validation", async () => {
    const { em, service } = makeService()
    const cpqConfig = { ...ARC_QUOTE_BASE, quoteType: 'new' }
    em.findOne
      .mockResolvedValueOnce(cpqConfig) // loadCpqConfig
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' }) // loadSalesQuote
    em.find.mockResolvedValueOnce([]) // loadLineConfigs at end

    await service.transitionStatus('cpq-1', 'in_approval', SCOPE)

    expect(cpqConfig.cpqStatus).toBe('in_approval')
    // The standard 2 transition findOnes + 2 from resolveQuoteSideData
    // (customer lookup + converted-order lookup) — no extra validateArcQuote roundtrips.
    expect(em.findOne).toHaveBeenCalledTimes(4)
  })

  it('rejects an amend quote with no target subscription on submit-for-approval', async () => {
    const { em, service } = makeService()
    const cpqConfig = { ...ARC_QUOTE_BASE, quoteType: 'amend' }
    // Sequence of em.findOne / em.find:
    //  1. loadCpqConfig (transitionStatus entry)
    //  2. loadSalesQuote (for the response building, but we throw before that)
    em.findOne.mockResolvedValueOnce(cpqConfig)
    em.findOne.mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    // validateArcQuote internals: loadCpqConfigStrict, then targets find, then subs find.
    em.findOne.mockResolvedValueOnce(cpqConfig) // loadCpqConfigStrict
    em.find.mockResolvedValueOnce([]) // targets — empty triggers rejection

    await expect(service.transitionStatus('cpq-1', 'in_approval', SCOPE)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('at least one target subscription'),
    })

    // Status NOT persisted because we rejected before flush.
    expect(cpqConfig.cpqStatus).toBe('ready')
  })

  it('rejects a cancel quote that has not stamped a reason code', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      ...ARC_QUOTE_BASE,
      quoteType: 'cancel',
      arcReasonCode: null,
    }
    em.findOne.mockResolvedValueOnce(cpqConfig)
    em.findOne.mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.findOne.mockResolvedValueOnce(cpqConfig) // loadCpqConfigStrict inside validateArcQuote
    // 1 attached target.
    em.find.mockResolvedValueOnce([
      {
        id: 't-1',
        quoteId: 'cpq-1',
        subscriptionId: 'sub-1',
        quoteType: 'cancel',
        mergeAction: null,
        newTermStart: null,
        newTermEnd: null,
        newTermMonths: null,
      },
    ])
    em.find.mockResolvedValueOnce([
      {
        id: 'sub-1',
        customerId: 'cust-1',
        currencyCode: 'USD',
        billingCycle: 'monthly',
        status: 'active',
        code: 'SUB-1',
      },
    ])
    em.find.mockResolvedValueOnce([]) // quote lines empty
    // Concurrency check (ensureNoConcurrentArcQuoteForValidation): targets attached to other quotes
    em.find.mockResolvedValueOnce([])

    await expect(service.transitionStatus('cpq-1', 'in_approval', SCOPE)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('arc_reason_code'),
    })
    expect(cpqConfig.cpqStatus).toBe('ready')
  })

  it('skips ARC validation on terminal-status transitions (cancelled, rejected)', async () => {
    const { em, service } = makeService()
    const cpqConfig = { ...ARC_QUOTE_BASE, quoteType: 'amend' }
    em.findOne
      .mockResolvedValueOnce(cpqConfig)
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([]) // line configs

    await service.transitionStatus('cpq-1', 'cancelled', SCOPE)

    expect(cpqConfig.cpqStatus).toBe('cancelled')
    // No validateArcQuote roundtrips; 2 transition findOnes + 2 from
    // resolveQuoteSideData (customer + converted-order lookup).
    expect(em.findOne).toHaveBeenCalledTimes(4)
  })
})

// ─── Amend mirror-line pricing on recalculation ──────────────────


function makePricedService() {
  const em = Object.assign(createMockEm(), {
    assign: jest.fn((entity: Record<string, unknown>, updates: Record<string, unknown>) =>
      Object.assign(entity, updates),
    ),
    fork: jest.fn(),
  })
  em.fork.mockReturnValue(em)
  const pricingService = { resolveProductCharges: jest.fn() }
  const validationService = {
    validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    validateRelationships: jest.fn().mockResolvedValue([]),
  }
  const service = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: pricingService as never,
    cpqValidationService: validationService as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
  })
  return { em, pricingService, service }
}

function mrcCharge(price: number) {
  return {
    chargeCode: 'monthly_port_fee',
    chargeName: 'Monthly Port Fee',
    chargeType: 'mrc',
    pricingMethod: 'flat',
    unitPrice: price,
    quantity: 1,
    totalPrice: price,
    currencyCode: 'USD',
    adjustments: [],
  }
}

function amendFixture(configuration: Record<string, unknown>) {
  const cpqConfig = { ...ARC_QUOTE_BASE, quoteType: 'amend', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId }
  const lineConfig = {
    id: 'lc-1',
    quoteLineId: 'ql-1',
    quoteConfigurationId: 'cpq-1',
    offeringId: 'off-1',
    productId: 'prod-1',
    specId: null,
    action: 'modify',
    parentLineId: null,
    startDate: null,
    termMonths: null,
    endDate: null,
    configuration,
    quantity: 1,
    charges: [mrcCharge(100)],
    nrcTotal: '0',
    mrcTotal: '100',
    usageEstimates: null,
    usageTotalEstimated: null,
    validationErrors: null,
    isConfigured: true,
    targetSubscriptionId: 'sub-1',
    sourceSubscriptionItemId: 'item-1',
  }
  return { cpqConfig, lineConfig }
}

function routeEm(
  em: ReturnType<typeof makePricedService>['em'],
  cpqConfig: Record<string, unknown>,
  lineConfig: Record<string, unknown>,
) {
  em.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === CpqQuoteConfiguration) return cpqConfig
    if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' }
    if (entity === SalesQuoteLine) return { id: 'ql-1' }
    if (entity === CpqProductOffering) return { id: 'off-1', name: 'GIX Access Port', offeringType: 'simple' }
    if (entity === CpqQuoteLineConfiguration) return lineConfig
    return null
  })
  em.find.mockImplementation(async (entity: unknown) => {
    if (entity === CpqQuoteLineConfiguration) return [lineConfig]
    return []
  })
}

describe('recalculate → Amend mirror lines', () => {
  it('re-prices a legacy Amend mirror line (created before the frozen marker) at the current standard price', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({
      port_size: '1G',
      _arcMirroredFromItemId: 'item-1',
      _arcMirroredName: 'GIX Access Port',
    })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalledTimes(1)
    expect(lineConfig.mrcTotal).toBe('120')
  })

  it('keeps a frozen Amend mirror line at its stored price without calling the pricing engine', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({
      port_size: '1G',
      _arcMirroredFromItemId: 'item-1',
      _arcMirroredName: 'GIX Access Port',
      _arcPriceFrozen: true,
    })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    const result = await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.mrcTotal).toBe('100')
    expect(result.lines[0].mrcTotal).toBe(100)
  })
})

describe('recalculate → Renew mirror lines of non-cost-plus items (unchanged)', () => {
  // A Renew mirror line without `_arcCostPlusFrozen` is re-priced at today's
  // standard price on every recalculation, even when the line carries a stray
  // `_arcPriceFrozen` (Renew honours the freeze for cost-plus items only).
  it.each([
    ['unmarked', {}],
    ['carrying a stray freeze marker', { _arcPriceFrozen: true }],
  ])('re-prices a Renew mirror line %s at the current standard price', async (_label, marker) => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({
      port_size: '1G',
      _arcMirroredFromItemId: 'item-1',
      _arcMirroredName: 'GIX Access Port',
      ...marker,
    })
    routeEm(em, { ...cpqConfig, quoteType: 'renew' }, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalledTimes(1)
    expect(lineConfig.mrcTotal).toBe('120')
  })
})

describe('recalculate → Cancel-quote lines carry no cost readiness errors', () => {
  it.each([
    ['cancel', 'cancel', true],
    ['cancel', 'new', false],
  ])('an unpriced cost-plus charge on a %s-action line of a %s quote', async (action, quoteType, silent) => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G' })
    Object.assign(cpqConfig, { quoteType, cpqStatus: 'ready' })
    lineConfig.action = action
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockImplementation(async (params: { costPlus: { errors: Array<{ chargeCode: string; code: string }> } }) => {
      params.costPlus.errors.push({ chargeCode: 'tail', code: 'COST_PENDING' })
      return [mrcCharge(0)]
    })
    await service.recalculate('cpq-1', { save: true }, SCOPE)
    const messages = ((lineConfig.validationErrors ?? []) as Array<{ message: string }>).map((error) => error.message)
    expect(messages.includes('COST_PENDING')).toBe(!silent)
  })
})

describe('removeQuoteItem → ARC mirror line becomes a cancel line', () => {
  it.each(['amend', 'renew'])('soft-deletes the line\'s cost lines (catalog and manual) on %s, whatever the toggle', async (quoteType) => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
    cpqConfig.quoteType = quoteType
    routeEm(em, cpqConfig, lineConfig)
    const costs = [
      { id: 'c-1', quoteLineId: 'ql-1', costKey: 'tail', origin: 'catalog', valueStatus: 'estimated', deletedAt: null },
      { id: 'c-2', quoteLineId: 'ql-1', costKey: 'manual:abcd1234', origin: 'manual', valueStatus: 'confirmed', deletedAt: null },
    ]
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteLineConfiguration) return [lineConfig]
      if (entity === CpqQuoteLineCost) return costs
      return []
    })
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.removeQuoteItem('cpq-1', 'ql-1', SCOPE)

    expect(lineConfig.action).toBe('cancel')
    expect(costs.map((row) => row.deletedAt)).toEqual([expect.any(Date), expect.any(Date)])
    expect(em.find).toHaveBeenCalledWith(CpqQuoteLineCost, expect.objectContaining({ quoteConfigurationId: 'cpq-1', quoteLineId: { $in: ['ql-1'] }, deletedAt: null }), expect.anything())
  })
})

describe('Renew mirror line pricing, standalone (ARC costs step 14; MODIFIES the Phase 1 freeze)', () => {
  const MANAGED = { port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' }
  const renew = (cfg: Record<string, unknown>) => {
    const fixture = amendFixture(cfg)
    return { cpqConfig: { ...fixture.cpqConfig, quoteType: 'renew' }, lineConfig: fixture.lineConfig }
  }

  it('re-prices a cost-managed standalone Renew mirror line at today\'s standard price (not frozen, no Phase 1 banner marker)', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ ...MANAGED })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect(lineConfig.mrcTotal).toBe('120')
    expect(lineConfig.configuration).not.toHaveProperty('_arcPriceFrozen')
    expect(lineConfig.configuration).toMatchObject({ _arcCostsCarried: true })
  })

  it('keeps the cost-managed markers when the UI resubmits the line, and never freezes it', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ ...MANAGED })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)

    expect(lineConfig.configuration).toMatchObject({ _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' })
    expect(lineConfig.configuration).not.toHaveProperty('_arcPriceFrozen')
    expect(lineConfig.configuration).not.toHaveProperty('_arcCostPlusFrozen')
  })

  it('a Phase 1 frozen line keeps its contracted price (Q6, unchanged)', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostPlusFrozen: true })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])
    await service.recalculate('cpq-1', { save: true }, SCOPE)
    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.mrcTotal).toBe('100')
  })
})

describe('Phase 1 frozen Renew mirror lines of cost-plus items (Q4; kept by ARC costs Q6 for lines created before step 14)', () => {
  const COST_PLUS_FROZEN = {
    port_size: '1G',
    _arcMirroredFromItemId: 'item-1',
    _arcMirroredName: 'GIX Access Port',
    _arcPriceFrozen: true,
    _arcCostPlusFrozen: true,
  }
  const renew = (cfg: Record<string, unknown>) => {
    const fixture = amendFixture(cfg)
    return { cpqConfig: { ...fixture.cpqConfig, quoteType: 'renew' }, lineConfig: fixture.lineConfig }
  }

  it('keeps a frozen cost-plus Renew line at its stored price without calling the pricing engine', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ ...COST_PLUS_FROZEN })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.mrcTotal).toBe('100')
  })

  it('stays frozen (both markers) when the UI resubmits an unchanged configuration', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ ...COST_PLUS_FROZEN })
    routeEm(em, cpqConfig, lineConfig)

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)

    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.configuration).toMatchObject({ _arcPriceFrozen: true, _arcCostPlusFrozen: true })
  })

  it('unfreezes both markers and re-prices when a pricing input changes', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ ...COST_PLUS_FROZEN })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(150)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' } }, SCOPE)

    const stored = lineConfig.configuration as Record<string, unknown>
    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect(stored._arcPriceFrozen).toBeUndefined()
    expect(stored._arcCostPlusFrozen).toBeUndefined()
    expect(lineConfig.mrcTotal).toBe('150')
  })

  it('never lets a client set the cost-plus freeze marker', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G', _arcPriceFrozen: true, _arcCostPlusFrozen: true } }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect((lineConfig.configuration as Record<string, unknown>)._arcCostPlusFrozen).toBeUndefined()
  })

  it('an offering switched to cost-plus after the sale does not freeze: an unmarked Renew mirror is re-priced from the current offering', async () => {
    // Q4: only the item's stored charges decide the freeze. The mirror builder saw flat charges, so no marker.
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = renew({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([{ ...mrcCharge(0), pricingMethod: 'cost_plus', unitPrice: null, totalPrice: 0 }])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalledTimes(1)
  })
})

describe('updateQuoteItem → frozen Amend mirror lines', () => {
  const FROZEN_CFG = {
    port_size: '1G',
    _arcMirroredFromItemId: 'item-1',
    _arcMirroredName: 'GIX Access Port',
    _arcPriceFrozen: true,
  }

  it('stays frozen when the UI resubmits an unchanged configuration', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ ...FROZEN_CFG })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)

    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.configuration).toMatchObject({ _arcPriceFrozen: true, _arcMirroredFromItemId: 'item-1' })
    expect(lineConfig.mrcTotal).toBe('100')
  })

  it('unfreezes and re-prices when the configuration changes', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ ...FROZEN_CFG })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(150)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' } }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect((lineConfig.configuration as Record<string, unknown>)._arcPriceFrozen).toBeUndefined()
    expect(lineConfig.configuration).toMatchObject({ port_size: '10G', _arcMirroredFromItemId: 'item-1' })
    expect(lineConfig.mrcTotal).toBe('150')
  })

  it('unfreezes and re-prices when the quantity changes', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ ...FROZEN_CFG })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(110)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 2 }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect(lineConfig.mrcTotal).toBe('220')
  })

  it('unfreezes and marks the line re-priced when the UI echoes the stored markers with a changed attribute', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ ...FROZEN_CFG })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(150)])

    // The quote page sends back the configuration it loaded — markers included.
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { ...FROZEN_CFG, port_size: '10G' }, quantity: 1 }, SCOPE)

    const stored = lineConfig.configuration as Record<string, unknown>
    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect(stored._arcPriceFrozen).toBeUndefined()
    expect(stored._arcRepriced).toBe(true)
    expect(stored._arcMirroredFromItemId).toBe('item-1')
    expect(lineConfig.mrcTotal).toBe('150')
  })

  it('stays frozen when the UI echoes the stored markers unchanged', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ ...FROZEN_CFG })
    routeEm(em, cpqConfig, lineConfig)

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { ...FROZEN_CFG }, quantity: 1 }, SCOPE)

    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect((lineConfig.configuration as Record<string, unknown>)._arcRepriced).toBeUndefined()
  })

  it('never lets a client set the freeze marker', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' })
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G', _arcPriceFrozen: true } }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
    expect((lineConfig.configuration as Record<string, unknown>)._arcPriceFrozen).toBeUndefined()
  })
})

describe('updateQuoteItem → _arcReconfigured marker (Q13)', () => {
  const MIRROR = { port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' }
  const setup = (quoteType: string, cfg: Record<string, unknown>) => {
    const made = makePricedService()
    const fixture = amendFixture({ ...cfg })
    routeEm(made.em, { ...fixture.cpqConfig, quoteType }, fixture.lineConfig)
    made.pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(150)])
    return { ...made, lineConfig: fixture.lineConfig }
  }
  const markers = (lineConfig: { configuration: unknown }) => lineConfig.configuration as Record<string, unknown>

  it('marks a non-frozen Renew mirror line reconfigured when a pricing input changes', async () => {
    const { service, lineConfig } = setup('renew', MIRROR)
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' } }, SCOPE)
    expect(markers(lineConfig)._arcReconfigured).toBe(true)
    expect(markers(lineConfig)._arcRepriced).toBeUndefined()
  })

  it('does not mark an unchanged resubmission, and keeps an existing marker sticky', async () => {
    const unchanged = setup('renew', MIRROR)
    await unchanged.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)
    expect(markers(unchanged.lineConfig)._arcReconfigured).toBeUndefined()
    const sticky = setup('renew', { ...MIRROR, _arcReconfigured: true })
    await sticky.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)
    expect(markers(sticky.lineConfig)._arcReconfigured).toBe(true)
  })

  it('un-freezing an Amend line and a cost-plus Renew line both set the marker', async () => {
    const amend = setup('amend', { ...MIRROR, _arcPriceFrozen: true })
    await amend.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' } }, SCOPE)
    expect(markers(amend.lineConfig)).toMatchObject({ _arcReconfigured: true, _arcRepriced: true })
    expect(markers(amend.lineConfig)._arcPriceFrozen).toBeUndefined()
    const renew = setup('renew', { ...MIRROR, _arcPriceFrozen: true, _arcCostPlusFrozen: true })
    await renew.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' }, quantity: 2 }, SCOPE)
    expect(markers(renew.lineConfig)._arcReconfigured).toBe(true)
    expect(markers(renew.lineConfig)._arcCostPlusFrozen).toBeUndefined()
  })

  it('never lets a client set the marker, and never marks a line that is not a mirror line', async () => {
    const client = setup('renew', MIRROR)
    await client.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G', _arcReconfigured: true }, quantity: 1 }, SCOPE)
    expect(markers(client.lineConfig)._arcReconfigured).toBeUndefined()
    const plain = setup('renew', { port_size: '1G' })
    await plain.service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' } }, SCOPE)
    expect(markers(plain.lineConfig)._arcReconfigured).toBeUndefined()
  })
})

describe('recalculate → freeze marker outside Amend mirror lines', () => {
  it('ignores the freeze marker on a line of a new (non-ARC) quote', async () => {
    const { em, pricingService, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({
      port_size: '1G',
      _arcMirroredFromItemId: 'item-1',
      _arcPriceFrozen: true,
    })
    cpqConfig.quoteType = 'new'
    routeEm(em, cpqConfig, lineConfig)
    pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(120)])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(pricingService.resolveProductCharges).toHaveBeenCalledTimes(1)
    expect(lineConfig.mrcTotal).toBe('120')
  })
})

// ─── Cost-locked quotes: lines priced from costs (R4 / R11) ──────

describe('cost-locked quotes refuse adding / reconfiguring a cost-plus line (COST_LOCKED)', () => {
  function costLockedFixture(opts: { status?: string; quoteType?: string; costPlusCharges?: number; orders?: number; enabled?: boolean; configuration?: Record<string, unknown> } = {}) {
    const em = Object.assign(createMockEm(), {
      assign: jest.fn((entity: Record<string, unknown>, updates: Record<string, unknown>) => Object.assign(entity, updates)),
      fork: jest.fn(),
    })
    em.fork.mockReturnValue(em)
    const pricingService = { resolveProductCharges: jest.fn().mockResolvedValue([mrcCharge(120)]) }
    const service = new DefaultCpqQuotingService({
      em: em as never,
      cpqPricingService: pricingService as never,
      cpqValidationService: {
        validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
        validateRelationships: jest.fn().mockResolvedValue([]),
      } as never,
      cpqProductService: {} as never,
      salesDocumentNumberGenerator: {} as never,
      cpqCostService: { enabled: jest.fn(async () => opts.enabled ?? true) } as never,
    })
    const { cpqConfig, lineConfig } = amendFixture(opts.configuration ?? { port_size: '1G' })
    Object.assign(cpqConfig, { cpqStatus: opts.status ?? 'with_customer', quoteType: opts.quoteType ?? 'new' })
    routeEm(em, cpqConfig, lineConfig)
    em.count.mockImplementation(async (entity: unknown) =>
      entity === CpqProductCharge ? opts.costPlusCharges ?? 1 : entity === CpqOrderConfiguration ? opts.orders ?? 0 : 0)
    return { em, pricingService, service, lineConfig }
  }
  const add = (service: DefaultCpqQuotingService) => service.addQuoteItem('cpq-1', { offeringId: 'off-1', configuration: { port_size: '10G' }, quantity: 1 }, SCOPE)

  it('refuses adding a line whose offering has an active cost-plus charge to a cost-locked quote', async () => {
    const { em, pricingService, service } = costLockedFixture()
    await expect(add(service)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.count).toHaveBeenCalledWith(CpqProductCharge, expect.objectContaining({ offeringId: 'off-1', pricingMethod: 'cost_plus', isActive: true, deletedAt: null }))
  })

  it('an existing order locks a ready quote too', async () => {
    const { service } = costLockedFixture({ status: 'ready', orders: 1 })
    await expect(add(service)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
  })

  it.each([
    ['the offering has no active cost-plus charge', { costPlusCharges: 0 }],
    ['the quote is not cost-locked (ready)', { status: 'ready' }],
    ['the cost-plus toggle is off', { enabled: false }],
  ])('adds the line when %s', async (_label, opts) => {
    const { pricingService, service } = costLockedFixture(opts)
    await add(service)
    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
  })

  it.each([
    ['its configuration', { configuration: { port_size: '10G' }, quantity: 1 }],
    ['its quantity', { configuration: { port_size: '1G' }, quantity: 2 }],
  ])('refuses changing %s on a cost-locked quote', async (_label, update) => {
    const { pricingService, service, lineConfig } = costLockedFixture()
    await expect(service.updateQuoteItem('cpq-1', 'ql-1', update, SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.configuration).toEqual({ port_size: '1G' })
  })

  it.each([
    ['an unchanged resubmission', { configuration: { port_size: '1G' }, quantity: 1 }],
    ['an unchanged term', { configuration: { port_size: '1G' }, quantity: 1, termMonths: undefined }],
  ])('accepts %s on a cost-locked quote', async (_label, update) => {
    const { em, service } = costLockedFixture()
    await service.updateQuoteItem('cpq-1', 'ql-1', update, SCOPE)
    expect(em.count).not.toHaveBeenCalledWith(CpqProductCharge, expect.anything())
  })

  it('refuses a term change on a cost-locked quote (term_months feeds cost applicability and tables)', async () => {
    const { pricingService, service } = costLockedFixture()
    await expect(service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1, termMonths: 24 }, SCOPE))
      .rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
  })

  it('a term change on a line without a cost-plus charge stays open', async () => {
    const { pricingService, service } = costLockedFixture({ costPlusCharges: 0 })
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1, termMonths: 24 }, SCOPE)
    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
  })

  it('refuses restoring a removed Renew mirror line on a cost-locked quote (its cost rows are gone)', async () => {
    const { em, service, lineConfig } = costLockedFixture({
      quoteType: 'renew', configuration: { port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port' },
    })
    lineConfig.action = 'cancel'
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteLineConfiguration) return [lineConfig]
      if (entity === CpqInventorySubscriptionItem) return [{ id: 'item-1', status: 'active', quantity: 1, mrcAmount: 100, nrcAmount: 0, configuration: {} }]
      return []
    })
    await expect(service.restoreQuoteItem('cpq-1', 'ql-1', SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
    expect(lineConfig.action).toBe('cancel')
  })

  it('leaves ARC flows alone: a frozen Amend mirror line resubmitted unchanged on a locked Amend quote', async () => {
    const { pricingService, service, lineConfig } = costLockedFixture({
      quoteType: 'amend', configuration: { port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcPriceFrozen: true },
    })
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G' }, quantity: 1 }, SCOPE)
    expect(pricingService.resolveProductCharges).not.toHaveBeenCalled()
    expect(lineConfig.configuration).toMatchObject({ _arcPriceFrozen: true })
  })

  it('reconfiguring a line without a cost-plus charge on a cost-locked quote re-prices as before', async () => {
    const { pricingService, service } = costLockedFixture({ costPlusCharges: 0 })
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '10G' }, quantity: 1 }, SCOPE)
    expect(pricingService.resolveProductCharges).toHaveBeenCalled()
  })
})

// ─── ARC costs spec step 6: carry subscription item costs onto Amend mirror lines ───

describe('Amend mirror carries the subscription item costs (ARC costs spec step 6)', () => {
  const itemCost = (over: Record<string, unknown> = {}) => ({
    id: 'ic-1', subscriptionItemId: 'item-1', subscriptionId: 'sub-1', status: 'active', costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1',
    name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'catalog',
    unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000', currencyCode: 'EUR', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null,
    indexSnapshot: null, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30', supplierTermEnd: '2028-11-30', supplierMinTermMonths: 12, note: null,
    ...over,
  })
  const subscriptionItem = () => ({ id: 'item-1', subscriptionId: 'sub-1', name: 'GIX Access Port', status: 'active', quantity: 1, mrcAmount: '100', nrcAmount: '0', configuration: { port_size: '1G' }, offeringId: 'off-1', productId: null, specId: null, parentItemId: null, charges: [] })

  function mirrorFixture(type: 'amend' | 'renew' | 'cancel', costs: Array<Record<string, unknown>>) {
    const em = Object.assign(createMockEm(), { fork: jest.fn() })
    em.fork.mockReturnValue(em)
    const service = new DefaultCpqQuotingService({
      em: em as never, cpqPricingService: {} as never, cpqValidationService: {} as never, cpqProductService: {} as never,
      salesDocumentNumberGenerator: { generate: jest.fn().mockResolvedValue({ number: 'Q-1' }) } as never,
    })
    em.findOne.mockImplementation(async (entity: unknown) => (entity === CpqInventorySubscription
      ? { id: 'sub-1', customerId: 'cust-1', currencyCode: 'EUR', billingCycle: 'monthly', status: 'active', code: 'SUB-1', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), termMonths: 12 }
      : null))
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqInventorySubscriptionItem) return [subscriptionItem()]
      if (entity === CpqInventoryCost) return costs
      return []
    })
    const create = () => (service as unknown as { createQuoteFromSubscription: (input: unknown, scope: unknown) => Promise<unknown> })
      .createQuoteFromSubscription({ subscriptionId: 'sub-1', type }, SCOPE)
    // `em.create` of the mock returns a copy, so mutations (the carry markers) show on the persisted objects only.
    const created = (entity: unknown) => {
      const data = em.create.mock.calls.filter(([e]) => e === entity).map(([, d]) => d as Record<string, any>)
      if (entity !== CpqQuoteLineConfiguration) return data
      const persisted = em.persist.mock.calls.map(([row]) => row as Record<string, any>)
      return data.map((d) => persisted.find((row) => row.quoteLineId === d.quoteLineId && 'action' in row) ?? d)
    }
    return { em, create, created }
  }

  it('creates one carried cost line per open item cost and no catalog line, and marks the line cost-managed', async () => {
    const { em, create, created } = mirrorFixture('amend', [itemCost(), itemCost({ id: 'ic-2', costKey: 'install', costType: 'nrc', unitAmount: '50', instanceAmount: '50', role: 'margin_only' })])
    await create()
    const costs = created(CpqQuoteLineCost)
    expect(costs.map((c) => c.costKey)).toEqual(['install', 'tail'])
    expect(costs.find((c) => c.costKey === 'tail')).toMatchObject({
      origin: 'carried', valueOrigin: 'carried', valueStatus: 'confirmed', unitAmount: '270.0000', currencyCode: 'EUR', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1',
      supplierTermEnd: '2028-11-30', carriedFromItemCostId: 'ic-1', sourcingStatus: 'not_requested', renegotiationDue: false, costElementId: 'el-1',
    })
    expect(costs[0].carriedFromHash).toEqual(expect.any(String))
    const [line] = created(CpqQuoteLineConfiguration)
    expect(line.configuration).toMatchObject({ _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostsCarried: true, _arcCarriedCostSetHash: expect.any(String) })
    expect(line).toMatchObject({ mrcTotal: '100', action: 'modify' })
    expect(em.find).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isActive: true }))
  })

  it('an item without open costs gets no carried line and no markers', async () => {
    const { create, created } = mirrorFixture('amend', [])
    await create()
    expect(created(CpqQuoteLineCost)).toHaveLength(0)
    expect(created(CpqQuoteLineConfiguration)[0].configuration).not.toHaveProperty('_arcCostsCarried')
  })

  it('a cancel mirror carries nothing', async () => {
    const { em, create, created } = mirrorFixture('cancel', [itemCost()])
    await create()
    expect(created(CpqQuoteLineCost)).toHaveLength(0)
    expect(created(CpqQuoteLineConfiguration)[0].configuration).not.toHaveProperty('_arcCostsCarried')
    expect(em.find).not.toHaveBeenCalledWith(CpqInventoryCost, expect.anything())
  })

  // ARC costs step 14 (MODIFIES step 6: carry was Amend-only): a standalone Renew mirror carries the item's costs, is NOT frozen
  // (re-priced at today's standard), and is cost-managed even for an item with no open costs (R1c reconciles it).
  it('a standalone Renew mirror carries the open costs, is not frozen and is cost-managed (step 14)', async () => {
    const { create, created } = mirrorFixture('renew', [itemCost()])
    await create()
    expect(created(CpqQuoteLineCost)).toHaveLength(1)
    expect(created(CpqQuoteLineCost)[0]).toMatchObject({ origin: 'carried', costKey: 'tail', valueStatus: 'confirmed', renegotiationDue: false })
    const [line] = created(CpqQuoteLineConfiguration)
    expect(line.configuration).toMatchObject({ _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcCarriedCostSetHash: expect.any(String) })
    expect(line.configuration).not.toHaveProperty('_arcPriceFrozen')
    expect(line.configuration).not.toHaveProperty('_arcCostPlusFrozen')
  })

  it('a standalone Renew mirror of an item without open costs is still marked cost-managed, with the empty set hash (step 14)', async () => {
    const { create, created } = mirrorFixture('renew', [])
    await create()
    expect(created(CpqQuoteLineCost)).toHaveLength(0)
    expect(created(CpqQuoteLineConfiguration)[0].configuration).toMatchObject({ _arcCostsCarried: true, _arcCarriedCostSetHash: itemCostSetHash([], { status: 'active' } as never) })
  })

  it('a standalone Renew mirror of a cost-plus item is no longer frozen (step 14 modifies the Phase 1 freeze)', async () => {
    const { em, create, created } = mirrorFixture('renew', [itemCost()])
    const costPlusItem = { ...subscriptionItem(), charges: [{ chargeCode: 'mrc', pricingMethod: 'cost_plus' }] }
    em.find.mockImplementation(async (entity: unknown) => (entity === CpqInventorySubscriptionItem ? [costPlusItem] : entity === CpqInventoryCost ? [itemCost()] : []))
    await create()
    const [line] = created(CpqQuoteLineConfiguration)
    expect(line.configuration).not.toHaveProperty('_arcPriceFrozen')
    expect(line.configuration).not.toHaveProperty('_arcCostPlusFrozen')
    expect(line.configuration).toMatchObject({ _arcCostsCarried: true })
  })

  it('a merge-renew attach mirrors the new target without carrying costs', async () => {
    const { em, created } = mirrorFixture('renew', [itemCost()])
    const cpqConfig = { id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new', quoteType: 'renew', customerId: 'cust-1', currencyCode: 'EUR', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId }
    em.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteConfiguration) return cpqConfig
      if (entity === CpqInventorySubscription) return { id: 'sub-2', customerId: 'cust-1', currencyCode: 'EUR', billingCycle: 'monthly', status: 'active' }
      if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'EUR' }
      return null
    })
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteTargetSubscription) return [{ id: 't-1', subscriptionId: 'sub-1', mergeAction: 'standalone', quoteId: 'cpq-1' }]
      if (entity === CpqInventorySubscription) return [{ id: 'sub-1', billingCycle: 'monthly' }]
      if (entity === CpqInventorySubscriptionItem) return [subscriptionItem()]
      if (entity === CpqInventoryCost) return [itemCost()]
      return []
    })
    const service = new DefaultCpqQuotingService({
      em: em as never, cpqPricingService: {} as never, cpqValidationService: {} as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never,
    })
    await service.attachTargetSubscription('cpq-1', { quoteType: 'renew', subscriptionId: 'sub-2' } as never, SCOPE)
    expect(created(CpqQuoteLineConfiguration)).toHaveLength(1)
    expect(created(CpqQuoteLineCost)).toHaveLength(0)
  })

  it('ARC costs Q10: a merge-renew mirror of a cost-plus item keeps the Phase 1 freeze and carries no cost lines or markers', async () => {
    const { em, created } = mirrorFixture('renew', [itemCost()])
    const costPlusItem = { ...subscriptionItem(), charges: [{ chargeCode: 'mrc', pricingMethod: 'cost_plus' }] }
    em.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteConfiguration) return { id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new', quoteType: 'renew', customerId: 'cust-1', currencyCode: 'EUR', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId }
      if (entity === CpqInventorySubscription) return { id: 'sub-2', customerId: 'cust-1', currencyCode: 'EUR', billingCycle: 'monthly', status: 'active' }
      if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'EUR' }
      return null
    })
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteTargetSubscription) return [{ id: 't-1', subscriptionId: 'sub-1', mergeAction: 'standalone', quoteId: 'cpq-1' }]
      if (entity === CpqInventorySubscription) return [{ id: 'sub-1', billingCycle: 'monthly' }]
      if (entity === CpqInventorySubscriptionItem) return [costPlusItem]
      if (entity === CpqInventoryCost) return [itemCost()]
      return []
    })
    const service = new DefaultCpqQuotingService({
      em: em as never, cpqPricingService: {} as never, cpqValidationService: {} as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never,
    })
    await service.attachTargetSubscription('cpq-1', { quoteType: 'renew', subscriptionId: 'sub-2' } as never, SCOPE)
    const [line] = created(CpqQuoteLineConfiguration)
    expect(line.configuration).toMatchObject({ _arcPriceFrozen: true, _arcCostPlusFrozen: true })
    expect(line.configuration).not.toHaveProperty('_arcCostsCarried')
    expect(line.configuration).not.toHaveProperty('_arcCarriedCostSetHash')
    expect(line.targetSubscriptionId).toBeNull()
    expect(created(CpqQuoteLineCost)).toHaveLength(0)
    expect(em.find).not.toHaveBeenCalledWith(CpqInventoryCost, expect.anything())
  })

  it('step 14 / Q10: attaching a second Renew target turns the first target\'s standalone mirror into a merge mirror (carry markers and cost rows removed, cost-plus freeze back)', async () => {
    const { em } = mirrorFixture('renew', [itemCost()])
    const costPlusItem = { ...subscriptionItem(), charges: [{ chargeCode: 'mrc', pricingMethod: 'cost_plus' }] }
    const first = { quoteLineId: 'ql-first', targetSubscriptionId: 'sub-1', sourceSubscriptionItemId: 'item-1', configuration: { _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' } }
    const carriedRow = { id: 'qc-1', quoteLineId: 'ql-first', origin: 'carried', deletedAt: null }
    em.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteConfiguration) return { id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new', quoteType: 'renew', customerId: 'cust-1', currencyCode: 'EUR', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId }
      if (entity === CpqInventorySubscription) return { id: 'sub-2', customerId: 'cust-1', currencyCode: 'EUR', billingCycle: 'monthly', status: 'active' }
      if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'EUR' }
      return null
    })
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteTargetSubscription) return [{ id: 't-1', subscriptionId: 'sub-1', mergeAction: 'standalone', quoteId: 'cpq-1' }, { id: 't-2', subscriptionId: 'sub-2', mergeAction: 'absorb', quoteId: 'cpq-1' }]
      if (entity === CpqInventorySubscription) return [{ id: 'sub-1', billingCycle: 'monthly' }]
      if (entity === CpqInventorySubscriptionItem) return [costPlusItem]
      if (entity === CpqQuoteLineConfiguration) return [first]
      if (entity === CpqQuoteLineCost) return [carriedRow]
      return []
    })
    const service = new DefaultCpqQuotingService({
      em: em as never, cpqPricingService: {} as never, cpqValidationService: {} as never, cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never,
    })
    await service.attachTargetSubscription('cpq-1', { quoteType: 'renew', subscriptionId: 'sub-2' } as never, SCOPE)
    expect(first.targetSubscriptionId).toBeNull()
    expect(first.configuration).toEqual({ _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true, _arcCostPlusFrozen: true })
    expect(carriedRow).toMatchObject({ deletedAt: expect.any(Date) })
  })

  it('restore re-carries the item costs of a removed Amend line (fresh markers, previous cost rows replaced)', async () => {
    const em = Object.assign(createMockEm(), { assign: jest.fn((e: Record<string, unknown>, u: Record<string, unknown>) => Object.assign(e, u)), fork: jest.fn() })
    em.fork.mockReturnValue(em)
    const service = new DefaultCpqQuotingService({
      em: em as never, cpqPricingService: { resolveProductCharges: jest.fn().mockResolvedValue([mrcCharge(100)]) } as never,
      cpqValidationService: { validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }), validateRelationships: jest.fn().mockResolvedValue([]) } as never,
      cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never,
    })
    const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcCostsCarried: true, _arcCarriedCostSetHash: 'old' })
    Object.assign(cpqConfig, { cpqStatus: 'new' })
    lineConfig.action = 'cancel'
    routeEm(em, cpqConfig, lineConfig)
    const leftover = { id: 'old-row', quoteLineId: 'ql-1', deletedAt: null }
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CpqQuoteLineConfiguration) return [lineConfig]
      if (entity === CpqInventorySubscriptionItem) return [subscriptionItem()]
      if (entity === CpqInventoryCost) return [itemCost()]
      if (entity === CpqQuoteLineCost) return [leftover]
      return []
    })
    await service.restoreQuoteItem('cpq-1', 'ql-1', SCOPE)
    expect(lineConfig.action).toBe('modify')
    expect(leftover.deletedAt).toBeInstanceOf(Date)
    const carried = em.create.mock.calls.filter(([e]) => e === CpqQuoteLineCost).map(([, d]) => d as Record<string, unknown>)
    expect(carried).toEqual([expect.objectContaining({ costKey: 'tail', origin: 'carried', quoteLineId: 'ql-1', carriedFromItemCostId: 'ic-1' })])
    expect(lineConfig.configuration).toMatchObject({ _arcPriceFrozen: true, _arcCostsCarried: true, _arcCarriedCostSetHash: expect.not.stringMatching(/^old$/) })
  })

  describe('refreshMirrorFromSubscription (step 16)', () => {
    function refreshFixture(opts: { quoteType?: 'amend' | 'renew'; configuration?: Record<string, unknown>; target?: string | null; item?: Record<string, unknown> | null; previous?: Array<Record<string, unknown>>; action?: string } = {}) {
      const em = Object.assign(createMockEm(), { assign: jest.fn((e: Record<string, unknown>, u: Record<string, unknown>) => Object.assign(e, u)), fork: jest.fn() })
      em.fork.mockReturnValue(em)
      const published: Array<Array<Record<string, unknown>>> = []
      const service = new DefaultCpqQuotingService({
        em: em as never, cpqPricingService: { resolveProductCharges: jest.fn().mockResolvedValue([mrcCharge(100)]) } as never,
        cpqValidationService: { validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }), validateRelationships: jest.fn().mockResolvedValue([]) } as never,
        cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never,
        sourcingPublisher: (async (signals: Array<Record<string, unknown>>) => { published.push(signals) }) as never,
      })
      const { cpqConfig, lineConfig } = amendFixture(opts.configuration ?? { port_size: '10G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcReconfigured: true, _arcCostsCarried: true, _arcCarriedCostSetHash: 'stale' })
      Object.assign(cpqConfig, { cpqStatus: 'new', quoteType: opts.quoteType ?? 'amend' })
      Object.assign(lineConfig, { targetSubscriptionId: opts.target === undefined ? 'sub-1' : opts.target, sourceSubscriptionItemId: 'item-1', action: opts.action ?? 'modify', quantity: 3, mrcTotal: '999' })
      routeEm(em, cpqConfig, lineConfig)
      const baseFindOne = em.findOne.getMockImplementation()!
      const item = opts.item === undefined ? subscriptionItem() : opts.item
      em.findOne.mockImplementation(async (entity: unknown, ...rest: unknown[]) => (entity === CpqInventorySubscriptionItem ? item : (baseFindOne as (...args: unknown[]) => unknown)(entity, ...rest)))
      const previous = opts.previous ?? [
        { id: 'old-carried', quoteLineId: 'ql-1', origin: 'carried', sourcingStatus: 'not_requested', costRequestId: null, deletedAt: null },
        { id: 'old-catalog', quoteLineId: 'ql-1', origin: 'catalog', sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 1, supplierId: null, requestHistory: [], deletedAt: null },
      ]
      em.find.mockImplementation(async (entity: unknown) => {
        if (entity === CpqQuoteLineConfiguration) return [lineConfig]
        if (entity === CpqInventoryCost) return [itemCost()]
        if (entity === CpqQuoteLineCost) return previous
        return []
      })
      return { em, service, cpqConfig, lineConfig, previous, published }
    }

    it('re-mirrors the line from the item, soft-deletes the previous cost rows, cancels their open requests (reconfigured) and re-carries with fresh hashes', async () => {
      const { em, service, lineConfig, previous, published } = refreshFixture()
      await service.refreshMirrorFromSubscription('cpq-1', 'ql-1', SCOPE, 'user-1', undefined, ['amend'])
      expect(lineConfig.quantity).toBe(1)
      expect(lineConfig.mrcTotal).toBe('100')
      expect(lineConfig.configuration).toMatchObject({ port_size: '1G', _arcPriceFrozen: true, _arcCostsCarried: true })
      expect(lineConfig.configuration).not.toHaveProperty('_arcReconfigured')
      expect((lineConfig.configuration as Record<string, unknown>)._arcCarriedCostSetHash).toBe(itemCostSetHash([itemCost() as never], subscriptionItem() as never))
      expect(previous.every((row) => row.deletedAt instanceof Date)).toBe(true)
      expect(previous[1]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'reconfigured' })
      expect(previous[1].requestHistory).toHaveLength(1)
      const carried = em.create.mock.calls.filter(([e]) => e === CpqQuoteLineCost).map(([, d]) => d as Record<string, unknown>)
      expect(carried).toEqual([expect.objectContaining({ costKey: 'tail', origin: 'carried', carriedFromItemCostId: 'ic-1', quoteLineId: 'ql-1' })])
      expect(published.flat()).toEqual([expect.objectContaining({ kind: 'request_cancelled', costRequestId: 'req-1', reason: 'reconfigured' })])
    })

    it('a standalone Renew line is marked cost-managed even when the item has no open costs', async () => {
      const { em, service, lineConfig } = refreshFixture({ quoteType: 'renew', configuration: { _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcPriceFrozen: true, _arcCostPlusFrozen: true } })
      em.find.mockImplementation(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [lineConfig] : []))
      await service.refreshMirrorFromSubscription('cpq-1', 'ql-1', SCOPE, null, undefined, ['renew'])
      expect(lineConfig.configuration).toMatchObject({ _arcCostsCarried: true, _arcCarriedCostSetHash: itemCostSetHash([], subscriptionItem() as never) })
    })

    it.each([
      ['a merge-renew line', { quoteType: 'renew' as const, target: null }, { status: 422, message: 'MERGE_LINE' }],
      ['a line that is not a mirror', { configuration: { port_size: '1G' } }, { status: 422, message: 'NOT_ARC_MIRROR' }],
      ['an ended subscription item', { item: { ...subscriptionItem(), status: 'terminated' } }, { status: 409, message: 'ITEM_NOT_ACTIVE' }],
      ['a missing subscription item', { item: null }, { status: 409, message: 'ITEM_NOT_ACTIVE' }],
      ['a caller without the ARC feature of the quote type', {}, { status: 403 }],
    ])('refuses %s and writes nothing', async (_label, opts, expected) => {
      const { service, lineConfig, previous } = refreshFixture(opts as never)
      const before = JSON.stringify(lineConfig.configuration)
      const allowed = expected.status === 403 ? ['renew' as const] : ['amend' as const, 'renew' as const]
      await expect(service.refreshMirrorFromSubscription('cpq-1', 'ql-1', SCOPE, null, undefined, allowed)).rejects.toMatchObject(expected)
      expect(JSON.stringify(lineConfig.configuration)).toBe(before)
      expect(previous.every((row) => row.deletedAt === null)).toBe(true)
    })

    it('refuses a removed line and a cost-locked quote priced from costs', async () => {
      const removed = refreshFixture({ action: 'cancel' })
      await expect(removed.service.refreshMirrorFromSubscription('cpq-1', 'ql-1', SCOPE)).rejects.toMatchObject({ status: 409 })
      const locked = refreshFixture()
      Object.assign(locked.cpqConfig, { cpqStatus: 'with_customer' })
      ;(locked.service as unknown as { costService: unknown }).costService = { enabled: jest.fn(async () => true) }
      locked.em.count.mockResolvedValue(1)
      await expect(locked.service.refreshMirrorFromSubscription('cpq-1', 'ql-1', SCOPE)).rejects.toMatchObject({ status: 409, message: 'COST_LOCKED' })
      expect(locked.previous.every((row) => row.deletedAt === null)).toBe(true)
    })
  })

  it('updateQuoteItem keeps the carry markers on a resubmission and on a reconfiguration', async () => {
    for (const config of [{ port_size: '1G' }, { port_size: '10G' }]) {
      const { em, pricingService, service } = makePricedService()
      const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcMirroredName: 'GIX Access Port', _arcPriceFrozen: true, _arcCostsCarried: true, _arcCarriedCostSetHash: 'h-1' })
      routeEm(em, cpqConfig, lineConfig)
      pricingService.resolveProductCharges.mockResolvedValue([mrcCharge(150)])
      await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: config, quantity: 1 }, SCOPE)
      expect(lineConfig.configuration).toMatchObject({ _arcCostsCarried: true, _arcCarriedCostSetHash: 'h-1' })
    }
  })

  it('a client can never set the carry markers', async () => {
    const { em, service } = makePricedService()
    const { cpqConfig, lineConfig } = amendFixture({ port_size: '1G', _arcMirroredFromItemId: 'item-1', _arcPriceFrozen: true })
    routeEm(em, cpqConfig, lineConfig)
    await service.updateQuoteItem('cpq-1', 'ql-1', { configuration: { port_size: '1G', _arcCostsCarried: true, _arcCarriedCostSetHash: 'x' }, quantity: 1 }, SCOPE)
    expect(lineConfig.configuration).not.toHaveProperty('_arcCostsCarried')
  })
})
