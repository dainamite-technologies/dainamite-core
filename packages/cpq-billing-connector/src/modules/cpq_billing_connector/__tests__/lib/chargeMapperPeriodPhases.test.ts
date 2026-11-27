import {
  billingItemCreateFields,
  buildSourceRef,
  mapBillingPeriod,
  mapCharge,
  mapSubscriptionItemsToBillingItems,
  mapSubscriptionItemsWithRejections,
  type CpqCharge,
  type CpqChargePhase,
  type CpqSubscriptionItem,
} from '../../lib/chargeMapper'

/**
 * Contract C3 (run plan 2026-11-26 billing/CPQ flex): line period, sourceRef
 * suffix and price phases on the connector mapping, plus the refusal of a
 * charge billing cannot take (more than 12 phases is never trimmed).
 */

const item = (charges: CpqCharge[], id = 'si-1'): CpqSubscriptionItem => ({
  subscriptionItemId: id,
  productName: 'Mobile',
  quantity: 1,
  charges,
})

const phase = (months: number, value: number, name: string | null = null): CpqChargePhase => ({
  name,
  months,
  priceType: 'fixed',
  value,
})

const map = (charge: CpqCharge) =>
  mapCharge({ subscriptionId: 'sub-1', subscriptionItem: item([charge]), charge, billStartDate: '2026-12-10' })

describe('mapBillingPeriod', () => {
  it.each([
    [undefined, null],
    [{ unit: 'month', interval: 1 }, null],
    [{ unit: 'month', interval: 3 }, { unit: 'monthly', interval: 3 }],
    [{ unit: 'year', interval: 1 }, { unit: 'annually', interval: 1 }],
    [{ unit: 'year', interval: 2 }, { unit: 'annually', interval: 2 }],
    // billing caps monthly at 24: a whole number of years goes out annually
    [{ unit: 'month', interval: 36 }, { unit: 'annually', interval: 3 }],
    [{ unit: 'month', interval: 30 }, 'invalid'],
    [{ unit: 'year', interval: 6 }, 'invalid'],
    [{ unit: 'month', interval: 0 }, 'invalid'],
    [{ unit: 'week', interval: 1 }, 'invalid'],
  ])('%j → %j', (input, expected) => {
    expect(mapBillingPeriod(input as never)).toEqual(expected)
  })
})

describe('sourceRef suffix (C3)', () => {
  it('keeps the every-1-month ref byte-identical (idempotency of older events)', () => {
    expect(buildSourceRef('s', 'i', 'recurring')).toBe('cpq-s-i-recurring')
    expect(buildSourceRef('s', 'i', 'recurring', { unit: 'month', interval: 1 })).toBe('cpq-s-i-recurring')
  })

  it('appends -<interval><m|y> for other periods', () => {
    expect(buildSourceRef('s', 'i', 'recurring', { unit: 'year', interval: 1 })).toBe('cpq-s-i-recurring-1y')
    expect(buildSourceRef('s', 'i', 'recurring', { unit: 'month', interval: 3 })).toBe('cpq-s-i-recurring-3m')
  })

  it('never suffixes a one-time charge', () => {
    expect(buildSourceRef('s', 'i', 'one_time', { unit: 'year', interval: 1 })).toBe('cpq-s-i-one_time')
  })
})

describe('mapCharge — period and phases', () => {
  it('a monthly charge without phases maps exactly as before (no period / phase fields)', () => {
    const result = map({ type: 'recurring', unitPrice: 79_900, description: 'Recurring charge' })
    expect(result).toEqual({
      ok: true,
      payload: {
        type: 'recurring',
        description: 'Mobile — Recurring charge',
        rateJson: { unit_price: 79_900 },
        subscriptionId: 'sub-1',
        subscriptionItemId: 'si-1',
        sourceRef: 'cpq-sub-1-si-1-recurring',
        billStartDate: '2026-12-10',
      },
    })
  })

  it('an annual charge gets its own period and the -1y ref', () => {
    const result = map({ type: 'recurring', unitPrice: 480_000, description: 'Recurring charge', billingPeriod: { unit: 'year', interval: 1 } })
    expect(result.ok && result.payload).toMatchObject({
      sourceRef: 'cpq-sub-1-si-1-recurring-1y',
      billingPeriodUnit: 'annually',
      billingPeriodInterval: 1,
      rateJson: { unit_price: 480_000 },
    })
  })

  it('phases become fixed month phases, switched on, in the same payload', () => {
    const result = map({
      type: 'recurring',
      unitPrice: 79_900,
      description: 'Recurring charge',
      phases: [phase(1, 0, 'Free trial'), phase(2, 39_950, 'Promo 50%')],
    })
    expect(result.ok && result.payload).toMatchObject({
      sourceRef: 'cpq-sub-1-si-1-recurring',
      phasesEnabled: true,
      phases: [
        { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'fixed', value: 0 },
        { name: 'Promo 50%', durationUnit: 'month', durationCount: 2, priceType: 'fixed', value: 39_950 },
      ],
    })
    expect(result.ok && result.payload.billingPeriodUnit).toBeUndefined()
  })

  it('trims merged phase names to billing’s 120 characters', () => {
    const long = 'x'.repeat(200)
    const result = map({ type: 'recurring', unitPrice: 10, description: 'R', phases: [phase(1, 5, long)] })
    expect(result.ok && result.payload.phases?.[0].name).toHaveLength(120)
  })

  it('accepts exactly 12 phases', () => {
    const phases = Array.from({ length: 12 }, (_, i) => phase(1, i))
    const result = map({ type: 'recurring', unitPrice: 10, description: 'R', phases })
    expect(result.ok && result.payload.phases).toHaveLength(12)
  })
})

