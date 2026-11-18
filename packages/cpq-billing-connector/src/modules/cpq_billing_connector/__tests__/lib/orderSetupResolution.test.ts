import {
  buildAccountSeedValues,
  earliestIsoDate,
  isUsableAccount,
  normalizeInvoiceAddress,
  pickDefaultAccount,
  resolveCycleSpec,
  resolveLineBillStart,
  toIsoDate,
  type AccountCandidate,
} from '../../lib/orderSetupResolution'

const target = { customerId: 'cust-1', currencyCode: 'COP' }

function account(overrides: Partial<AccountCandidate> = {}): AccountCandidate {
  return {
    id: 'acc-1',
    customerId: 'cust-1',
    currencyCode: 'COP',
    isActive: true,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('resolveLineBillStart (D3)', () => {
  const setup = { defaultBillStartDate: '2026-12-01', lineBillStarts: { 'line-1': '2026-12-15' } }

  it('uses the line override first', () => {
    expect(
      resolveLineBillStart({ orderLineId: 'line-1', serviceStartDate: '2026-11-20', setup, activationDate: '2026-11-15' }),
    ).toBe('2026-12-15')
  })

  it('then the CPQ service start', () => {
    expect(
      resolveLineBillStart({ orderLineId: 'line-2', serviceStartDate: '2026-11-20', setup, activationDate: '2026-11-15' }),
    ).toBe('2026-11-20')
  })

  it('then the order default bill start', () => {
    expect(resolveLineBillStart({ orderLineId: 'line-2', setup, activationDate: '2026-11-15' })).toBe('2026-12-01')
  })

  it('then the activation date (no setup at all)', () => {
    expect(resolveLineBillStart({ orderLineId: 'line-2', setup: null, activationDate: '2026-11-15' })).toBe('2026-11-15')
  })

  it('ignores an override when the item has no order line id', () => {
    expect(resolveLineBillStart({ setup, activationDate: '2026-11-15' })).toBe('2026-12-01')
  })
})

describe('buildAccountSeedValues (D5)', () => {
  const defaults = {
    customerId: 'cust-1',
    customerKind: 'company' as const,
    customerName: 'Test S.A.S.',
    invoiceEmail: 'ap@test.co',
    invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postalCode: '110221', country: 'co', region: 'DC' },
  }

  it('takes customer data instead of placeholders', () => {
    const seed = buildAccountSeedValues({ defaults, currencyCode: 'COP' })
    expect(seed).toMatchObject({
      name: 'Test S.A.S.',
      invoiceEmail: 'ap@test.co',
      customerKind: 'company',
      invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postal_code: '110221', country: 'CO' },
      billCycle: 'monthly',
      billCycleInterval: 1,
      billCycleDay: '1',
    })
    expect(seed).not.toHaveProperty('nextBillDate')
    expect(seed.invoiceAddress).not.toHaveProperty('region')
  })

  it('lets operator overrides win field by field', () => {
    const seed = buildAccountSeedValues({
      defaults,
      currencyCode: 'COP',
      overrides: { name: 'Test — Sede Norte', invoiceLanguage: 'es', taxId: '900123' },
    })
    expect(seed).toMatchObject({ name: 'Test — Sede Norte', invoiceEmail: 'ap@test.co', invoiceLanguage: 'es', taxId: '900123' })
  })

  it('falls back to placeholders only when the customer has nothing', () => {
    const seed = buildAccountSeedValues({ defaults: { customerId: 'cust-9' }, currencyCode: 'COP' })
    expect(seed.name).toBe('Customer cust-9')
    expect(seed.invoiceEmail).toBe('billing+cust-9@invalid.local')
    expect(seed.invoiceAddress).toEqual({ line1: 'TBD', city: 'TBD', postal_code: 'TBD', country: 'XX' })
  })

  it('sends a first bill date only when the operator or upstream gave one', () => {
    expect(buildAccountSeedValues({ defaults, currencyCode: 'COP' })).not.toHaveProperty('nextBillDate')
    expect(
      buildAccountSeedValues({ defaults: { ...defaults, nextBillDate: '2026-12-01T00:00:00Z' }, currencyCode: 'COP' })
        .nextBillDate,
    ).toBe('2026-12-01')
    expect(
      buildAccountSeedValues({
        defaults: { ...defaults, nextBillDate: '2026-12-01' },
        currencyCode: 'COP',
        overrides: { nextBillDate: '2027-01-01' },
      }).nextBillDate,
    ).toBe('2027-01-01')
  })

  it('takes the operator cycle over upstream, and pins the default day to an explicit first bill date', () => {
    expect(
      buildAccountSeedValues({
        defaults: { ...defaults, billCycle: 'weekly', billCycleDay: 'tue' },
        currencyCode: 'COP',
        overrides: { billCycle: 'monthly', billCycleInterval: 3, billCycleDay: '15' },
      }),
    ).toMatchObject({ billCycle: 'monthly', billCycleInterval: 3, billCycleDay: '15' })
    expect(
      buildAccountSeedValues({ defaults, currencyCode: 'COP', overrides: { nextBillDate: '2026-12-20' } }),
    ).toMatchObject({ billCycle: 'monthly', billCycleInterval: 1, billCycleDay: '20', nextBillDate: '2026-12-20' })
  })
})

