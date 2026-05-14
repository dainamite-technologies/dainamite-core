import { DefaultCpqQuotingService, QuotingError } from '../cpqQuotingService'
import type { TenantScope } from '../types'

interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  persist: jest.MockedFunction<(entity: unknown) => unknown>
  assign: jest.MockedFunction<(entity: unknown, updates: Record<string, unknown>) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
  fork: jest.MockedFunction<() => MockEm>
}

interface MockPricingService {
  resolveProductCharges: jest.MockedFunction<(input: unknown) => Promise<unknown[]>>
}

interface MockValidationService {
  validateOfferingConfiguration: jest.MockedFunction<(input: unknown) => Promise<{ valid: boolean; errors: unknown[] }>>
  validateRelationships: jest.MockedFunction<(input: unknown) => Promise<unknown[]>>
}

interface MockProductService {
  getOfferingWithDetails: jest.MockedFunction<(input: unknown) => Promise<unknown>>
}

interface MockNumberGenerator {
  generate: jest.MockedFunction<(input: unknown) => Promise<{ number: string }>>
}

function createMockEm(): MockEm {
  const em: MockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ ...data, id: data.id ?? 'gen-id' })),
    persist: jest.fn(),
    assign: jest.fn().mockImplementation((entity: Record<string, unknown>, updates: Record<string, unknown>) => {
      Object.assign(entity, updates)
      return entity
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeService() {
  const em = createMockEm()
  const pricingService: MockPricingService = {
    resolveProductCharges: jest.fn().mockResolvedValue([]),
  }
  const validationService: MockValidationService = {
    validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    validateRelationships: jest.fn().mockResolvedValue([]),
  }
  const productService: MockProductService = {
    getOfferingWithDetails: jest.fn(),
  }
  const numberGenerator: MockNumberGenerator = {
    generate: jest.fn().mockResolvedValue({ number: 'Q-0001' }),
  }
  const service = new DefaultCpqQuotingService({
    em: em as unknown as never,
    cpqPricingService: pricingService as unknown as never,
    cpqValidationService: validationService as unknown as never,
    cpqProductService: productService as unknown as never,
    salesDocumentNumberGenerator: numberGenerator as unknown as never,
  })
  return { em, pricingService, validationService, productService, numberGenerator, service }
}

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

describe('QuotingError', () => {
  it('exposes status, message, and optional cpqStatus', () => {
    const err = new QuotingError(409, 'Bad transition', 'incomplete')
    expect(err.status).toBe(409)
    expect(err.message).toBe('Bad transition')
    expect(err.cpqStatus).toBe('incomplete')
    expect(err.name).toBe('QuotingError')
    expect(err).toBeInstanceOf(Error)
  })

  it('cpqStatus is optional', () => {
    const err = new QuotingError(404, 'Not found')
    expect(err.cpqStatus).toBeUndefined()
  })
})

describe('DefaultCpqQuotingService.createQuote — guards', () => {
  it('throws 404 when customer is not found', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null) // customer lookup

    await expect(
      service.createQuote(
        { customerId: '11111111-1111-4111-8111-111111111111' },
        SCOPE,
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Customer not found' })
  })

  it('throws 404 when input.quoteId points to a non-existent SalesQuote', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'cust', kind: 'company' }) // customer
    em.findOne.mockResolvedValueOnce(null) // SalesQuote not found

    await expect(
      service.createQuote(
        { customerId: 'cust', quoteId: 'missing-sales-quote' },
        SCOPE,
      ),
    ).rejects.toMatchObject({ status: 404, message: 'Sales quote not found' })
  })

  it('returns the existing CPQ config without recreating when one already exists for the SalesQuote', async () => {
    const { em, service } = makeService()
    const existingSalesQuote = { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' }
    const existingCpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      customerId: 'cust',
      cpqStatus: 'ready',
      version: 1,
      currencyCode: 'USD',
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
      parentQuoteId: null,
    }

    em.findOne
      .mockResolvedValueOnce({ id: 'cust', kind: 'company' }) // customer
      .mockResolvedValueOnce(existingSalesQuote) // SalesQuote
      .mockResolvedValueOnce(existingCpqConfig) // existing CpqQuoteConfiguration
    em.find.mockResolvedValueOnce([]) // line configs

    // Pass currencyCode to short-circuit getBaseCurrencyCode (which would otherwise
    // consume an em.findOne mock by querying the Currency entity).
    const result = await service.createQuote(
      { customerId: 'cust', quoteId: 'sq-1', currencyCode: 'USD' },
      SCOPE,
    )

    expect(result.id).toBe('cpq-1')
    expect(result.quoteId).toBe('sq-1')
    expect(result.cpqStatus).toBe('ready')
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('DefaultCpqQuotingService.transitionStatus — state machine guard', () => {
  // Per operator-override decision, "any → any" is allowed except for
  // self-transitions and ARC-specific guard violations.
  it('persists previously-illegal new → approved jump (operator override)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'new',
      customerId: 'cust',
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
    em.findOne
      .mockResolvedValueOnce(cpqConfig)
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([]) // line configs

    await service.transitionStatus('cpq-1', 'approved', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('approved')
  })

  it('persists previously-illegal accepted → with_customer jump (operator override)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'accepted',
      customerId: 'cust',
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
    em.findOne
      .mockResolvedValueOnce(cpqConfig)
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD' })
    em.find.mockResolvedValueOnce([]) // line configs

    await service.transitionStatus('cpq-1', 'with_customer', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('with_customer')
  })

  it('still rejects self-transition (new → new)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({ id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new' })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })

    await expect(service.transitionStatus('cpq-1', 'new', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: "Cannot transition from 'new' to 'new'",
    })
  })

  it('persists ready → in_approval', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'ready',
      customerId: 'cust',
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
    const salesQuote = { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' }
    em.findOne.mockResolvedValueOnce(cpqConfig).mockResolvedValueOnce(salesQuote)
    em.find.mockResolvedValueOnce([]) // line configs

    const result = await service.transitionStatus('cpq-1', 'in_approval', SCOPE)

    expect(cpqConfig.cpqStatus).toBe('in_approval')
    expect(em.flush).toHaveBeenCalled()
    expect(result.cpqStatus).toBe('in_approval')
  })

  it('persists ready → pre_approved (auto-approval bypass)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'ready',
      customerId: 'cust',
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
    em.findOne.mockResolvedValueOnce(cpqConfig).mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([])

    await service.transitionStatus('cpq-1', 'pre_approved', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('pre_approved')
  })

  it('persists in_approval → approved', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'in_approval',
      customerId: 'cust',
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
    em.findOne.mockResolvedValueOnce(cpqConfig).mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([])

    await service.transitionStatus('cpq-1', 'approved', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('approved')
  })

  it('persists with_customer → accepted (terminal)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'with_customer',
      customerId: 'cust',
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
    em.findOne.mockResolvedValueOnce(cpqConfig).mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([])

    await service.transitionStatus('cpq-1', 'accepted', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('accepted')
  })

  it('persists incomplete → cancelled', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'incomplete',
      customerId: 'cust',
      currencyCode: 'USD',
      version: 1,
      parentQuoteId: null,
      validationResult: { valid: false, errors: [] },
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
    em.findOne.mockResolvedValueOnce(cpqConfig).mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001' })
    em.find.mockResolvedValueOnce([])

    await service.transitionStatus('cpq-1', 'cancelled', SCOPE)
    expect(cpqConfig.cpqStatus).toBe('cancelled')
  })
})

