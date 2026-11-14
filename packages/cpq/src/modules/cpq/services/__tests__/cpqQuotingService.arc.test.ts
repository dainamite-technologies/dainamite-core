import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqInventorySubscriptionItem,
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

describe('recalculate → Renew mirror lines (characterization, before the cost-plus Renew freeze)', () => {
  // Today only Amend mirrors are frozen. A Renew mirror line is re-priced at
  // today's standard price on every recalculation, even when the line carries
  // a freeze marker (the marker is honoured on Amend quotes only).
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
