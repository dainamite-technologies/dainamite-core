import { buildAccountSeed, type ActivatedPayload } from '../../subscribers/cpq-subscription-activated'

function payload(overrides: Partial<ActivatedPayload> = {}): ActivatedPayload {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    subscriptionId: 'sub-1',
    customerId: 'cust-1',
    currencyCode: 'PLN',
    items: [],
    ...overrides,
  }
}

describe('buildAccountSeed', () => {
  it('omits customerKind when upstream does not know it (billing defaults to company)', () => {
    expect('customerKind' in buildAccountSeed(payload())).toBe(false)
  })

  it('passes customerKind through for B2C (person) customers', () => {
    expect(buildAccountSeed(payload({ customerKind: 'person' })).customerKind).toBe('person')
  })

  it('keeps a supported invoice language, normalised', () => {
    expect(buildAccountSeed(payload({ invoiceLanguage: ' PL ' })).invoiceLanguage).toBe('pl')
  })

  it.each(['en', 'es', 'de', 'pl'])('passes every billing invoice language through (%s)', (code) => {
    expect(buildAccountSeed(payload({ invoiceLanguage: code.toUpperCase() })).invoiceLanguage).toBe(code)
  })

  it('falls back to the default language for unsupported or missing codes', () => {
    expect(buildAccountSeed(payload({ invoiceLanguage: 'fr' })).invoiceLanguage).toBe('en')
    expect(buildAccountSeed(payload()).invoiceLanguage).toBe('en')
  })

  it('omits nextBillDate unless upstream gave one (billing derives it from the cycle)', () => {
    expect('nextBillDate' in buildAccountSeed(payload({ activationDate: '2026-11-14' }))).toBe(false)
    expect(
      buildAccountSeed(payload({ activationDate: '2026-11-14', nextBillDate: '2026-12-01' }))
        .nextBillDate?.toISOString()
        .slice(0, 10),
    ).toBe('2026-12-01')
  })

  it('sends the bill cycle as unit + interval + day (default every 1 month on day 1)', () => {
    expect(buildAccountSeed(payload())).toMatchObject({ billCycle: 'monthly', billCycleInterval: 1, billCycleDay: '1' })
    expect('billCycleAnchor' in buildAccountSeed(payload())).toBe(false)
    expect(
      buildAccountSeed(payload(), { overrides: { billCycle: 'weekly', billCycleInterval: 2, billCycleDay: 'fri' } }),
    ).toMatchObject({ billCycle: 'weekly', billCycleInterval: 2, billCycleDay: 'fri' })
  })
})
