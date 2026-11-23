import {
  buildRenewalRemovedItemUpdates,
  selectItemsToExtend,
} from '../../subscribers/cpq-subscription-renewed'

describe('cpq.subscription.renewed: removed items and term extension', () => {
  const payload = { newTermStart: '2027-01-01', removedSubscriptionItemIds: ['si-removed'] }

  it('extends only items that run to the old term end', () => {
    const items = [
      { id: 'open', billStartDate: '2026-01-01', billEndDate: null, subscriptionItemId: 'si-a' },
      { id: 'fixed', billStartDate: '2026-01-01', billEndDate: '2026-12-31', subscriptionItemId: 'si-b' },
      { id: 'ended-early', billStartDate: '2026-01-01', billEndDate: '2026-06-30', subscriptionItemId: 'si-c' },
      { id: 'dropped', billStartDate: '2026-01-01', billEndDate: '2026-12-31', subscriptionItemId: 'si-removed' },
    ]
    expect(selectItemsToExtend(items, payload).map((i) => i.id)).toEqual(['fixed'])
  })

  it('keeps extending items already moved to the new term end (re-delivery)', () => {
    const items = [{ id: 'fixed', billStartDate: '2026-01-01', billEndDate: '2027-12-31', subscriptionItemId: 'si-b' }]
    expect(selectItemsToExtend(items, payload).map((i) => i.id)).toEqual(['fixed'])
  })

  it('ends removed items the day before the new term starts', () => {
    const updates = buildRenewalRemovedItemUpdates(
      [
        { id: 'bi-1', billStartDate: '2026-01-01', billEndDate: null },
        { id: 'bi-2', billStartDate: '2026-01-01', billEndDate: '2027-12-31' },
        { id: 'bi-3', billStartDate: '2026-01-01', billEndDate: '2026-10-31' },
      ],
      payload,
      'ORD-7',
    )
    expect(updates).toEqual([
      {
        id: 'bi-1',
        billEndDate: '2026-12-31',
        creditReasonCode: 'subscription_amended',
        creditReasonParams: { effectiveDate: '2027-01-01', reference: 'ORD-7' },
      },
      {
        id: 'bi-2',
        billEndDate: '2026-12-31',
        creditReasonCode: 'subscription_amended',
        creditReasonParams: { effectiveDate: '2027-01-01', reference: 'ORD-7' },
      },
    ])
  })

  it('ends a removed item that has not started yet before its start', () => {
    const [update] = buildRenewalRemovedItemUpdates(
      [{ id: 'bi-future', billStartDate: '2027-03-01', billEndDate: null }],
      payload,
    )
    expect(update.billEndDate).toBe('2027-02-28')
  })
})
