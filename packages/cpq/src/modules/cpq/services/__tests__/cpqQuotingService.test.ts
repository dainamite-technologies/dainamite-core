import { LockMode } from '@mikro-orm/core'
import { DefaultCpqQuotingService, QuotingError } from '../cpqQuotingService'
import type { TenantScope } from '../types'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'

interface MockEm {
  transactional: jest.MockedFunction<(callback: (em: MockEm) => Promise<unknown>) => Promise<unknown>>
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
    transactional: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ ...data, id: data.id ?? 'gen-id' })),
    persist: jest.fn(),
    assign: jest.fn().mockImplementation((entity: Record<string, unknown>, updates: Record<string, unknown>) => {
      Object.assign(entity, updates)
      return entity
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.transactional.mockImplementation((callback) => callback(em))
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

  it('locks the quote in a transaction when save=true', async () => {
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

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
    expect(em.findOne.mock.calls[0][2]).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE })
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

  it.each(['accepted', 'rejected', 'cancelled'])(
    'rejects a saved recalculation on a %s (terminal) quote with 409 and persists nothing',
    async (cpqStatus) => {
      const { em, service } = makeService()
      em.findOne.mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus,
        customerId: 'cust',
        currencyCode: 'USD',
        version: 1,
        parentQuoteId: null,
        validationResult: null,
        pricingSummary: null,
        quoteContext: null,
      })

      await expect(service.recalculate('cpq-1', { save: true }, SCOPE)).rejects.toMatchObject({
        status: 409,
        message: `Cannot recalculate quote in '${cpqStatus}' status`,
      })
      expect(em.flush).not.toHaveBeenCalled()
    },
  )

  it('still allows a read-only (save=false) recalculation on an accepted quote', async () => {
    const { em, service } = makeService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'cpq-1',
        quoteId: 'sq-1',
        cpqStatus: 'accepted',
        customerId: 'cust',
        currencyCode: 'USD',
        version: 1,
        parentQuoteId: null,
        validationResult: null,
        pricingSummary: null,
        quoteContext: null,
      })
      .mockResolvedValueOnce({ id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-0001' })
    em.find.mockResolvedValueOnce([])

    const result = await service.recalculate('cpq-1', { save: false }, SCOPE)

    expect(result.cpqStatus).toBe('accepted')
    expect(em.flush).not.toHaveBeenCalled()
  })
})

