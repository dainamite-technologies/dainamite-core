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

function makeCtx(em: MockEm) {
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    auth: { sub: '99999999-9999-4999-8999-999999999999' },
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
