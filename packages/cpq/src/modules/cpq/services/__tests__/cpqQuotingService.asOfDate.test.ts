import { CpqProductOffering, CpqQuoteLineConfiguration, type CpqQuoteConfiguration } from '../../data/entities'
import { DefaultCpqQuotingService } from '../cpqQuotingService'

// Index costs step 8: the internal asOfDate / persist handed to cost resolution (public signatures unchanged).
const resolveCostPlusInputs = jest.fn()
jest.mock('../costs/costResolution', () => ({
  ...jest.requireActual('../costs/costResolution'),
  resolveCostPlusInputs: (...args: unknown[]) => resolveCostPlusInputs(...args),
}))

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }

function setup(opts: { order?: boolean; withCostService?: boolean } = {}) {
  const em: Record<string, jest.Mock> = {
    find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [{ id: 'lc', quoteLineId: 'line-1', quantity: 1, configuration: {}, usageEstimates: null, charges: [] }] : [])),
    findOne: jest.fn(async (entity: unknown) => (entity === CpqProductOffering ? null : {})),
    count: jest.fn(async () => (opts.order ? 1 : 0)),
    assign: jest.fn((entity: Record<string, unknown>, updates: Record<string, unknown>) => Object.assign(entity, updates)),
    persist: jest.fn(),
    create: jest.fn((_e: unknown, data: unknown) => data),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const service = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: { resolveProductCharges: jest.fn().mockResolvedValue([]) } as never,
    cpqValidationService: { validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }), validateRelationships: jest.fn().mockResolvedValue([]) } as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
    ...(opts.withCostService === false ? {} : { cpqCostService: { enabled: jest.fn().mockResolvedValue(true) } }),
  })
  return { em, service }
}
const cfg = (cpqStatus: string) => ({ id: 'quote-cfg', quoteId: 'sales-quote', cpqStatus, quoteType: 'new_sale', currencyCode: 'USD', quoteContext: {} }) as unknown as CpqQuoteConfiguration
const lastCall = () => resolveCostPlusInputs.mock.calls[resolveCostPlusInputs.mock.calls.length - 1][0] as { asOfDate: string; persist: boolean; save: boolean }

beforeEach(() => {
  resolveCostPlusInputs.mockReset()
  resolveCostPlusInputs.mockResolvedValue({ enabled: false, costsByLine: new Map(), overrides: new Map() })
})

describe('recalculateInternal: asOfDate and persist handed to cost resolution', () => {
  it.each(['new', 'incomplete', 'ready'])('persists a saved recalculation of an unlocked %s quote', async (status) => {
    const { em, service } = setup()
    await service.recalculateLockedQuote(em as never, cfg(status), SCOPE, true)
    expect(lastCall()).toMatchObject({ save: true, persist: true })
  })

  it('does not persist for save: false (preview)', async () => {
    const { em, service } = setup()
    await service.recalculateLockedQuote(em as never, cfg('new'), SCOPE, false)
    expect(lastCall()).toMatchObject({ save: false, persist: false })
  })

  it.each(['with_customer', 'accepted', 'approved', 'rejected', 'cancelled'])('does not persist for the locked status %s', async (status) => {
    const { em, service } = setup()
    await service.recalculateLockedQuote(em as never, cfg(status), SCOPE, true)
    expect(lastCall()).toMatchObject({ save: true, persist: false })
  })

  it('does not persist when an order exists, even in a mutable status', async () => {
    const { em, service } = setup({ order: true })
    await service.recalculateLockedQuote(em as never, cfg('ready'), SCOPE, true)
    expect(lastCall()).toMatchObject({ save: true, persist: false })
  })

  it('passes the UTC calendar date of the server clock as asOfDate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-16T23:30:00-05:00'))
    try {
      const { em, service } = setup()
      await service.recalculateLockedQuote(em as never, cfg('new'), SCOPE, true)
      expect(lastCall().asOfDate).toBe('2026-11-17')
    } finally {
      jest.useRealTimers()
    }
  })

  it('without a cost service nothing is resolved and no lock query is made', async () => {
    const { em, service } = setup({ withCostService: false })
    await service.recalculateLockedQuote(em as never, cfg('new'), SCOPE, true)
    expect(resolveCostPlusInputs).not.toHaveBeenCalled()
    expect(em.count).not.toHaveBeenCalled()
  })
})