// Supplier sourcing step 9: closing causes cancel the quote's open cost requests in the same write.
describe('DefaultCpqQuotingService — cost request cancellation on close and delete', () => {
  const pricingSummary = { nrcTotal: 0, mrcTotal: 0, usageCharges: [], usageTotalEstimated: null, discountTotal: 0, surchargeTotal: 0, currencyCode: 'USD' }
  const openCost = (over: Record<string, unknown> = {}) => ({
    id: 'cost-1', quoteConfigurationId: 'cpq-1', quoteId: 'sq-1', quoteLineId: 'sl-1', costKey: 'tail', name: 'Tail', chargeCode: 'fee', deletedAt: null,
    sourcingStatus: 'requested', costRequestId: 'req-1', requestSeq: 1, proposedAmount: null, requestHistory: [], requestedAt: new Date('2026-01-01'), requestedByUserId: 'u1', ...over,
  })

  function setup(cpqStatus: string, costs = [openCost()]) {
    const { em, service } = makeService()
    const published: unknown[][] = []
    const publisher = jest.fn(async (signals: unknown[]) => { published.push(signals) })
    ;(service as unknown as { sourcingPublisher: unknown }).sourcingPublisher = publisher
    const config: Record<string, unknown> = {
      id: 'cpq-1', quoteId: 'sq-1', cpqStatus, customerId: 'cust', currencyCode: 'USD', version: 1, parentQuoteId: null, pricingRevision: 1,
      validationResult: { valid: true, errors: [] }, pricingSummary, deletedAt: null,
    }
    const salesQuote: Record<string, unknown> = { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-001', deletedAt: null }
    const lineConfigs: Array<Record<string, unknown>> = [{ id: 'lc-1', quoteLineId: 'sl-1', quoteConfigurationId: 'cpq-1', deletedAt: null }]
    const salesLines: Array<Record<string, unknown>> = [{ id: 'sl-1', deletedAt: null }]
    em.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqQuoteConfiguration) return config
      if (entity === SalesQuote) return salesQuote
      if (entity === SalesQuoteLine) return salesLines.find((row) => row.id === where.id) ?? null
      return null
    })
    em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CpqQuoteLineCost) return where.sourcingStatus === 'requested' ? costs.filter((row) => row.sourcingStatus === 'requested') : costs
      if (entity === CpqQuoteLineConfiguration) return lineConfigs
      return []
    })
    return { em, service, config, salesQuote, lineConfigs, salesLines, costs, published }
  }

  it.each(['rejected', 'cancelled'])('moving a quote to %s cancels its open requests (quote_closed) and publishes request_cancelled after commit', async (target) => {
    const { service, config, costs, published } = setup('ready')
    await service.transitionStatus('cpq-1', target, SCOPE, 'user-1')
    expect(config.cpqStatus).toBe(target)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'quote_closed', costRequestId: 'req-1', proposedAmount: null })
    expect(costs[0].requestHistory).toEqual([expect.objectContaining({ outcome: 'cancelled', reason: 'quote_closed', closedByUserId: 'user-1' })])
    expect(published).toEqual([[expect.objectContaining({ kind: 'request_cancelled', reason: 'quote_closed', costRequestId: 'req-1' })]])
  })

  it('accepting a quote keeps its requests open (Q6); so does any non-closing transition', async () => {
    for (const target of ['accepted', 'with_customer']) {
      const { service, costs, published } = setup('ready')
      await service.transitionStatus('cpq-1', target, SCOPE)
      expect(costs[0]).toMatchObject({ sourcingStatus: 'requested', costRequestId: 'req-1' })
      expect(published).toEqual([])
    }
  })

  it('a refused transition cancels nothing', async () => {
    const { service, costs } = setup('new')
    await expect(service.transitionStatus('cpq-1', 'new', SCOPE)).rejects.toMatchObject({ status: 409 })
    expect(costs[0].sourcingStatus).toBe('requested')
  })

  it('deleteQuote soft-deletes config, lines, sales quote and sales lines, cancels open requests and answers { ok: true }', async () => {
    const { service, config, salesQuote, lineConfigs, salesLines, costs, published } = setup('ready')
    expect(await service.deleteQuote('cpq-1', SCOPE, 'user-1')).toEqual({ ok: true })
    for (const row of [config, salesQuote, ...lineConfigs, ...salesLines]) expect(row.deletedAt).toBeInstanceOf(Date)
    expect(costs[0]).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'quote_closed' })
    expect(published).toEqual([[expect.objectContaining({ kind: 'request_cancelled', reason: 'quote_closed' })]])
  })

  it.each(['accepted', 'rejected', 'cancelled'])('deleteQuote answers 409 for a quote in %s status and writes nothing', async (status) => {
    const { service, config, salesQuote, lineConfigs, costs, published } = setup(status)
    await expect(service.deleteQuote('cpq-1', SCOPE)).rejects.toMatchObject({ status: 409, message: expect.stringContaining(status) })
    expect(config.deletedAt).toBeNull()
    expect(salesQuote.deletedAt).toBeNull()
    expect(lineConfigs.every((row) => row.deletedAt === null)).toBe(true)
    expect(costs[0].sourcingStatus).toBe('requested')
    expect(published).toEqual([])
  })

  it('deleteQuote answers 404 for an unknown quote and writes nothing', async () => {
    const { em, service } = setup('ready')
    em.findOne.mockResolvedValue(null)
    await expect(service.deleteQuote('nope', SCOPE)).rejects.toMatchObject({ status: 404 })
  })

  it('deleteQuote runs under the aggregate lock (pessimistic write, scoped)', async () => {
    const { em, service } = setup('ready')
    await service.deleteQuote('cpq-1', SCOPE)
    expect(em.findOne).toHaveBeenCalledWith(CpqQuoteConfiguration, expect.objectContaining({ id: 'cpq-1', organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId, deletedAt: null }), expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }))
  })
})
