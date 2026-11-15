import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CpqProductOffering, CpqQuoteConfiguration, CpqQuoteLineCost } from '@dainamite/cpq/modules/cpq/data/entities'
import { workingDaysBetween, isRequestOverdue } from '@dainamite/cpq/modules/cpq/services/costs/costSourcing'
import { COST_SOURCING_SCENARIOS, OVERDUE_WORKING_DAYS } from '../data/cost-plus'
import { requestedAtWorkingDaysAgo, seedGixCostSourcingExamples } from '../cost-sourcing-examples'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async (em: { find: (...a: unknown[]) => unknown }, entity: unknown, where: unknown) => em.find(entity, where)) }))

const scope = { tenantId: 't', organizationId: 'o' }
type Tail = { id: string; costKey: string; sourcingStatus: string; costRequestId: string | null }

/** In-memory stand-ins: the quote store, a per-quote partner-tail cost whose sourcing state the fake services move like the real ones. */
function setup(opts: { autoOpen?: boolean; failTransition?: boolean } = {}) {
  const quotes: Array<Record<string, unknown>> = []
  const tails = new Map<string, Tail>()
  const nativeUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const em = {
    findOne: jest.fn(async (entity: unknown) => (entity === CpqProductOffering ? { id: 'offer' } : null)),
    find: jest.fn(async (entity: unknown) => (entity === CustomerEntity ? [{ id: 'acme', displayName: 'Acme Telecom S.A.' }] : entity === CpqQuoteConfiguration ? quotes : [])),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => { nativeUpdates.push({ where, data }) }),
  }
  let seq = 0
  const quoting = {
    createQuote: jest.fn(async (input: { quoteContext: Record<string, unknown> }) => {
      const id = `q-${++seq}`
      quotes.push({ id, quoteContext: input.quoteContext })
      tails.set(id, { id: `c-${id}`, costKey: 'partner_tail', sourcingStatus: 'not_requested', costRequestId: null })
      return { id }
    }),
    addQuoteItem: jest.fn(async (id: string) => ({ id })),
    recalculate: jest.fn(async (id: string) => {
      if (opts.autoOpen) Object.assign(tails.get(id) as Tail, { sourcingStatus: 'requested', costRequestId: `req-${id}` })
      return { id }
    }),
    transitionStatus: jest.fn(async (id: string, status: string) => {
      if (opts.failTransition) throw new Error('blocked')
      return { id, cpqStatus: status }
    }),
  }
  const costs = { read: jest.fn(async (id: string) => ({ lines: [{ costs: [{ id: 'c-x', costKey: 'cross_connect' }, tails.get(id)] }] })) }
  const sourcing = {
    request: jest.fn(async (id: string) => { Object.assign(tails.get(id) as Tail, { sourcingStatus: 'requested', costRequestId: `req-${id}` }) }),
    decline: jest.fn(async (id: string) => { (tails.get(id) as Tail).sourcingStatus = 'declined' }),
    answer: jest.fn(async (id: string, ..._rest: unknown[]) => { (tails.get(id) as Tail).sourcingStatus = 'answered' }),
  }
  const container = { resolve: (name: string) => ({ cpqQuotingService: quoting, cpqQuoteCostService: costs, cpqCostSourcingService: sourcing })[name] }
  return { em, quoting, sourcing, tails, quotes, nativeUpdates, container }
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

const byScenario = (quotes: Array<Record<string, unknown>>, scenario: string) =>
  quotes.find((quote) => (quote.quoteContext as Record<string, unknown>).scenario === scenario) as { id: string }