describe('DefaultCpqQuotingService.getQuote', () => {
  it('throws 404 when CPQ config is not found (lookup by id then by quoteId)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await expect(service.getQuote('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('throws 404 when SalesQuote is missing (orphan CPQ config)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-orphan',
        cpqStatus: 'ready',
        customerId: 'cust',
        currencyCode: 'USD',
        version: 1,
        parentQuoteId: null,
        validationResult: null,
        pricingSummary: null,
      })
      .mockResolvedValueOnce(null) // SalesQuote missing

    await expect(service.getQuote('cpq-1', SCOPE)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('falls back to lookup by quoteId when id miss', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce(null) // id miss
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'ready',
        customerId: 'cust',
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
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([])

    const result = await service.getQuote('sq-1', SCOPE)
    expect(result.id).toBe('cpq-1')
    expect(result.quoteNumber).toBe('Q-0001')

    // Verify second findOne called with quoteId filter
    const [, secondWhere] = em.findOne.mock.calls[1]
    expect(secondWhere).toMatchObject({ quoteId: 'sq-1' })
  })

  it('returns a QuoteResult with persisted status, customer, currency and metadata', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'with_customer',
        customerId: 'cust-1',
        currencyCode: 'EUR',
        version: 2,
        parentQuoteId: 'cpq-original',
        validationResult: { valid: true, errors: [] },
        pricingSummary: null, // intentionally null — see assertion below
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'EUR', quoteNumber: 'Q-9999' })
    em.find.mockResolvedValueOnce([]) // no lines

    const result = await service.getQuote('cpq-1', SCOPE)

    expect(result).toMatchObject({
      id: 'cpq-1',
      quoteId: 'sq-1',
      quoteNumber: 'Q-9999',
      cpqStatus: 'with_customer',
      customerId: 'cust-1',
      currencyCode: 'EUR',
      version: 2,
      parentQuoteId: 'cpq-original',
      lines: [],
    })
  })

  it('NOTE: getQuote always recomputes pricingSummary from lineConfigs — persisted summary on the entity is ignored', async () => {
    // This documents (and pins) that buildQuoteResult does NOT preserve the entity-level pricingSummary.
    // With no lines, the result is always zero — even when 1500/200 was persisted.
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'with_customer',
        customerId: 'cust-1',
        currencyCode: 'EUR',
        version: 2,
        parentQuoteId: null,
        validationResult: { valid: true, errors: [] },
        pricingSummary: { nrcTotal: 1500, mrcTotal: 200 },
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'EUR', quoteNumber: 'Q-9999' })
    em.find.mockResolvedValueOnce([])

    const result = await service.getQuote('cpq-1', SCOPE)
    expect(result.pricingSummary.nrcTotal).toBe(0)
    expect(result.pricingSummary.mrcTotal).toBe(0)
  })
})

