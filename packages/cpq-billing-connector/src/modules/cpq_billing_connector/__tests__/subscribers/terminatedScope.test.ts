/**
 * Review F6: the terminate scope (whole subscription vs listed items) comes
 * from the event's `wholeSubscription` flag, decided by CPQ at emit time —
 * never from CPQ's current subscription status, which a replayed / late
 * item-level terminate would misread once the subscription ended later.
 */
const updateItem = jest.fn()
const findItemsBySubscription = jest.fn()
const findItemsBySubscriptionItem = jest.fn()
const getSubscription = jest.fn()
const listAssets = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'cpqInventoryService') return { getSubscription, listAssets }
      throw new Error(`unexpected resolve ${name}`)
    },
  })),
}))

jest.mock('../../lib/billingApiClient', () => ({
  BillingApiClient: jest.fn().mockImplementation(() => ({ updateItem, findItemsBySubscription, findItemsBySubscriptionItem })),
}))

import handleTerminated, { type TerminatedPayload } from '../../subscribers/cpq-subscription-terminated'

const itemA = { id: 'bi-A', billStartDate: '2026-12-01', billEndDate: null }
const itemB = { id: 'bi-B', billStartDate: '2026-12-01', billEndDate: null }
const deviceA = { id: 'bi-devA', billStartDate: '2026-12-01', billEndDate: null }

const base: TerminatedPayload = {
  tenantId: 't-1',
  organizationId: 'o-1',
  subscriptionId: 'sub-1',
  subscriptionItemIds: ['si-A'],
  effectiveDate: '2027-02-01',
}

function ended() {
  return updateItem.mock.calls.map(([, update]) => [update.id, update.billEndDate])
}

beforeEach(() => {
  updateItem.mockReset().mockResolvedValue({ id: 'x' })
  findItemsBySubscription.mockReset().mockResolvedValue([itemA, itemB, deviceA])
  findItemsBySubscriptionItem.mockReset().mockImplementation(async (_s: unknown, key: string) => {
    if (key === 'si-A') return [itemA]
    if (key === 'asset-A') return [deviceA]
    if (key === 'si-B') return [itemB]
    return []
  })
  // CPQ today: the subscription was terminated later (last item B on 06-01).
  getSubscription.mockReset().mockResolvedValue({ status: 'terminated' })
  listAssets.mockReset().mockImplementation(async (filters: { subscriptionItemId?: string }) => ({
    items: filters.subscriptionItemId === 'si-A' ? [{ id: 'asset-A' }] : [],
    totalPages: 1,
  }))
})

describe('cpq.subscription.terminated scope (review F6)', () => {
  it('a replayed item-level terminate ends only its items and devices, even once the subscription is terminated', async () => {
    await handleTerminated({ ...base, wholeSubscription: false } as TerminatedPayload)
    expect(findItemsBySubscription).not.toHaveBeenCalled()
    expect(getSubscription).not.toHaveBeenCalled()
    expect(ended()).toEqual([
      ['bi-A', '2027-01-31'],
      ['bi-devA', '2027-01-31'],
    ])
  })

  it('an event without the flag is item-level (never reads CPQ status)', async () => {
    await handleTerminated(base)
    expect(getSubscription).not.toHaveBeenCalled()
    expect(ended().map(([id]) => id)).toEqual(['bi-A', 'bi-devA'])
  })

  it('wholeSubscription: true ends every Billing Item of the subscription', async () => {
    getSubscription.mockResolvedValue({ status: 'active' })
    await handleTerminated({ ...base, subscriptionItemIds: [], wholeSubscription: true } as TerminatedPayload)
    expect(findItemsBySubscription).toHaveBeenCalledWith({ tenantId: 't-1', organizationId: 'o-1' }, 'sub-1')
    expect(findItemsBySubscriptionItem).not.toHaveBeenCalled()
    expect(ended().map(([id]) => id)).toEqual(['bi-A', 'bi-B', 'bi-devA'])
  })

  it('item-level with no listed items writes nothing', async () => {
    await handleTerminated({ ...base, subscriptionItemIds: [], wholeSubscription: false } as TerminatedPayload)
    expect(updateItem).not.toHaveBeenCalled()
  })
})
