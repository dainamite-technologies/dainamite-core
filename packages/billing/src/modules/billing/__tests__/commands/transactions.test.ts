import { adjustTransactionCommand } from '../../commands/transactions'
import { createPrepaidMockEm, type MockEm } from '../helpers/prepaidMockEm'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ACCT = '33333333-3333-4333-8333-333333333333'

function prepaidAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCT,
    tenantId: TENANT,
    organizationId: ORG,
    currencyCode: 'EUR',
    billingMode: 'prepaid',
    creditLimit: '0',
    ...overrides,
  }
}

type CtxAuth = { sub?: string; tenantId?: string; orgId?: string } | null

function makeCtx(em: MockEm, auth: CtxAuth = { sub: '99999999-9999-4999-8999-999999999999', tenantId: TENANT, orgId: ORG }) {
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    auth,
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        return null
      }),
    },
  }
}

describe('adjustTransactionCommand', () => {
  it('debits the balance and returns the new balance + status', async () => {
    const em = createPrepaidMockEm({
      account: prepaidAccount(),
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
    })
    const ctx = makeCtx(em)
    const result = await adjustTransactionCommand.execute(
      { tenantId: TENANT, organizationId: ORG, billAccountId: ACCT, amount: -30, description: 'Goodwill debit' } as never,
      ctx as never,
    )
    expect(result.balance).toBe('70.0000')
    expect(result.balanceStatus).toBe('ok')
    expect(result.transactionId).toBeTruthy()
    expect(em.transactions).toHaveLength(1)
    expect(em.transactions[0].type).toBe('adjustment')
    expect(em.transactions[0].amount).toBe('-30.0000')
    expect(em.transactions[0].userId).toBe('99999999-9999-4999-8999-999999999999')
  })

  // The CPQ↔billing connector runs as a system identity, not a user: it calls
  // the command bus with `auth: null` and carries tenant/organization in the
  // payload instead. Open Mercato 0.6.7 hardened ensureTenantScope from
  // fail-open to fail-closed, but kept `auth: null` a no-op — this test pins
  // that, because the connector has no other guarantee than prose. If a future
  // release closes this branch too, the connector breaks and this fails first.
  it('accepts a system-identity call (auth: null) without a scope error', async () => {
    const em = createPrepaidMockEm({
      account: prepaidAccount(),
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
    })
    const ctx = makeCtx(em, null)
    const result = await adjustTransactionCommand.execute(
      { tenantId: TENANT, organizationId: ORG, billAccountId: ACCT, amount: -10, description: 'Connector debit' } as never,
      ctx as never,
    )
    expect(result.balance).toBe('90.0000')
    expect(em.transactions).toHaveLength(1)
    expect(em.transactions[0].userId).toBeFalsy()
  })

  it('credits the balance', async () => {
    const em = createPrepaidMockEm({
      account: prepaidAccount(),
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-5.0000' },
    })
    const ctx = makeCtx(em)
    const result = await adjustTransactionCommand.execute(
      { tenantId: TENANT, organizationId: ORG, billAccountId: ACCT, amount: 25, description: 'Refund credit' } as never,
      ctx as never,
    )
    expect(result.balance).toBe('20.0000')
    expect(em.transactions[0].amount).toBe('25.0000')
  })

  it('rejects a non-zero amount on a postpaid account with 409', async () => {
    const em = createPrepaidMockEm({ account: prepaidAccount({ billingMode: 'postpaid' }) })
    const ctx = makeCtx(em)
    await expect(
      adjustTransactionCommand.execute(
        { tenantId: TENANT, organizationId: ORG, billAccountId: ACCT, amount: 10, description: 'x' } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.account.not_prepaid' }),
    })
  })
})
