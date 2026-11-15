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
        accountOverrides: { name: 'X', invoiceLanguage: 'ES', billCycle: 'quarterly' },
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
