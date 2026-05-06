import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'

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
    // Only the standard 2 findOne calls — no extra validateArcQuote roundtrips.
    expect(em.findOne).toHaveBeenCalledTimes(2)
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
    // No validateArcQuote roundtrips on cancelled-target transition.
    expect(em.findOne).toHaveBeenCalledTimes(2)
  })
})
