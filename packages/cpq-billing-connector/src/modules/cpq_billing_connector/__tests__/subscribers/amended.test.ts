import {
  buildAddedItemPayloads,
  removedItemEndDate,
  type AmendedPayload,
} from '../../subscribers/cpq-subscription-amended'

const payload: AmendedPayload = {
  tenantId: 't-1',
  organizationId: 'o-1',
  subscriptionId: 'sub-1',
  customerId: 'cust-1',
  effectiveDate: '2026-11-14',
  addedItems: [
    {
      subscriptionItemId: 'si-1',
      productName: 'Static IP',
      quantity: 1,
      charges: [{ type: 'recurring', unitPrice: 30, description: 'Static IP' }],
    },
  ],
}

describe('cpq-subscription-amended', () => {
  it('creates the added recurring item from the effective date and no proration line (billing prorates)', () => {
    const items = buildAddedItemPayloads('acc-1', payload)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      billAccountId: 'acc-1',
      type: 'recurring',
      billStartDate: '2026-11-14',
      subscriptionId: 'sub-1',
      subscriptionItemId: 'si-1',
    })
    expect(items.some((item) => item.type === 'one_time')).toBe(false)
  })

  it('returns nothing to create when only removals are amended', () => {
    expect(buildAddedItemPayloads('acc-1', { ...payload, addedItems: [] })).toEqual([])
  })

  it('end-dates removed items the day before the effective date', () => {
    expect(removedItemEndDate('2026-12-01')).toBe('2026-11-30')
  })
})
