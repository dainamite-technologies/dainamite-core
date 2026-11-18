/**
 * ARC end dates (Part 2, 6b): the amended / cancelled / superseded
 * subscribers clamp each item's end to `max(effective − 1, billStart − 1)`
 * and send the generated credit reason with every end-date write.
 */
const updateItem = jest.fn()
const findItemsBySubscription = jest.fn()
const findItemsBySubscriptionItem = jest.fn()
const getOrder = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'cpqOrderService') return { getOrder }
      throw new Error(`unexpected resolve ${name}`)
    },
  })),
}))

jest.mock('../../lib/billingApiClient', () => ({
  BillingApiClient: jest.fn().mockImplementation(() => ({
    updateItem,
    findItemsBySubscription,
    findItemsBySubscriptionItem,
    findAccountByCustomer: jest.fn(),
    findAccountById: jest.fn(),
    bulkCreateItems: jest.fn(),
  })),
}))

import handleAmended from '../../subscribers/cpq-subscription-amended'
import handleCancelled from '../../subscribers/cpq-subscription-cancelled'
import handleSuperseded from '../../subscribers/cpq-subscription-superseded'

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const started = { id: 'started', billAccountId: 'acc-1', billStartDate: new Date('2026-10-01T00:00:00Z'), billEndDate: null }
const notStarted = { id: 'future', billAccountId: 'acc-1', billStartDate: new Date('2026-11-20T00:00:00Z'), billEndDate: null }

function writes() {
  return updateItem.mock.calls.map(([, update]) => update)
}

beforeEach(() => {
  updateItem.mockReset().mockResolvedValue({ id: 'x' })
  findItemsBySubscription.mockReset().mockResolvedValue([started, notStarted])
  findItemsBySubscriptionItem.mockReset().mockResolvedValue([started, notStarted])
  getOrder.mockReset().mockResolvedValue({ id: 'order-1', orderNumber: 'SO-1234' })
})

describe('cpq-subscription-cancelled', () => {
  it('ends a started item at effective − 1 and a not-yet-started one at start − 1, with the reason', async () => {
    await handleCancelled({ ...scope, subscriptionId: 'sub-1', effectiveDate: '2026-11-16', sourceOrderId: 'order-1' })
    expect(writes()).toEqual([
      {
        id: 'started',
        billEndDate: '2026-11-15',
        creditReasonCode: 'subscription_cancelled',
        creditReasonParams: { reference: 'SO-1234', effectiveDate: '2026-11-16' },
      },
      {
        id: 'future',
        billEndDate: '2026-11-19',
        creditReasonCode: 'subscription_cancelled',
        creditReasonParams: { reference: 'SO-1234', effectiveDate: '2026-11-16' },
      },
    ])
    expect(getOrder).toHaveBeenCalledWith('order-1', scope)
  })

  it('omits the reference when the event has no order, and still writes', async () => {
    await handleCancelled({ ...scope, subscriptionId: 'sub-1', effectiveDate: '2026-11-16' })
    expect(writes()[0].creditReasonParams).toEqual({ effectiveDate: '2026-11-16' })
    expect(getOrder).not.toHaveBeenCalled()
  })

  it('omits the reference when the order lookup fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    getOrder.mockRejectedValue(new Error('gone'))
    await handleCancelled({ ...scope, subscriptionId: 'sub-1', effectiveDate: '2026-11-16', sourceOrderId: 'order-1' })
    expect(writes()).toHaveLength(2)
    expect(writes()[0].creditReasonParams).toEqual({ effectiveDate: '2026-11-16' })
    warn.mockRestore()
  })

  it('writes nothing (and reads no order) on a re-delivered event', async () => {
    findItemsBySubscription.mockResolvedValue([
      { ...started, billEndDate: new Date('2026-11-15T00:00:00Z') },
      { ...notStarted, billEndDate: new Date('2026-11-19T00:00:00Z') },
    ])
    await handleCancelled({ ...scope, subscriptionId: 'sub-1', effectiveDate: '2026-11-16', sourceOrderId: 'order-1' })
    expect(updateItem).not.toHaveBeenCalled()
    expect(getOrder).not.toHaveBeenCalled()
  })
})

describe('cpq-subscription-superseded', () => {
  it('clamps and sends subscription_superseded', async () => {
    await handleSuperseded({ ...scope, subscriptionId: 'sub-1', effectiveDate: '2026-11-16', sourceOrderId: 'order-1' })
    expect(writes().map((w) => [w.id, w.billEndDate, w.creditReasonCode])).toEqual([
      ['started', '2026-11-15', 'subscription_superseded'],
      ['future', '2026-11-19', 'subscription_superseded'],
    ])
  })
})

describe('cpq-subscription-amended (removed items)', () => {
  it('clamps the removed items and sends subscription_amended with the order number', async () => {
    await handleAmended({
      ...scope,
      subscriptionId: 'sub-1',
      customerId: 'c-1',
      effectiveDate: '2026-11-16',
      removedSubscriptionItemIds: ['si-1'],
      sourceOrderId: 'order-1',
    })
    expect(findItemsBySubscriptionItem).toHaveBeenCalledWith(scope, 'si-1')
    expect(writes()).toEqual([
      expect.objectContaining({
        id: 'started',
        billEndDate: '2026-11-15',
        creditReasonCode: 'subscription_amended',
        creditReasonParams: { reference: 'SO-1234', effectiveDate: '2026-11-16' },
      }),
      expect.objectContaining({ id: 'future', billEndDate: '2026-11-19', creditReasonCode: 'subscription_amended' }),
    ])
  })
})