describe('seedGixCostSourcingExamples', () => {
  it('creates one quote per sourcing state: requested (overdue), declined, answered with a proposal on a with_customer quote', async () => {
    const t = setup()
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    const { requestedOverdue, declined, answeredProposal } = COST_SOURCING_SCENARIOS
    expect(t.quotes.map((quote) => (quote.quoteContext as Record<string, unknown>).scenario))
      .toEqual([requestedOverdue.scenario, declined.scenario, answeredProposal.scenario])

    // Requested + overdue: still open, request back-dated by direct update.
    const overdueQuote = byScenario(t.quotes, requestedOverdue.scenario)
    expect(t.tails.get(overdueQuote.id)?.sourcingStatus).toBe('requested')
    expect(t.nativeUpdates).toHaveLength(1)
    expect(t.nativeUpdates[0].where).toMatchObject({ id: `c-${overdueQuote.id}` })
    const requestedAt = t.nativeUpdates[0].data.requestedAt as Date
    expect(isRequestOverdue(workingDaysBetween(requestedAt, new Date()), 5)).toBe(true)

    // Declined with the reason.
    const declinedQuote = byScenario(t.quotes, declined.scenario)
    expect(t.sourcing.decline).toHaveBeenCalledWith(declinedQuote.id, `c-${declinedQuote.id}`, { costRequestId: `req-${declinedQuote.id}`, reason: 'No coverage at site' }, expect.any(String), scope)
    expect(t.tails.get(declinedQuote.id)?.sourcingStatus).toBe('declined')

    // Answered after the quote went with_customer (locked), with a differing amount.
    const proposalQuote = byScenario(t.quotes, answeredProposal.scenario)
    expect(t.quoting.transitionStatus.mock.calls.map((call) => [call[0], call[1]])).toEqual([[proposalQuote.id, 'ready'], [proposalQuote.id, 'with_customer']])
    expect(t.sourcing.answer).toHaveBeenCalledTimes(1)
    expect((t.sourcing.answer.mock.calls[0] as unknown[])[2]).toMatchObject({ costRequestId: `req-${proposalQuote.id}`, unitAmount: 130, currencyCode: 'USD', supplierQuoteRef: 'PCL-cost-sourcing-proposal' })
    expect(t.tails.get(proposalQuote.id)?.sourcingStatus).toBe('answered')
  })

  it('does not re-request when a saved recalculation already opened the request', async () => {
    const t = setup({ autoOpen: true })
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    expect(t.sourcing.request).not.toHaveBeenCalled()
    expect(t.sourcing.decline).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a second run creates nothing', async () => {
    const t = setup()
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    const quotesBefore = t.quotes.length
    t.quoting.createQuote.mockClear(); t.sourcing.answer.mockClear(); t.sourcing.decline.mockClear(); t.sourcing.request.mockClear()
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    expect(t.quotes).toHaveLength(quotesBefore)
    expect(t.quoting.createQuote).not.toHaveBeenCalled()
    expect(t.sourcing.request).not.toHaveBeenCalled()
    expect(t.sourcing.decline).not.toHaveBeenCalled()
    expect(t.sourcing.answer).not.toHaveBeenCalled()
  })

  it('does not apply the answer when the quote cannot move to with_customer', async () => {
    const t = setup({ failTransition: true })
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    expect(t.sourcing.answer).not.toHaveBeenCalled()
  })

  it('skips when Acme or the offering is missing', async () => {
    const t = setup()
    t.em.find.mockResolvedValue([])
    await seedGixCostSourcingExamples(t.em as never, t.container as never, scope)
    expect(t.quoting.createQuote).not.toHaveBeenCalled()
    const t2 = setup()
    t2.em.findOne.mockResolvedValue(null)
    await seedGixCostSourcingExamples(t2.em as never, t2.container as never, scope)
    expect(t2.quoting.createQuote).not.toHaveBeenCalled()
  })
})

describe('requestedAtWorkingDaysAgo', () => {
  it.each(['2026-11-16T10:00:00Z', '2026-11-14T10:00:00Z', '2026-11-18T23:00:00Z'])('is exactly %s minus %d working days or older', (iso) => {
    const now = new Date(iso)
    const at = requestedAtWorkingDaysAgo(OVERDUE_WORKING_DAYS, now)
    expect(workingDaysBetween(at, now)).toBe(OVERDUE_WORKING_DAYS)
    expect(CpqQuoteLineCost).toBeDefined()
  })
})
