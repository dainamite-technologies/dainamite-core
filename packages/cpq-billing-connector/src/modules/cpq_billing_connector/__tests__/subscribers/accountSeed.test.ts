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

  it('falls back to the default language for unsupported or missing codes', () => {
    expect(buildAccountSeed(payload({ invoiceLanguage: 'de' })).invoiceLanguage).toBe('en')
    expect(buildAccountSeed(payload()).invoiceLanguage).toBe('en')
  })
})
