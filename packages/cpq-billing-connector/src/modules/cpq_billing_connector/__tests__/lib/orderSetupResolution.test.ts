import {
  buildAccountSeedValues,
  earliestIsoDate,
  isUsableAccount,
  normalizeInvoiceAddress,
  pickDefaultAccount,
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
    const seed = buildAccountSeedValues({ defaults, currencyCode: 'COP', activationDate: '2026-11-15' })
    expect(seed).toMatchObject({
      name: 'Test S.A.S.',
      invoiceEmail: 'ap@test.co',
      customerKind: 'company',
      invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postal_code: '110221', country: 'CO' },
      nextBillDate: '2026-11-15',
      billCycle: 'monthly',
      billCycleAnchor: '1',
    })
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

  it('starts billing at the earliest bill start when it is later than activation', () => {
    expect(
      buildAccountSeedValues({ defaults, currencyCode: 'COP', earliestBillStart: '2026-12-01', activationDate: '2026-11-15' })
        .nextBillDate,
    ).toBe('2026-12-01')
    expect(
      buildAccountSeedValues({
        defaults,
        currencyCode: 'COP',
        overrides: { nextBillDate: '2027-01-01' },
        earliestBillStart: '2026-12-01',
      }).nextBillDate,
    ).toBe('2027-01-01')
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
