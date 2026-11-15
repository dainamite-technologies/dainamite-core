import { buildActivatedEventCustomerFields } from '../activatedEventCustomer'

describe('buildActivatedEventCustomerFields', () => {
  it('returns no fields when the sales order or its snapshots are missing', () => {
    expect(buildActivatedEventCustomerFields(null)).toEqual({})
    expect(buildActivatedEventCustomerFields({ customerSnapshot: null, billingAddressSnapshot: null })).toEqual({})
  })

  it('maps name, kind and email from the customer snapshot', () => {
    expect(
      buildActivatedEventCustomerFields({
        customerSnapshot: {
          customer: { kind: 'company', displayName: '  Test S.A.S. ', primaryEmail: 'ap@test.co' },
        },
      }),
    ).toEqual({ customerName: 'Test S.A.S.', customerKind: 'company', invoiceEmail: 'ap@test.co' })
  })

  it('omits blank values and unknown customer kinds instead of guessing', () => {
    expect(
      buildActivatedEventCustomerFields({
        customerSnapshot: { customer: { kind: 'robot', displayName: '   ', primaryEmail: null } },
      }),
    ).toEqual({})
  })

  it('maps the billing address snapshot, joining building and flat numbers', () => {
    expect(
      buildActivatedEventCustomerFields({
        billingAddressSnapshot: {
          addressLine1: 'Calle 93',
          addressLine2: 'Oficina 2',
          buildingNumber: '11',
          flatNumber: '4',
          city: 'Bogotá',
          postalCode: '110221',
          region: 'Cundinamarca',
          country: 'co',
        },
      }).invoiceAddress,
    ).toEqual({
      line1: 'Calle 93 11/4',
      line2: 'Oficina 2',
      city: 'Bogotá',
      postalCode: '110221',
      region: 'Cundinamarca',
      country: 'CO',
    })
  })

  it('keeps a partial address and drops an empty one', () => {
    expect(
      buildActivatedEventCustomerFields({ billingAddressSnapshot: { city: 'Madrid' } }).invoiceAddress,
    ).toEqual({ city: 'Madrid' })
    expect(buildActivatedEventCustomerFields({ billingAddressSnapshot: { addressLine1: '' } })).toEqual({})
  })
})
