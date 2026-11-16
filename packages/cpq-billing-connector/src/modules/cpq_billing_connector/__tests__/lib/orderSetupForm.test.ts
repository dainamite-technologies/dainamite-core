import {
  buildUpsertBody,
  changeCycleUnit,
  initialFormState,
  isCycleValid,
  isSavedAccountUnavailable,
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
    earliestActivationDate: null,
    earliestActivationReason: null,
    defaults: {
      account: {
        name: 'Test S.A.S.',
        customerKind: 'company',
        invoiceEmail: 'ap@test.co',
        invoiceLanguage: 'en',
        invoiceAddress: { line1: 'Calle 93', city: 'Bogotá', postal_code: '110221', country: 'CO' },
        billCycle: 'monthly',
        billCycleInterval: 1,
        billCycleDay: '1',
      },
      lines: [{ lineId: LINE, name: 'Fiber 1G', parentLineId: null, serviceStartDate: null }],
    },
    ...overrides,
  }
}

const option = (id: string): AccountOption => ({
  id,
  name: id,
  currencyCode: 'COP',
  billCycle: 'monthly',
  billCycleInterval: 1,
  billCycleDay: '1',
  nextBillDate: null,
})

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
            {
              id: 'a',
              name: 'A',
              currency_code: 'COP',
              is_active: true,
              bill_cycle: 'monthly',
              bill_cycle_interval: 3,
              bill_cycle_day: '15',
              next_bill_date: '2026-12-01T00:00:00Z',
            },
            { id: 'b', name: 'B', currency_code: 'USD', is_active: true },
            { id: 'c', name: 'C', currency_code: 'COP', is_active: false },
          ],
        },
        { currencyCode: 'cop' },
      ),
    ).toEqual([
      {
        id: 'a',
        name: 'A',
        currencyCode: 'COP',
        billCycle: 'monthly',
        billCycleInterval: 3,
        billCycleDay: '15',
        nextBillDate: '2026-12-01',
      },
    ])
  })
})

describe('saved account no longer offered (review follow-up #3)', () => {
  const saved = (accountId: string, overrides: Record<string, unknown> = {}) =>
    view({
      setup: {
        id: 's',
        orderId: 'o',
        customerId: 'c',
        currencyCode: 'COP',
        accountMode: 'existing',
        billingAccountId: accountId,
        accountOverrides: {},
        defaultBillStartDate: '2026-12-01',
        lineBillStarts: { [LINE]: '2026-12-15' },
        appliedAt: null,
        appliedBillingAccountId: null,
        createdAt: '',
        updatedAt: '',
        ...overrides,
      },
    })

  it('is detected only when the user can list accounts and the setup is not applied', () => {
    expect(isSavedAccountUnavailable(saved('gone'), [option('a')], true)).toBe(true)
    expect(isSavedAccountUnavailable(saved('a'), [option('a')], true)).toBe(false)
    expect(isSavedAccountUnavailable(saved('gone'), [], false)).toBe(false)
    expect(isSavedAccountUnavailable(saved('gone', { appliedAt: '2026-11-15T00:00:00Z' }), [], true)).toBe(false)
    expect(isSavedAccountUnavailable(saved('gone', { accountMode: 'new', billingAccountId: null }), [], true)).toBe(false)
  })

  it('re-derives the account choice but keeps the saved bill starts', () => {
    const none = initialFormState(saved('gone'), [], { savedAccountUnavailable: true })
    expect(none).toMatchObject({ accountMode: 'new', billingAccountId: null, defaultBillStartDate: '2026-12-01' })
    expect(none.lineBillStarts).toEqual({ [LINE]: '2026-12-15' })

    expect(initialFormState(saved('gone'), [option('a')], { savedAccountUnavailable: true })).toMatchObject({
      accountMode: 'existing',
      billingAccountId: 'a',
    })
    expect(
      validateForm(initialFormState(saved('gone'), [option('a'), option('b')], { savedAccountUnavailable: true })),
    ).toEqual(['accountRequired'])
  })
})

