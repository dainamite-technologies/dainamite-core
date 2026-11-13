import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteConfiguration } from '../../data/entities'
import { withQuotePricingWrite } from '../priceAdjustments/quotePricingWrite'
import { QuotingError } from '../cpqQuotingService'
const scope = { tenantId: 'tenant', organizationId: 'org' }
const error = (status: number, message: string) => new QuotingError(status, message)
function setup() {
  const quote = { id: 'quote', quoteId: 'sales', pricingRevision: 4 }
  const transaction = { findOne: jest.fn().mockResolvedValue(quote), flush: jest.fn().mockResolvedValue(undefined) }
  const isolated = { transactional: jest.fn().mockImplementation(async (fn: (em: typeof transaction) => Promise<unknown>) => fn(transaction)) }
  const root = { fork: jest.fn().mockReturnValue(isolated), transactional: jest.fn(), findOne: jest.fn(), flush: jest.fn() }
  return { quote, transaction, root, isolated, em: root as unknown as EntityManager }
}
it('locks and refreshes the tenant-scoped root and passes only the transaction EM to the write', async () => {
  const { quote, transaction, root, isolated, em } = setup()
  const result = await withQuotePricingWrite(em, 'quote', scope, async (tx, locked) => {
    expect(tx).toBe(transaction)
    expect(locked).toBe(quote)
    expect(locked.pricingRevision).toBe(5)
    await tx.flush()
    return 'saved'
  }, error, 4)
  expect(result).toBe('saved')
  expect(root.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
  expect(root.transactional).not.toHaveBeenCalled()
  expect(isolated.transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
  expect(transaction.findOne).toHaveBeenCalledWith(CpqQuoteConfiguration,
    { id: 'quote', tenantId: 'tenant', organizationId: 'org', deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
  expect(root.findOne).not.toHaveBeenCalled()
  expect(root.flush).not.toHaveBeenCalled()
  expect(quote.pricingRevision).toBe(5)
})
it('refuses a stale revision before calling the mutation or flushing', async () => {
  const { quote, transaction, em } = setup()
  const write = jest.fn()
  await expect(withQuotePricingWrite(em, 'quote', scope, write, error, 3)).rejects.toMatchObject({ status: 409, message: 'STALE_REVISION' })
  expect(write).not.toHaveBeenCalled()
  expect(transaction.flush).not.toHaveBeenCalled()
  expect(quote.pricingRevision).toBe(4)
})
it('locks the sales quote alias with the same scope when the CPQ id lookup misses', async () => {
  const { quote, transaction, em } = setup()
  transaction.findOne.mockResolvedValueOnce(null)
  await withQuotePricingWrite(em, 'sales', scope, async () => 'saved', error)
  expect(transaction.findOne).toHaveBeenLastCalledWith(CpqQuoteConfiguration,
    { quoteId: 'sales', ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
  expect(quote.pricingRevision).toBe(5)
})
it('does not execute an out-of-scope or missing quote', async () => {
  const { transaction, em } = setup()
  transaction.findOne.mockResolvedValue(null)
  const write = jest.fn()
  await expect(withQuotePricingWrite(em, 'missing', scope, write, error)).rejects.toMatchObject({ status: 404 })
  expect(write).not.toHaveBeenCalled()
})
it('propagates a write failure out of transactional so the database rolls back', async () => {
  const { transaction, isolated, em } = setup()
  const failure = new Error('Failed during reprice')
  await expect(withQuotePricingWrite(em, 'quote', scope, async () => { throw failure }, error)).rejects.toBe(failure)
  expect(isolated.transactional).toHaveBeenCalledTimes(1)
  // The revision is flushed before a dependent query can reset its change set;
  // the thrown error still rolls this SQL back in the real transaction.
  expect(transaction.flush).toHaveBeenCalledTimes(1)
})
it('refuses to run inside an ambient transaction instead of deadlocking on its own lock', async () => {
  const { root, em } = setup()
  Object.assign(root, { isInTransaction: () => true })
  const write = jest.fn()
  await expect(withQuotePricingWrite(em, 'quote', scope, write, error)).rejects.toThrow('must not run inside an existing transaction')
  expect(root.fork).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})

describe('createMarginTracker skip rules', () => {
  const { createMarginTracker } = jest.requireActual('../costs/quoteMarginTracker') as typeof import('../costs/quoteMarginTracker')
  const quoteView = jest.requireActual('../costs/quoteCostView') as typeof import('../costs/quoteCostView')
  const margin = { marginHash: 'h1', contractMargin: 1, marginPercent: 1, costCoverage: 1, hasPendingCosts: false, hasEstimatedCosts: false, hasExpiredCosts: false }
  let loadMargin: jest.SpyInstance
  beforeEach(() => { loadMargin = jest.spyOn(quoteView, 'loadQuoteMargin').mockResolvedValue(margin as never) })
  afterEach(() => loadMargin.mockRestore())
  const tx = (existing: unknown) => ({ findOne: jest.fn().mockResolvedValue(existing), count: jest.fn().mockResolvedValue(0) }) as unknown as EntityManager & { findOne: jest.Mock }
  const quote = { id: 'q', cpqStatus: 'ready' } as never

  it('is skipped without any query when the toggle is off', async () => {
    const em = tx({ id: 'c' })
    const tracker = createMarginTracker({ scope, isEnabled: async () => false })
    await tracker.before(em, quote)
    expect(await tracker.after(em, quote)).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(loadMargin).not.toHaveBeenCalled()
  })

  it('computes no margin for a quote without costs before or after the write (one existence query each side)', async () => {
    const em = tx(null)
    const tracker = createMarginTracker({ scope, isEnabled: async () => true })
    await tracker.before(em, quote)
    expect(await tracker.after(em, quote)).toBeNull()
    expect(em.findOne).toHaveBeenCalledTimes(2)
    expect(loadMargin).not.toHaveBeenCalled()
  })

  it('reports the margin of a write that creates the quote\'s first cost lines (no previous hash)', async () => {
    const em = tx(null)
    const tracker = createMarginTracker({ scope, isEnabled: async () => true })
    await tracker.before(em, quote)
    em.findOne.mockResolvedValue({ id: 'c' })
    expect(await tracker.after(em, quote)).toMatchObject({ previousMarginHash: null, marginHash: 'h1', approvalInvalidated: false })
    expect(loadMargin).toHaveBeenCalledTimes(1)
  })

  it('computes the before and after hashes for a quote with costs and flags no invalidation while ready', async () => {
    const em = tx({ id: 'c' })
    const tracker = createMarginTracker({ scope, isEnabled: async () => true })
    await tracker.before(em, quote)
    loadMargin.mockResolvedValue({ ...margin, marginHash: 'h2' } as never)
    expect(await tracker.after(em, quote)).toMatchObject({ previousMarginHash: 'h1', marginHash: 'h2', approvalInvalidated: false })
  })

  it('invalidates an approval when the margin moves past ready and no order exists', async () => {
    const em = tx({ id: 'c' })
    const tracker = createMarginTracker({ scope, isEnabled: async () => true, force: true })
    await tracker.before(em, { id: 'q', cpqStatus: 'in_approval' } as never)
    loadMargin.mockResolvedValue({ ...margin, marginHash: 'h2' } as never)
    expect(await tracker.after(em, { id: 'q', cpqStatus: 'in_approval' } as never)).toMatchObject({ approvalInvalidated: true })
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