describe('mapCharge — refusals (never trimmed)', () => {
  it('refuses more than 12 merged phases instead of dropping the extra ones', () => {
    const phases = Array.from({ length: 13 }, (_, i) => phase(1, i))
    const result = map({ type: 'recurring', unitPrice: 10, description: 'R', phases, billingPeriod: { unit: 'month', interval: 3 } })
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        reason: 'too_many_phases',
        subscriptionItemId: 'si-1',
        sourceRef: 'cpq-sub-1-si-1-recurring-3m',
        detail: expect.stringContaining('13 phases'),
      }),
    })
  })

  it.each([
    [[phase(0, 1)], 'invalid_phase'],
    [[phase(1, -1)], 'invalid_phase'],
    [[{ name: null, months: 1.5, priceType: 'fixed', value: 1 }], 'invalid_phase'],
  ])('refuses a malformed phase %j', (phases, reason) => {
    const result = map({ type: 'recurring', unitPrice: 10, description: 'R', phases: phases as CpqChargePhase[] })
    expect(!result.ok && result.rejection.reason).toBe(reason)
  })

  it('refuses a period billing cannot represent', () => {
    const result = map({ type: 'recurring', unitPrice: 10, description: 'R', billingPeriod: { unit: 'month', interval: 30 } })
    expect(!result.ok && result.rejection.reason).toBe('invalid_billing_period')
  })

  it('refuses a recurring charge without a price', () => {
    const result = map({ type: 'recurring', description: 'R' })
    expect(!result.ok && result.rejection.reason).toBe('missing_unit_price')
  })
})

describe('mapSubscriptionItemsToBillingItems — failure path', () => {
  let errorSpy: jest.SpyInstance
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => errorSpy.mockRestore())

  const tooMany = Array.from({ length: 13 }, (_, i) => phase(1, i))
  const items = [
    item([
      { type: 'one_time', amount: 50, description: 'Setup' },
      { type: 'recurring', unitPrice: 100, description: 'Monthly' },
      { type: 'recurring', unitPrice: 1200, description: 'Annual', billingPeriod: { unit: 'year', interval: 1 }, phases: tooMany },
    ]),
    item([{ type: 'recurring', unitPrice: 30, description: 'Other' }], 'si-2'),
  ]

  it('refuses only the bad charge, creates the others, and logs the refusal', () => {
    const payloads = mapSubscriptionItemsToBillingItems({
      subscriptionId: 'sub-1',
      items,
      billStartDate: '2026-12-01',
      event: 'cpq.subscription.activated',
    })
    expect(payloads.map((p) => p.sourceRef)).toEqual([
      'cpq-sub-1-si-1-one_time',
      'cpq-sub-1-si-1-recurring',
      'cpq-sub-1-si-2-recurring',
    ])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      '[cpq-billing-connector] charge refused, no billing item created',
      expect.objectContaining({
        event: 'cpq.subscription.activated',
        reason: 'too_many_phases',
        sourceRef: 'cpq-sub-1-si-1-recurring-1y',
      }),
    )
  })

  it('mapSubscriptionItemsWithRejections returns the refusals without logging', () => {
    const { payloads, rejected } = mapSubscriptionItemsWithRejections({ subscriptionId: 'sub-1', items, billStartDate: '2026-12-01' })
    expect(payloads).toHaveLength(3)
    expect(rejected.map((r) => r.reason)).toEqual(['too_many_phases'])
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('billingItemCreateFields', () => {
  it('omits period and phase fields for a plain monthly charge (create payload unchanged)', () => {
    const result = map({ type: 'recurring', unitPrice: 5, description: 'R' })
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(billingItemCreateFields(result.payload)).sort()).toEqual(
      ['billStartDate', 'description', 'rateJson', 'sourceRef', 'subscriptionId', 'subscriptionItemId', 'type'].sort(),
    )
  })

  it('carries period and phases when set', () => {
    const result = map({
      type: 'recurring',
      unitPrice: 5,
      description: 'R',
      billingPeriod: { unit: 'year', interval: 1 },
      phases: [phase(12, 4)],
    })
    if (!result.ok) throw new Error('expected ok')
    expect(billingItemCreateFields(result.payload)).toMatchObject({
      billingPeriodUnit: 'annually',
      billingPeriodInterval: 1,
      phasesEnabled: true,
      phases: [{ durationUnit: 'month', durationCount: 12, priceType: 'fixed', value: 4 }],
    })
  })
})
