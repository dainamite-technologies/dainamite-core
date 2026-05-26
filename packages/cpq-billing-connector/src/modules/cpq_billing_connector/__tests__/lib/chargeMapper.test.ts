import {
  buildSourceRef,
  mapChargeToBillingItem,
  mapSubscriptionItemsToBillingItems,
  type CpqCharge,
  type CpqSubscriptionItem,
} from '../../lib/chargeMapper'

const SUB_ID = 'sub-1'
const SUB_ITEM_ID = 'sub-item-1'
const BILL_START = '2026-05-01'

function subItem(charges: CpqCharge[], overrides: Partial<CpqSubscriptionItem> = {}): CpqSubscriptionItem {
  return {
    subscriptionItemId: overrides.subscriptionItemId ?? SUB_ITEM_ID,
    productName: overrides.productName ?? 'Plan Pro',
    quantity: overrides.quantity ?? 1,
    charges,
  }
}

describe('buildSourceRef', () => {
  it('produces a deterministic key including all 3 components', () => {
    expect(buildSourceRef('s1', 'i1', 'recurring')).toBe('cpq-s1-i1-recurring')
  })

  it('different charge types yield different keys for the same item', () => {
    expect(buildSourceRef('s1', 'i1', 'recurring')).not.toEqual(
      buildSourceRef('s1', 'i1', 'one_time'),
    )
  })
})

describe('mapChargeToBillingItem — one_time', () => {
  it('maps a well-formed one_time charge', () => {
    const charge: CpqCharge = { type: 'one_time', amount: 99, description: 'Activation fee' }
    const result = mapChargeToBillingItem({
      subscriptionId: SUB_ID,
      subscriptionItem: subItem([charge]),
      charge,
      billStartDate: BILL_START,
    })
    expect(result).toMatchObject({
      type: 'one_time',
      description: 'Plan Pro — Activation fee',
      rateJson: { amount: 99 },
      subscriptionId: SUB_ID,
      subscriptionItemId: SUB_ITEM_ID,
      sourceRef: `cpq-${SUB_ID}-${SUB_ITEM_ID}-one_time`,
      billStartDate: BILL_START,
    })
  })

  it('returns null when one_time is missing amount', () => {
    const charge = { type: 'one_time' as const, description: 'No amount' }
    const result = mapChargeToBillingItem({
      subscriptionId: SUB_ID,
      subscriptionItem: subItem([charge]),
      charge,
      billStartDate: BILL_START,
    })
    expect(result).toBeNull()
  })
})

describe('mapChargeToBillingItem — recurring', () => {
  it('maps a well-formed recurring charge to unit_price rate_json', () => {
    const charge: CpqCharge = { type: 'recurring', unitPrice: 49.99, description: 'MRC' }
    const result = mapChargeToBillingItem({
      subscriptionId: SUB_ID,
      subscriptionItem: subItem([charge]),
      charge,
      billStartDate: BILL_START,
    })
    expect(result).toMatchObject({
      type: 'recurring',
      description: 'Plan Pro — MRC',
      rateJson: { unit_price: 49.99 },
      sourceRef: `cpq-${SUB_ID}-${SUB_ITEM_ID}-recurring`,
    })
  })

  it('returns null when recurring is missing unitPrice', () => {
    const charge = { type: 'recurring' as const, description: 'No price' }
    const result = mapChargeToBillingItem({
      subscriptionId: SUB_ID,
      subscriptionItem: subItem([charge]),
      charge,
      billStartDate: BILL_START,
    })
    expect(result).toBeNull()
  })
})

describe('mapSubscriptionItemsToBillingItems', () => {
  it('one item with both one_time + recurring → TWO billing items (spec rule)', () => {
    const item = subItem([
      { type: 'one_time', amount: 99, description: 'Activation' },
      { type: 'recurring', unitPrice: 49.99, description: 'MRC' },
    ])
    const result = mapSubscriptionItemsToBillingItems({
      subscriptionId: SUB_ID,
      items: [item],
      billStartDate: BILL_START,
    })
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.type)).toEqual(['one_time', 'recurring'])
    // Both items share the same subscriptionItemId but differ in sourceRef
    // because the type is embedded in the key.
    expect(result[0].sourceRef).not.toEqual(result[1].sourceRef)
  })

  it('skips malformed charges (no amount on one_time, no unitPrice on recurring)', () => {
    const item = subItem([
      { type: 'one_time', amount: 99, description: 'OK' },
      { type: 'recurring', description: 'No price' }, // skipped
      { type: 'one_time', description: 'No amount' }, // skipped
    ])
    const result = mapSubscriptionItemsToBillingItems({
      subscriptionId: SUB_ID,
      items: [item],
      billStartDate: BILL_START,
    })
    expect(result).toHaveLength(1)
    expect(result[0].rateJson).toEqual({ amount: 99 })
  })

  it('walks multiple subscription items independently', () => {
    const a = subItem(
      [{ type: 'recurring', unitPrice: 10, description: 'Plan A MRC' }],
      { subscriptionItemId: 'i-a', productName: 'Plan A' },
    )
    const b = subItem(
      [{ type: 'recurring', unitPrice: 20, description: 'Plan B MRC' }],
      { subscriptionItemId: 'i-b', productName: 'Plan B' },
    )
    const result = mapSubscriptionItemsToBillingItems({
      subscriptionId: SUB_ID,
      items: [a, b],
      billStartDate: BILL_START,
    })
    expect(result.map((r) => r.subscriptionItemId)).toEqual(['i-a', 'i-b'])
    expect(result.map((r) => r.description)).toEqual([
      'Plan A — Plan A MRC',
      'Plan B — Plan B MRC',
    ])
  })

  it('empty items array → empty result', () => {
    expect(
      mapSubscriptionItemsToBillingItems({
        subscriptionId: SUB_ID,
        items: [],
        billStartDate: BILL_START,
      }),
    ).toEqual([])
  })
})
