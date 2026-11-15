import {
  CUSTOMER_LOOKUP_CHUNK,
  applyCustomerPrefill,
  customerDetailHref,
  customerEndpoint,
  extractItems,
  mapPrimaryAddress,
  planCustomerLookups,
  toCustomerSummary,
  type PrefillTarget,
} from '../../lib/customerLookup'

const blankForm: PrefillTarget = {
  name: '',
  invoiceEmail: '',
  invoiceAddress: { line1: '', line2: '', city: '', postal_code: '', country: 'PL' },
}

describe('customerEndpoint / customerDetailHref', () => {
  it('routes companies and people to their own collections', () => {
    expect(customerEndpoint('company')).toBe('/api/customers/companies')
    expect(customerEndpoint('person')).toBe('/api/customers/people')
    expect(customerDetailHref('person', 'p-1')).toBe('/backend/customers/people/p-1')
    expect(customerDetailHref('company', 'c 1')).toBe('/backend/customers/companies/c%201')
  })
})

describe('extractItems / toCustomerSummary', () => {
  it('reads `{ items }` and bare arrays, ignoring junk', () => {
    expect(extractItems({ items: [{ id: 'a' }, null, 3] })).toEqual([{ id: 'a' }])
    expect(extractItems([{ id: 'b' }])).toEqual([{ id: 'b' }])
    expect(extractItems(null)).toEqual([])
  })

  it('maps snake_case and camelCase rows', () => {
    expect(toCustomerSummary({ id: 'c1', display_name: 'Acme', primary_email: 'ar@acme.test' })).toEqual({
      id: 'c1',
      name: 'Acme',
      email: 'ar@acme.test',
    })
    expect(toCustomerSummary({ id: 'p1', displayName: 'Jan Kowalski' })).toEqual({
      id: 'p1',
      name: 'Jan Kowalski',
      email: null,
    })
  })

  it('falls back to the id as name and rejects rows without id', () => {
    expect(toCustomerSummary({ id: 'x' })?.name).toBe('x')
    expect(toCustomerSummary({ display_name: 'No id' })).toBeNull()
  })
})

describe('mapPrimaryAddress', () => {
  const secondary = {
    is_primary: false,
    address_line1: 'Boczna',
    building_number: '2',
    city: 'Kraków',
    postal_code: '30-001',
    country: 'pl',
  }
  const primary = {
    is_primary: true,
    address_line1: 'Marszałkowska',
    building_number: '10',
    flat_number: '5',
    address_line2: 'II piętro',
    city: 'Warszawa',
    postal_code: '00-001',
    country: 'pl',
  }

  it('prefers the primary address and composes building/flat into line 1', () => {
    expect(mapPrimaryAddress([secondary, primary])).toEqual({
      line1: 'Marszałkowska 10/5',
      line2: 'II piętro',
      city: 'Warszawa',
      postal_code: '00-001',
      country: 'PL',
    })
  })

  it('falls back to the first complete address when the primary is incomplete', () => {
    expect(mapPrimaryAddress([{ ...primary, city: '' }, secondary])?.line1).toBe('Boczna 2')
  })

  it('ignores a flat number without a building number', () => {
    expect(mapPrimaryAddress([{ ...secondary, building_number: '', flat_number: '7' }])?.line1).toBe('Boczna')
  })

  it('returns null when nothing is usable', () => {
    expect(mapPrimaryAddress([])).toBeNull()
    expect(mapPrimaryAddress([{ address_line1: 'X', city: 'Y', postal_code: 'Z', country: '' }])).toBeNull()
  })
})

describe('applyCustomerPrefill', () => {
  const customer = { id: 'p1', name: 'Jan Kowalski', email: 'jan@example.test' }
  const address = { line1: 'Marszałkowska 10', line2: '', city: 'Warszawa', postal_code: '00-001', country: 'PL' }

  it('fills name, email and address into a blank form', () => {
    expect(applyCustomerPrefill(blankForm, customer, address)).toEqual({
      name: 'Jan Kowalski',
      invoiceEmail: 'jan@example.test',
      invoiceAddress: address,
    })
  })

  it('never overwrites what the operator typed', () => {
    const typed: PrefillTarget = {
      name: 'Jan — home',
      invoiceEmail: 'billing@jan.test',
      invoiceAddress: { ...blankForm.invoiceAddress, city: 'Gdańsk' },
    }
    expect(applyCustomerPrefill(typed, customer, address)).toEqual(typed)
  })

  it('treats the default country alone as an empty address', () => {
    expect(applyCustomerPrefill(blankForm, null, address).invoiceAddress).toEqual(address)
  })

  it('is a no-op without data', () => {
    expect(applyCustomerPrefill(blankForm, null, null)).toBe(blankForm)
  })

  it('preserves extra fields on the target', () => {
    const form = { ...blankForm, currencyCode: 'PLN' }
    expect(applyCustomerPrefill(form, customer, null).currencyCode).toBe('PLN')
  })
})

describe('planCustomerLookups', () => {
  it('groups by kind, de-duplicates and skips empty ids', () => {
    const plan = planCustomerLookups([
      { customerId: 'c1', customerKind: 'company' },
      { customerId: 'p1', customerKind: 'person' },
      { customerId: 'c1', customerKind: 'company' },
      { customerId: '', customerKind: 'person' },
      { customerId: 'c2', customerKind: null },
    ])
    expect(plan).toEqual([
      { kind: 'company', ids: ['c1', 'c2'] },
      { kind: 'person', ids: ['p1'] },
    ])
  })

  it('chunks to the API page-size cap', () => {
    const rows = Array.from({ length: CUSTOMER_LOOKUP_CHUNK + 5 }, (_, i) => ({
      customerId: `c${i}`,
      customerKind: 'company' as const,
    }))
    const plan = planCustomerLookups(rows)
    expect(plan.map((p) => p.ids.length)).toEqual([CUSTOMER_LOOKUP_CHUNK, 5])
  })
})
