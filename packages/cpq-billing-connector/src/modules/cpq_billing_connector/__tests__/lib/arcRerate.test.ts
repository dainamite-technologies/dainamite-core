import {
  applyRerates,
  buildReratedItemPayload,
  buildRerateEndUpdates,
  reratedSourceRef,
  type RerateChange,
} from '../../lib/arcRerate'
import type { CpqSubscriptionItem } from '../../lib/chargeMapper'

const change: RerateChange = {
  subscriptionId: 'sub-1',
  effectiveDate: '2026-12-15',
  sourceOrderId: 'order-9',
  code: 'subscription_amended',
  reference: 'ORD-9',
}

const item: CpqSubscriptionItem = {
  subscriptionItemId: 'si-1',
  productName: 'Internet 600',
  quantity: 1,
  charges: [{ type: 'recurring', unitPrice: 70, description: 'Recurring charge' }],
}

const newRef = reratedSourceRef('sub-1', 'si-1', 'order-9')

describe('arcRerate (#126)', () => {
  it('creates one recurring item at the new price from the effective date', () => {
    expect(buildReratedItemPayload('acct-1', item, change)).toEqual({
      billAccountId: 'acct-1',
      type: 'recurring',
      billStartDate: '2026-12-15',
      description: expect.stringContaining('Internet 600'),
      rateJson: { unit_price: 70 },
      subscriptionId: 'sub-1',
      subscriptionItemId: 'si-1',
      sourceRef: newRef,
    })
  })

  it('creates nothing when the new recurring price is zero', () => {
    expect(buildReratedItemPayload('acct-1', { ...item, charges: [] }, change)).toBeNull()
  })

  it('falls back to the effective date in the source ref without an order id', () => {
    expect(buildReratedItemPayload('acct-1', item, { ...change, sourceOrderId: null })?.sourceRef).toBe(
      reratedSourceRef('sub-1', 'si-1', '2026-12-15'),
    )
  })

  it('ends the old recurring items the day before, never one-time items or the re-rated item itself', () => {
    const updates = buildRerateEndUpdates(
      [
        { id: 'old-mrc', type: 'recurring', sourceRef: 'cpq-sub-1-si-1-recurring', billStartDate: '2026-01-01' },
        { id: 'nrc', type: 'one_time', sourceRef: 'cpq-sub-1-si-1-one_time', billStartDate: '2026-01-01' },
        { id: 'own', type: 'recurring', sourceRef: newRef, billStartDate: '2026-12-15' },
      ],
      item,
      change,
    )
    expect(updates.map((update) => update.id)).toEqual(['old-mrc'])
    expect(updates[0]).toMatchObject({ billEndDate: '2026-12-14' })
  })

  it('applies create then end dates per changed item', async () => {
    const calls: string[] = []
    const billingApi = {
      findItemsBySubscriptionItem: jest.fn(async () => [
        { id: 'old-mrc', type: 'recurring', sourceRef: 'cpq-sub-1-si-1-recurring', billStartDate: '2026-01-01' },
      ]),
      bulkCreateItems: jest.fn(async () => {
        calls.push('create')
        return { items: [] }
      }),
      updateItem: jest.fn(async () => {
        calls.push('end')
        return { id: 'old-mrc' }
      }),
    }
    await applyRerates(billingApi as never, { tenantId: 't', organizationId: 'o' }, 'acct-1', [item], change)
    expect(calls).toEqual(['create', 'end'])
    expect(billingApi.bulkCreateItems).toHaveBeenCalledWith({ tenantId: 't', organizationId: 'o' }, [
      expect.objectContaining({ sourceRef: newRef, rateJson: { unit_price: 70 } }),
    ])
  })
})
