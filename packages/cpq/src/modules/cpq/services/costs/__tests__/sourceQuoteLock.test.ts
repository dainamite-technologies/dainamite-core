import { LockMode } from '@mikro-orm/core'
import { CpqInventorySubscription, CpqQuoteConfiguration } from '../../../data/entities'
import { lockSourceQuote, lockSubscriptions, subscriptionLockOrder } from '../sourceQuoteLock'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('lockSourceQuote', () => {
  it('takes PESSIMISTIC_WRITE with a refresh on the scoped, non-deleted quote row and returns it', async () => {
    const quote = { id: 'q-1' }
    const tx = { findOne: jest.fn().mockResolvedValue(quote) }
    await expect(lockSourceQuote(tx as never, 'q-1', SCOPE)).resolves.toBe(quote)
    expect(tx.findOne).toHaveBeenCalledWith(
      CpqQuoteConfiguration,
      { id: 'q-1', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    )
  })

  it('locks nothing for an order without a source quote, and returns null for a vanished quote', async () => {
    const tx = { findOne: jest.fn().mockResolvedValue(null) }
    await expect(lockSourceQuote(tx as never, null, SCOPE)).resolves.toBeNull()
    await expect(lockSourceQuote(tx as never, undefined, SCOPE)).resolves.toBeNull()
    expect(tx.findOne).not.toHaveBeenCalled()
    await expect(lockSourceQuote(tx as never, 'gone', SCOPE)).resolves.toBeNull()
  })
})

describe('lockSubscriptions', () => {
  it('locks the unique ids in ascending order with one query, ordered by id, scoped and non-deleted', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const tx = { find: jest.fn().mockResolvedValue(rows) }
    await expect(lockSubscriptions(tx as never, ['b', 'a', 'b'], SCOPE)).resolves.toBe(rows)
    expect(tx.find).toHaveBeenCalledTimes(1)
    expect(tx.find).toHaveBeenCalledWith(
      CpqInventorySubscription,
      { id: { $in: ['a', 'b'] }, organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, orderBy: { id: 'asc' } },
    )
  })

  it('reads nothing for no ids', async () => {
    const tx = { find: jest.fn() }
    await expect(lockSubscriptions(tx as never, [], SCOPE)).resolves.toEqual([])
    expect(tx.find).not.toHaveBeenCalled()
  })

  it('subscriptionLockOrder sorts and de-duplicates', () => {
    expect(subscriptionLockOrder(['c', 'a', 'b', 'a'])).toEqual(['a', 'b', 'c'])
  })
})
