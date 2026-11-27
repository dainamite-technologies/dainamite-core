import {
  applyRerates,
  buildReratedItemPayload,
  buildReratedItems,
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

describe('arcRerate — items split per billing period (C2/C3)', () => {
  const split: CpqSubscriptionItem = {
    subscriptionItemId: 'si-1',
    productName: 'Bundle',
    quantity: 1,
    charges: [
      { type: 'recurring', unitPrice: 70, description: 'Recurring charge' },
      {
        type: 'recurring',
        unitPrice: 480,
        description: 'Recurring charge',
        billingPeriod: { unit: 'year', interval: 1 },
        phases: [{ name: 'Intro', months: 12, priceType: 'fixed', value: 400 }],
      },
      { type: 'one_time', amount: 10, description: 'Setup' },
    ],
  }

  it('creates one recurring item per period, each with its own period, phases and ref', () => {
    const { created, rejected } = buildReratedItems('acct-1', split, change)
    expect(rejected).toEqual([])
    expect(created).toEqual([
      expect.objectContaining({ sourceRef: newRef, rateJson: { unit_price: 70 }, billStartDate: '2026-12-15' }),
      expect.objectContaining({
        sourceRef: `${newRef}-1y`,
        rateJson: { unit_price: 480 },
        billingPeriodUnit: 'annually',
        billingPeriodInterval: 1,
        phasesEnabled: true,
        phases: [{ name: 'Intro', durationUnit: 'month', durationCount: 12, priceType: 'fixed', value: 400 }],
      }),
    ])
    expect(created[0]).not.toHaveProperty('billingPeriodUnit')
  })

  it('keeps the monthly re-rate ref byte-identical', () => {
    expect(reratedSourceRef('sub-1', 'si-1', 'order-9', { unit: 'month', interval: 1 })).toBe(newRef)
    expect(reratedSourceRef('sub-1', 'si-1', 'order-9', { unit: 'month', interval: 3 })).toBe(`${newRef}-3m`)
  })

  it('ends every old recurring period but never the items it created itself (any period)', () => {
    const existing = [
      { id: 'old-m', type: 'recurring', sourceRef: 'cpq-sub-1-si-1-recurring', billStartDate: '2026-01-01' },
      { id: 'old-y', type: 'recurring', sourceRef: 'cpq-sub-1-si-1-recurring-1y', billStartDate: '2026-01-01' },
      { id: 'new-m', type: 'recurring', sourceRef: newRef, billStartDate: '2026-12-15' },
      { id: 'new-y', type: 'recurring', sourceRef: `${newRef}-1y`, billStartDate: '2026-12-15' },
    ]
    expect(buildRerateEndUpdates(existing, split, change).map((u) => u.id)).toEqual(['old-m', 'old-y'])
  })

  it('leaves the item on its current price when a new charge is refused (13 phases)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const tooMany: CpqSubscriptionItem = {
      ...split,
      charges: [
        split.charges[0],
        { ...split.charges[1], phases: Array.from({ length: 13 }, () => ({ name: null, months: 1, priceType: 'fixed' as const, value: 1 })) },
      ],
    }
    const api = {
      findItemsBySubscriptionItem: jest.fn().mockResolvedValue([
        { id: 'old-m', type: 'recurring', sourceRef: 'cpq-sub-1-si-1-recurring', billStartDate: '2026-01-01' },
      ]),
      bulkCreateItems: jest.fn(),
      updateItem: jest.fn(),
    }
    await applyRerates(api as never, { tenantId: 't', organizationId: 'o' }, 'acct-1', [tooMany], change)
    expect(api.bulkCreateItems).not.toHaveBeenCalled()
    expect(api.updateItem).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[cpq-billing-connector] charge refused, no billing item created',
      expect.objectContaining({ reason: 'too_many_phases', event: 'cpq.subscription.amended', sourceRef: `${newRef}-1y` }),
    )
    errorSpy.mockRestore()
  })
})
