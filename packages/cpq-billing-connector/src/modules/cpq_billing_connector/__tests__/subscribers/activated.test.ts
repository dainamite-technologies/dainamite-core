import {
  itemBillStart,
  resolveBillingAccount,
  type ActivatedPayload,
  type AppliedSetup,
} from '../../subscribers/cpq-subscription-activated'
import { mapSubscriptionItemsToBillingItems } from '../../lib/chargeMapper'

type FakeAccount = {
  id: string
  customerId: string
  currencyCode: string
  isActive: boolean
  deletedAt: Date | null
  createdAt: Date
}

const scope = { tenantId: 't-1', organizationId: 'o-1' }

const payload: ActivatedPayload = {
  tenantId: 't-1',
  organizationId: 'o-1',
  subscriptionId: 'sub-1',
  customerId: 'cust-1',
  currencyCode: 'COP',
  sourceOrderId: 'order-1',
  customerName: 'Test S.A.S.',
  activationDate: '2026-11-15',
  items: [],
}

function acc(id: string, overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    id,
    customerId: 'cust-1',
    currencyCode: 'COP',
    isActive: true,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function fakeBilling(accounts: FakeAccount[]) {
  const created: Array<Record<string, unknown>> = []
  const billing = {
    findAccountById: jest.fn(async (_scope: unknown, id: string) => accounts.find((a) => a.id === id && !a.deletedAt) ?? null),
    findCandidateAccounts: jest.fn(async (_scope: unknown, customerId: string, currencyCode: string) =>
      accounts
        .filter((a) => a.customerId === customerId && a.currencyCode === currencyCode && a.isActive && !a.deletedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
    createAccount: jest.fn(async (_scope: unknown, seed: Record<string, unknown>) => {
      created.push(seed)
      return { id: 'acc-created' }
    }),
  }
  return { billing: billing as never, created, mock: billing }
}

describe('resolveBillingAccount', () => {
  it('reuses the account a previous run applied (idempotent re-fire)', async () => {
    const { billing, created } = fakeBilling([acc('acc-applied')])
    const setup: AppliedSetup = { accountMode: 'new', appliedBillingAccountId: 'acc-applied' }
    await expect(resolveBillingAccount({ billing, scope, payload, setup, earliestBillStart: null })).resolves.toEqual({
      id: 'acc-applied',
      accountMode: 'new',
    })
    expect(created).toHaveLength(0)
  })

  it('uses the operator’s existing account while it is usable', async () => {
    const { billing } = fakeBilling([acc('acc-chosen'), acc('acc-newer', { createdAt: new Date('2027-01-01') })])
    const setup: AppliedSetup = { accountMode: 'existing', billingAccountId: 'acc-chosen' }
    await expect(resolveBillingAccount({ billing, scope, payload, setup, earliestBillStart: null })).resolves.toEqual({
      id: 'acc-chosen',
      accountMode: 'existing',
    })
  })

  it('falls back to defaults when the chosen account was deactivated (R1)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { billing } = fakeBilling([acc('acc-chosen', { isActive: false }), acc('acc-other')])
    const setup: AppliedSetup = { accountMode: 'existing', billingAccountId: 'acc-chosen' }
    await expect(resolveBillingAccount({ billing, scope, payload, setup, earliestBillStart: null })).resolves.toEqual({
      id: 'acc-other',
      accountMode: 'existing',
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('creates a new account with the operator’s overrides', async () => {
    const { billing, created } = fakeBilling([acc('acc-existing')])
    const setup: AppliedSetup = { accountMode: 'new', accountOverrides: { name: 'Sede Norte' } }
    await expect(
      resolveBillingAccount({ billing, scope, payload, setup, earliestBillStart: '2026-12-01' }),
    ).resolves.toEqual({ id: 'acc-created', accountMode: 'new' })
    expect(created[0]).toMatchObject({ name: 'Sede Norte', currencyCode: 'COP' })
    expect((created[0].nextBillDate as Date).toISOString().slice(0, 10)).toBe('2026-12-01')
  })

  it('without a setup, reuses the newest same-currency account', async () => {
    const { billing, created } = fakeBilling([
      acc('acc-old'),
      acc('acc-new', { createdAt: new Date('2026-06-01') }),
      acc('acc-usd', { currencyCode: 'USD', createdAt: new Date('2027-01-01') }),
    ])
    await expect(resolveBillingAccount({ billing, scope, payload, setup: null, earliestBillStart: null })).resolves.toEqual({
      id: 'acc-new',
      accountMode: 'existing',
    })
    expect(created).toHaveLength(0)
  })

  it('without a setup, never reuses an account in another currency — it creates one from the customer data', async () => {
    const { billing, created } = fakeBilling([acc('acc-usd', { currencyCode: 'USD' })])
    await expect(resolveBillingAccount({ billing, scope, payload, setup: null, earliestBillStart: null })).resolves.toEqual({
      id: 'acc-created',
      accountMode: 'new',
    })
    expect(created[0]).toMatchObject({ name: 'Test S.A.S.', currencyCode: 'COP' })
  })

  it('fails loudly when billing returns no id (the queue retries)', async () => {
    const { billing, mock } = fakeBilling([])
    mock.createAccount.mockResolvedValueOnce({ id: '' })
    await expect(
      resolveBillingAccount({ billing, scope, payload, setup: null, earliestBillStart: null }),
    ).rejects.toThrow('returned no id')
  })
})

describe('per-item bill start', () => {
  const items = [
    {
      subscriptionItemId: 'si-1',
      orderLineId: 'line-1',
      productName: 'Fiber',
      quantity: 1,
      charges: [
        { type: 'recurring' as const, unitPrice: 100, description: 'Recurring charge' },
        { type: 'one_time' as const, amount: 50, description: 'One-time charge' },
      ],
    },
    {
      subscriptionItemId: 'si-2',
      orderLineId: 'line-2',
      startDate: '2026-11-20',
      productName: 'Static IP',
      quantity: 1,
      charges: [{ type: 'recurring' as const, unitPrice: 10, description: 'Recurring charge' }],
    },
  ]

  it('applies each line’s bill start to every charge of that line', () => {
    const setup: AppliedSetup = {
      accountMode: 'new',
      defaultBillStartDate: '2026-12-01',
      lineBillStarts: { 'line-1': '2026-12-15' },
    }
    const mapped = mapSubscriptionItemsToBillingItems({
      subscriptionId: 'sub-1',
      items,
      billStartDate: '2026-11-15',
      billStartDateFor: (item) => itemBillStart(item, setup, '2026-11-15'),
    })
    expect(mapped.map((m) => [m.subscriptionItemId, m.type, m.billStartDate])).toEqual([
      ['si-1', 'recurring', '2026-12-15'],
      ['si-1', 'one_time', '2026-12-15'],
      ['si-2', 'recurring', '2026-11-20'],
    ])
  })

  it('bills from the activation date without a setup or service start', () => {
    expect(itemBillStart(items[0], null, '2026-11-15')).toBe('2026-11-15')
  })
})