describe('DefaultCpqQuotingService.removeQuoteItem', () => {
  it('throws 409 when quote is in a terminal status (accepted)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'accepted',
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD' })

    await expect(service.removeQuoteItem('cpq-1', 'line-1', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: "Cannot modify quote in 'accepted' status",
    })
  })

  it('throws 409 when quote is rejected (terminal)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({ id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'rejected' })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD' })

    await expect(service.removeQuoteItem('cpq-1', 'line-1', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 409 when quote is cancelled (terminal)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({ id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'cancelled' })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD' })

    await expect(service.removeQuoteItem('cpq-1', 'line-1', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 404 when the line is not found', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({ id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'ready' })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD' })
      .mockResolvedValueOnce(null) // line lookup miss

    await expect(service.removeQuoteItem('cpq-1', 'missing-line', SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Quote line not found',
    })
  })
})

describe('DefaultCpqQuotingService.recalculate', () => {
  it('does NOT fork the EM when save=false (read-only path uses primary EM)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'new',
        customerId: 'cust',
        currencyCode: 'USD',
        version: 1,
        parentQuoteId: null,
        validationResult: null,
        pricingSummary: null,
        quoteContext: null,
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([]) // line configs (recalculateInternal)

    await service.recalculate('cpq-1', { save: false }, SCOPE)

    expect(em.fork).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('forks the EM when save=true (write path uses isolated UoW)', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'new',
        customerId: 'cust',
        currencyCode: 'USD',
        version: 1,
        parentQuoteId: null,
        validationResult: null,
        pricingSummary: null,
        quoteContext: null,
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([]) // no lines

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(em.fork).toHaveBeenCalledTimes(1)
  })

  it('marks status "new" when no lines exist (auto-managed status)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'incomplete', // auto-managed → should become 'new'
      customerId: 'cust',
      currencyCode: 'USD',
      version: 1,
      parentQuoteId: null,
      validationResult: null,
      pricingSummary: null,
      quoteContext: null,
    }
    em.findOne
      .mockResolvedValueOnce(cpqConfig)
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([])

    const result = await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(cpqConfig.cpqStatus).toBe('new')
    expect(result.cpqStatus).toBe('new')
  })

  it('does NOT auto-update status when current is non-auto-managed (e.g. with_customer)', async () => {
    const { em, service } = makeService()
    const cpqConfig = {
      id: 'cpq-1',
      quoteId: 'sq-1',
      cpqStatus: 'with_customer',
      customerId: 'cust',
      currencyCode: 'USD',
      version: 1,
      parentQuoteId: null,
      validationResult: null,
      pricingSummary: null,
      quoteContext: null,
    }
    em.findOne
      .mockResolvedValueOnce(cpqConfig)
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([])

    await service.recalculate('cpq-1', { save: true }, SCOPE)

    expect(cpqConfig.cpqStatus).toBe('with_customer') // unchanged
  })
})