describe('normalizeInvoiceAddress', () => {
  it('fills each missing required field with its own placeholder', () => {
    expect(normalizeInvoiceAddress({ city: 'Madrid' })).toEqual({
      line1: 'TBD',
      city: 'Madrid',
      postal_code: 'TBD',
      country: 'XX',
    })
  })

  it('accepts billing-shaped addresses as-is', () => {
    expect(
      normalizeInvoiceAddress({ line1: 'a', line2: 'b', city: 'c', postal_code: 'd', country: 'PL' }),
    ).toEqual({ line1: 'a', line2: 'b', city: 'c', postal_code: 'd', country: 'PL' })
  })

  it('rejects an invalid country code', () => {
    expect(normalizeInvoiceAddress({ country: 'Colombia' }).country).toBe('XX')
  })
})

describe('account candidates (D4)', () => {
  it('accepts only active, non-deleted accounts of the same customer and currency', () => {
    expect(isUsableAccount(account(), target)).toBe(true)
    expect(isUsableAccount(account({ currencyCode: 'cop' }), target)).toBe(true)
    expect(isUsableAccount(account({ currencyCode: 'USD' }), target)).toBe(false)
    expect(isUsableAccount(account({ isActive: false }), target)).toBe(false)
    expect(isUsableAccount(account({ deletedAt: '2026-02-01' }), target)).toBe(false)
    expect(isUsableAccount(account({ customerId: 'cust-2' }), target)).toBe(false)
    expect(isUsableAccount(null, target)).toBe(false)
  })

  it('picks the newest usable account and never one in another currency', () => {
    const picked = pickDefaultAccount(
      [
        account({ id: 'old', createdAt: '2025-01-01T00:00:00Z' }),
        account({ id: 'usd-newest', currencyCode: 'USD', createdAt: '2027-01-01T00:00:00Z' }),
        account({ id: 'new', createdAt: '2026-06-01T00:00:00Z' }),
      ],
      target,
    )
    expect(picked?.id).toBe('new')
    expect(pickDefaultAccount([account({ currencyCode: 'USD' })], target)).toBeNull()
  })
})

describe('date helpers', () => {
  it('normalizes dates and finds the earliest', () => {
    expect(toIsoDate(new Date('2026-11-15T10:00:00Z'))).toBe('2026-11-15')
    expect(toIsoDate('2026-11-15T10:00:00Z')).toBe('2026-11-15')
    expect(toIsoDate('soon')).toBeNull()
    expect(earliestIsoDate(['2026-12-01', null, '2026-11-20'])).toBe('2026-11-20')
    expect(earliestIsoDate([])).toBeNull()
  })
})

describe('resolveCycleSpec', () => {
  it('defaults to every 1 month on day 1', () => {
    expect(resolveCycleSpec({})).toEqual({ cycle: 'monthly', interval: 1, day: '1' })
  })

  it('defaults the day per unit and to the weekday / day of the first bill date', () => {
    expect(resolveCycleSpec({ overrides: { billCycle: 'weekly' } })).toEqual({ cycle: 'weekly', interval: 1, day: 'mon' })
    expect(resolveCycleSpec({ overrides: { billCycle: 'daily', billCycleInterval: 30 } })).toEqual({
      cycle: 'daily',
      interval: 30,
      day: null,
    })
    // 2026-12-04 is a Friday.
    expect(resolveCycleSpec({ overrides: { billCycle: 'weekly' }, nextBillDate: '2026-12-04' }).day).toBe('fri')
    expect(resolveCycleSpec({ nextBillDate: '2026-12-31' }).day).toBe('31')
  })

  it('lets the source of the unit own the day (no weekly unit with a day of month)', () => {
    expect(
      resolveCycleSpec({ overrides: { billCycle: 'weekly' }, defaults: { billCycle: 'monthly', billCycleDay: '15' } }),
    ).toEqual({ cycle: 'weekly', interval: 1, day: 'mon' })
    // An override of N / day alone applies on top of the upstream unit.
    expect(
      resolveCycleSpec({ overrides: { billCycleInterval: 2 }, defaults: { billCycle: 'weekly', billCycleDay: 'thu' } }),
    ).toEqual({ cycle: 'weekly', interval: 2, day: 'thu' })
  })

  it('normalizes upstream day values', () => {
    expect(resolveCycleSpec({ defaults: { billCycle: 'monthly', billCycleDay: 5 } }).day).toBe('5')
    expect(resolveCycleSpec({ defaults: { billCycle: 'weekly', billCycleDay: ' WED ' } }).day).toBe('wed')
  })

  it('repairs invalid upstream data instead of failing onboarding', () => {
    expect(resolveCycleSpec({ defaults: { billCycle: 'quarterly' } })).toEqual({ cycle: 'monthly', interval: 3, day: '1' })
    expect(resolveCycleSpec({ defaults: { billCycle: 'fortnightly' } })).toEqual({ cycle: 'monthly', interval: 1, day: '1' })
    expect(resolveCycleSpec({ defaults: { billCycle: 'weekly', billCycleDay: '15' } })).toEqual({
      cycle: 'weekly',
      interval: 1,
      day: 'mon',
    })
    expect(resolveCycleSpec({ defaults: { billCycle: 'annually', billCycleInterval: 10 } })).toEqual({
      cycle: 'annually',
      interval: 1,
      day: '1',
    })
  })
})
