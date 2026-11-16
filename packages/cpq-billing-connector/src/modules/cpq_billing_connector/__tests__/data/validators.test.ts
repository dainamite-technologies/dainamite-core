import { accountOverridesSchema, isoDateSchema, orderSetupUpsertSchema } from '../../data/validators'

const ACCOUNT = '33333333-3333-4333-8333-333333333333'
const LINE = '11111111-1111-4111-8111-111111111111'

describe('order setup validators', () => {
  it('requires billingAccountId for an existing account', () => {
    expect(orderSetupUpsertSchema.safeParse({ accountMode: 'existing' }).success).toBe(false)
    expect(orderSetupUpsertSchema.safeParse({ accountMode: 'existing', billingAccountId: ACCOUNT }).success).toBe(true)
  })

  it('accepts a new account with overrides and per-line bill starts', () => {
    expect(
      orderSetupUpsertSchema.safeParse({
        accountMode: 'new',
        accountOverrides: { name: 'X', invoiceLanguage: 'ES', billCycle: 'monthly', billCycleInterval: 3, billCycleDay: '15' },
        defaultBillStartDate: null,
        lineBillStarts: { [LINE]: '2026-12-15' },
      }).success,
    ).toBe(true)
  })

  it('rejects unknown keys, unsupported languages and non-uuid line keys', () => {
    expect(orderSetupUpsertSchema.safeParse({ accountMode: 'new', extra: true }).success).toBe(false)
    expect(accountOverridesSchema.safeParse({ invoiceLanguage: 'fr' }).success).toBe(false)
    expect(accountOverridesSchema.safeParse({ color: 'red' }).success).toBe(false)
    expect(
      orderSetupUpsertSchema.safeParse({ accountMode: 'new', lineBillStarts: { 'line-1': '2026-12-15' } }).success,
    ).toBe(false)
  })

  it('validates addresses with billing’s own schema', () => {
    expect(accountOverridesSchema.safeParse({ invoiceAddress: { line1: 'a', city: 'b' } }).success).toBe(false)
    expect(
      accountOverridesSchema.safeParse({ invoiceAddress: { line1: 'a', city: 'b', postal_code: 'c', country: 'CO' } }).success,
    ).toBe(true)
  })

  it('accepts only real calendar dates', () => {
    expect(isoDateSchema.safeParse('2026-02-28').success).toBe(true)
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-2-1').success).toBe(false)
  })
})

describe('account override bill cycle', () => {
  it('rejects the removed quarterly unit and the old anchor field', () => {
    expect(accountOverridesSchema.safeParse({ billCycle: 'quarterly' }).success).toBe(false)
    expect(accountOverridesSchema.safeParse({ billCycleAnchor: '1' }).success).toBe(false)
  })

  it('normalizes the day and coerces the interval', () => {
    const parsed = accountOverridesSchema.parse({ billCycle: 'monthly', billCycleInterval: '2', billCycleDay: '05' })
    expect(parsed).toEqual({ billCycle: 'monthly', billCycleInterval: 2, billCycleDay: '5' })
    expect(accountOverridesSchema.parse({ billCycle: 'weekly', billCycleDay: ' Mon ' }).billCycleDay).toBe('mon')
  })

  it('accepts every valid unit / day combination', () => {
    for (const value of [
      { billCycle: 'daily', billCycleInterval: 30, billCycleDay: null },
      { billCycle: 'weekly', billCycleInterval: 2, billCycleDay: 'fri' },
      { billCycle: 'monthly', billCycleInterval: 24, billCycleDay: '31' },
      { billCycle: 'annually', billCycleInterval: 1, billCycleDay: '1' },
      { billCycle: 'daily' },
      { billCycle: 'weekly' },
    ]) {
      expect(accountOverridesSchema.safeParse(value).success).toBe(true)
    }
  })

  it.each([
    [{ billCycle: 'weekly', billCycleDay: '15' }, 'billCycleDay'],
    [{ billCycle: 'monthly', billCycleDay: 'mon' }, 'billCycleDay'],
    [{ billCycle: 'daily', billCycleDay: '1' }, 'billCycleDay'],
    [{ billCycle: 'monthly', billCycleInterval: 25 }, 'billCycleInterval'],
    [{ billCycle: 'annually', billCycleInterval: 6 }, 'billCycleInterval'],
    [{ billCycle: 'weekly', billCycleInterval: 53, billCycleDay: 'mon' }, 'billCycleInterval'],
    // No unit override → checked against the default monthly unit.
    [{ billCycleDay: 'mon' }, 'billCycleDay'],
  ])('rejects the invalid combination %j on %s', (value, path) => {
    const result = accountOverridesSchema.safeParse(value)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual([path])
  })

  it('rejects out-of-range days', () => {
    expect(accountOverridesSchema.safeParse({ billCycle: 'monthly', billCycleDay: '32' }).success).toBe(false)
    expect(accountOverridesSchema.safeParse({ billCycle: 'monthly', billCycleDay: '0' }).success).toBe(false)
  })
})
