import {
  buildUpsertBody,
  initialFormState,
  toAccountOptions,
  validateForm,
  type AccountOption,
} from '../../lib/orderSetupForm'
import type { OrderSetupView } from '../../services/orderSetupService'
import { orderSetupUpsertSchema } from '../../data/validators'

const LINE = '11111111-1111-4111-8111-111111111111'

function view(overrides: Partial<OrderSetupView> = {}): OrderSetupView {
  return {
    orderId: '22222222-2222-4222-8222-222222222222',
    orderStatus: 'draft',
    quoteType: 'new',
    editable: true,
    setup: null,
    defaults: {
      account: {
        name: 'Test S.A.S.',
        customerKind: 'company',
        invoiceEmail: 'ap@test.co',
        invoiceLanguage: 'en',
        invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postal_code: '110221', country: 'CO' },
        billCycle: 'monthly',
        billCycleAnchor: '1',
      },
      lines: [{ lineId: LINE, name: 'Fiber 1G', parentLineId: null, serviceStartDate: null }],
    },
    ...overrides,
  }
}

const option = (id: string): AccountOption => ({ id, name: id, currencyCode: 'COP', billCycle: 'monthly', nextBillDate: null })

describe('initialFormState (D4)', () => {
  it('preselects the only candidate', () => {
    expect(initialFormState(view(), [option('acc-1')])).toMatchObject({ accountMode: 'existing', billingAccountId: 'acc-1' })
  })

  it('defaults to a new account when there is no candidate', () => {
    expect(initialFormState(view(), [])).toMatchObject({ accountMode: 'new', billingAccountId: null })
  })

  it('makes the operator pick when there are several candidates', () => {
    expect(initialFormState(view(), [option('a'), option('b')])).toMatchObject({
      accountMode: 'existing',
      billingAccountId: null,
    })
  })

  it('restores a saved setup with its overrides over the customer values', () => {
    const state = initialFormState(
      view({
        setup: {
          id: 's',
          orderId: 'o',
          customerId: 'c',
          currencyCode: 'COP',
          accountMode: 'new',
          billingAccountId: null,
          accountOverrides: { name: 'Sede Norte' },
          defaultBillStartDate: '2026-12-01',
          lineBillStarts: { [LINE]: '2026-12-15' },
          appliedAt: null,
          appliedBillingAccountId: null,
          createdAt: '',
          updatedAt: '',
        },
      }),
      [option('a')],
    )
    expect(state.accountMode).toBe('new')
    expect(state.account.name).toBe('Sede Norte')
    expect(state.account.invoiceEmail).toBe('ap@test.co')
    expect(state.defaultBillStartDate).toBe('2026-12-01')
    expect(state.lineBillStarts).toEqual({ [LINE]: '2026-12-15' })
  })
})

describe('buildUpsertBody', () => {
  it('sends only the fields that differ from the customer (D5) and passes the API schema', () => {
    const v = view()
    const state = initialFormState(v, [])
    state.account.name = 'Sede Norte'
    state.lineBillStarts[LINE] = '2026-12-15'
    const body = buildUpsertBody(state, v)
    expect(body).toEqual({
      accountMode: 'new',
      accountOverrides: { name: 'Sede Norte' },
      defaultBillStartDate: null,
      lineBillStarts: { [LINE]: '2026-12-15' },
    })
    expect(orderSetupUpsertSchema.safeParse(body).success).toBe(true)
  })

  it('sends the whole address once any part of it changes', () => {
    const v = view()
    const state = initialFormState(v, [])
    state.account.city = 'Medellín'
    expect(buildUpsertBody(state, v)).toMatchObject({
      accountOverrides: { invoiceAddress: { line1: 'Calle 93', city: 'Medellín', postal_code: '110221', country: 'CO' } },
    })
  })

  it('drops overrides for an existing account', () => {
    const v = view()
    const state = { ...initialFormState(v, [option('acc-1')]) }
    state.account.name = 'ignored'
    expect(buildUpsertBody(state, v)).toEqual({
      accountMode: 'existing',
      billingAccountId: 'acc-1',
      defaultBillStartDate: null,
      lineBillStarts: {},
    })
  })
})

describe('ARC orders (phase 2)', () => {
  it('send only the bill starts and skip account validation', () => {
    const v = view({ quoteType: 'amend' })
    const state = initialFormState(v, [])
    state.account.name = ''
    state.lineBillStarts[LINE] = '2026-12-15'
    expect(validateForm(state, 'amend')).toEqual([])
    expect(buildUpsertBody(state, v)).toEqual({ defaultBillStartDate: null, lineBillStarts: { [LINE]: '2026-12-15' } })
  })
})

describe('validateForm', () => {
  it('requires a selection for an existing account', () => {
    expect(validateForm(initialFormState(view(), [option('a'), option('b')]))).toEqual(['accountRequired'])
  })

  it('flags a bad email and a partial address for a new account', () => {
    const state = initialFormState(view(), [])
    state.account.invoiceEmail = 'not-an-email'
    state.account.postalCode = ''
    expect(validateForm(state)).toEqual(['emailInvalid', 'addressIncomplete'])
  })
})

describe('toAccountOptions', () => {
  it('maps list rows and keeps only active accounts in the order currency', () => {
    expect(
      toAccountOptions(
        {
          items: [
            { id: 'a', name: 'A', currency_code: 'COP', is_active: true, bill_cycle: 'monthly', next_bill_date: '2026-12-01T00:00:00Z' },
            { id: 'b', name: 'B', currency_code: 'USD', is_active: true },
            { id: 'c', name: 'C', currency_code: 'COP', is_active: false },
          ],
        },
        { currencyCode: 'cop' },
      ),
    ).toEqual([{ id: 'a', name: 'A', currencyCode: 'COP', billCycle: 'monthly', nextBillDate: '2026-12-01' }])
  })
})