describe('bill cycle fields', () => {
  it('defaults a new account to every 1 month on day 1 with no first bill date', () => {
    const state = initialFormState(view(), [])
    expect(state.account).toMatchObject({ billCycle: 'monthly', billCycleInterval: '1', billCycleDay: '1', nextBillDate: '' })
    expect(validateForm(state)).toEqual([])
  })

  it('sends no cycle override and no first bill date while the defaults are kept', () => {
    const v = view()
    const body = buildUpsertBody(initialFormState(v, []), v)
    expect(body).toMatchObject({ accountMode: 'new', accountOverrides: {} })
    expect((body as { accountOverrides: Record<string, unknown> }).accountOverrides).not.toHaveProperty('nextBillDate')
  })

  it('sends unit, N and day together once any of them changes, and passes the API schema', () => {
    const v = view()
    const state = initialFormState(v, [])
    state.account.billCycleInterval = '3'
    const body = buildUpsertBody(state, v)
    expect(body).toMatchObject({
      accountOverrides: { billCycle: 'monthly', billCycleInterval: 3, billCycleDay: '1' },
    })
    expect(orderSetupUpsertSchema.safeParse(body).success).toBe(true)
  })

  it('sends a first bill date only when the operator sets one', () => {
    const v = view()
    const state = initialFormState(v, [])
    state.account.nextBillDate = '2026-12-15'
    expect(buildUpsertBody(state, v)).toMatchObject({ accountOverrides: { nextBillDate: '2026-12-15' } })
  })

  it('switching the unit resets the day to its shape and caps N', () => {
    const fields = initialFormState(view(), []).account
    fields.billCycleInterval = '24'
    expect(changeCycleUnit(fields, 'weekly')).toMatchObject({ billCycle: 'weekly', billCycleDay: 'mon', billCycleInterval: '24' })
    expect(changeCycleUnit(fields, 'annually')).toMatchObject({ billCycle: 'annually', billCycleDay: '1', billCycleInterval: '5' })
    expect(changeCycleUnit(fields, 'daily')).toMatchObject({ billCycle: 'daily', billCycleDay: '' })
  })

  it('a daily cycle is sent with a null day', () => {
    const v = view()
    const state = initialFormState(v, [])
    state.account = changeCycleUnit(state.account, 'daily')
    state.account.billCycleInterval = '30'
    const body = buildUpsertBody(state, v)
    expect(body).toMatchObject({ accountOverrides: { billCycle: 'daily', billCycleInterval: 30, billCycleDay: null } })
    expect(orderSetupUpsertSchema.safeParse(body).success).toBe(true)
  })

  it('restores saved cycle overrides', () => {
    const state = initialFormState(
      view({
        setup: {
          id: 's',
          orderId: 'o',
          customerId: 'c',
          currencyCode: 'COP',
          accountMode: 'new',
          billingAccountId: null,
          accountOverrides: { billCycle: 'weekly', billCycleInterval: 2, billCycleDay: 'fri' },
          defaultBillStartDate: null,
          lineBillStarts: {},
          appliedAt: null,
          appliedBillingAccountId: null,
          createdAt: '',
          updatedAt: '',
        },
      }),
      [],
    )
    expect(state.account).toMatchObject({ billCycle: 'weekly', billCycleInterval: '2', billCycleDay: 'fri' })
  })

  it.each([
    [{ billCycle: 'monthly', billCycleInterval: '0', billCycleDay: '1' }],
    [{ billCycle: 'monthly', billCycleInterval: '25', billCycleDay: '1' }],
    [{ billCycle: 'monthly', billCycleInterval: '1.5', billCycleDay: '1' }],
    [{ billCycle: 'monthly', billCycleInterval: '', billCycleDay: '1' }],
    [{ billCycle: 'weekly', billCycleInterval: '1', billCycleDay: '15' }],
    [{ billCycle: 'monthly', billCycleInterval: '1', billCycleDay: '' }],
    [{ billCycle: 'quarterly', billCycleInterval: '1', billCycleDay: '1' }],
  ])('flags an invalid cycle %j', (cycle) => {
    expect(isCycleValid(cycle)).toBe(false)
    const state = initialFormState(view(), [])
    state.account = { ...state.account, ...cycle }
    expect(validateForm(state)).toEqual(['cycleInvalid'])
  })
})
