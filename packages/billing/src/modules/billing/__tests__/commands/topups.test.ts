import { createTopupCommand } from '../../commands/topups'
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

function makeCtx(em: MockEm, gateway: unknown) {
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
        if (name === 'paymentGatewayService') return gateway
        return null
      }),
    },
  }
}

const baseInput = {
  tenantId: TENANT,
  organizationId: ORG,
  billAccountId: ACCT,
  amount: 100,
  successUrl: 'https://app.example/return',
  cancelUrl: 'https://app.example/cancel',
}

describe('createTopupCommand', () => {
  it('registers a pending top-up and opens an automatic-capture session', async () => {
    const em = createPrepaidMockEm({ account: prepaidAccount(), topup: null })
    const gateway = {
      createPaymentSession: jest.fn(async () => ({
        transaction: { id: 'gw-txn-1' },
        session: { sessionId: 'sess-1', redirectUrl: 'https://pay.example/x', clientSecret: null },
      })),
    }
    const ctx = makeCtx(em, gateway)
    const result = await createTopupCommand.execute(baseInput as never, ctx as never)

    expect(result.status).toBe('pending')
    expect(result.transactionId).toBe('gw-txn-1')
    expect(result.redirectUrl).toBe('https://pay.example/x')
    expect(result.paymentId).toBeTruthy()

    // The gateway was asked for an automatic-capture prepaid_topup session.
    const sessionArg = gateway.createPaymentSession.mock.calls[0][0] as Record<string, unknown>
    expect(sessionArg.captureMethod).toBe('automatic')
    expect(sessionArg.amount).toBe(100)
    expect((sessionArg.metadata as Record<string, unknown>).kind).toBe('prepaid_topup')
  })

  it('rejects a top-up on a postpaid account with 409', async () => {
    const em = createPrepaidMockEm({ account: prepaidAccount({ billingMode: 'postpaid' }) })
    const gateway = { createPaymentSession: jest.fn() }
    const ctx = makeCtx(em, gateway)
    await expect(
      createTopupCommand.execute(baseInput as never, ctx as never),
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'billing.account.not_prepaid' }),
    })
    expect(gateway.createPaymentSession).not.toHaveBeenCalled()
  })

  it('is idempotent on sourceRef — returns the prior top-up without a new session', async () => {
    const existing = {
      id: 'topup-prior',
      paymentId: 'pay-prior',
      status: 'pending',
      gatewayTransactionId: 'gw-prior',
      metadata: { redirect_url: 'https://pay.example/prior', client_secret: null },
    }
    const em = createPrepaidMockEm({ account: prepaidAccount(), topup: existing })
    const gateway = { createPaymentSession: jest.fn() }
    const ctx = makeCtx(em, gateway)

    const result = await createTopupCommand.execute(
      { ...baseInput, sourceRef: 'req-7' } as never,
      ctx as never,
    )
    expect(result.topupId).toBe('topup-prior')
    expect(result.redirectUrl).toBe('https://pay.example/prior')
    expect(gateway.createPaymentSession).not.toHaveBeenCalled()
  })
})
