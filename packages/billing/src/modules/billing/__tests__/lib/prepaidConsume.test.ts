import { consumePrepaidUsage, type PrepaidConsumeInput } from '../../lib/prepaidConsume'
import { createPrepaidMockEm } from '../helpers/prepaidMockEm'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ACCT = '33333333-3333-4333-8333-333333333333'

function makeAccount(overrides: Record<string, unknown> = {}) {
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

function flatUsageItem() {
  return {
    id: 'item-1',
    type: 'usage',
    uomCode: 'api_request',
    isActive: true,
    deletedAt: null,
    rateJson: { unit_price: 0.001 },
    description: 'API requests',
  }
}

function baseInput(overrides: Partial<PrepaidConsumeInput> = {}): PrepaidConsumeInput {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    billAccountId: ACCT,
    uomCode: 'api_request',
    quantity: 8000,
    periodStart: new Date('2026-06-01'),
    periodEnd: new Date('2026-06-30'),
    lineDescription: null,
    sourceRef: null,
    ...overrides,
  }
}

const balanceRow = (balance: string, threshold: string | null = null) => ({
  tenantId: TENANT,
  billAccountId: ACCT,
  balance,
  lowBalanceThreshold: threshold,
})

describe('consumePrepaidUsage — happy path', () => {
  it('rates synchronously, debits, returns the remaining balance', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount(),
      balance: balanceRow('100.0000'),
      usageItem: flatUsageItem(),
    })
    const { result, events } = await consumePrepaidUsage(em as never, makeAccount() as never, baseInput())

    expect(result.deduplicated).toBe(false)
    expect(result.ratedAmount).toBe('8.0000') // 8000 × 0.001
    expect(result.balance).toBe('92.0000')
    expect(result.balanceStatus).toBe('ok')
    expect(result.creditStatus).toBe('within_limit')
    expect(result.warning).toBeNull()
    expect(result.tierBreakdown.length).toBeGreaterThan(0)
    // One usage record + one debit transaction.
    expect(em.usages).toHaveLength(1)
    expect(em.transactions).toHaveLength(1)
    expect(em.transactions[0].amount).toBe('-8.0000')
    // usage.rated event emitted (no threshold crossings on a healthy balance).
    expect(events.map((e) => e.id)).toEqual(['billing.usage.rated'])
  })
})

describe('consumePrepaidUsage — never rejected', () => {
  it('records usage with a 0 debit + warning when no item matches', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount(),
      balance: balanceRow('100.0000'),
      usageItem: null, // no matching item
    })
    const { result } = await consumePrepaidUsage(em as never, makeAccount() as never, baseInput())

    expect(result.warning).toBe('no_matching_item')
    expect(result.ratedAmount).toBe('0.0000')
    expect(result.balance).toBe('100.0000') // unchanged
    expect(em.usages).toHaveLength(1) // still recorded
    expect(em.transactions[0].amount).toBe('0.0000')
  })

  it('lets the balance go negative and reports exhausted', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount(),
      balance: balanceRow('5.0000'),
      usageItem: flatUsageItem(),
    })
    const { result, events } = await consumePrepaidUsage(
      em as never,
      makeAccount() as never,
      baseInput(),
    )
    expect(result.balance).toBe('-3.0000') // 5 − 8
    expect(result.balanceStatus).toBe('exhausted')
    expect(events.map((e) => e.id)).toContain('billing.balance.exhausted')
  })

  it('emits balance.low when crossing into the low band', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount(),
      balance: balanceRow('15.0000', '10.0000'),
      usageItem: flatUsageItem(),
    })
    const { result, events } = await consumePrepaidUsage(
      em as never,
      makeAccount() as never,
      baseInput(),
    )
    expect(result.balance).toBe('7.0000') // 15 − 8
    expect(result.balanceStatus).toBe('low')
    expect(events.map((e) => e.id)).toContain('billing.balance.low')
  })
})

describe('consumePrepaidUsage — idempotency', () => {
  it('a duplicate sourceRef does NOT double-debit and returns the prior balance_after', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount(),
      balance: balanceRow('92.0000'),
      usageItem: flatUsageItem(),
      existingUsage: { id: 'usage-prior', sourceRef: 'batch-42', billAccountId: ACCT },
    })
    // Seed the paired transaction the prior consume wrote.
    em.transactions.push({
      id: 'txn-prior',
      usageId: 'usage-prior',
      billAccountId: ACCT,
      amount: '-8.0000',
      balanceAfter: '92.0000',
      metadata: { usage_tier_breakdown: [{ tierIndex: 0 }], warning: undefined },
      createdAt: new Date('2026-06-10'),
    })

    const { result } = await consumePrepaidUsage(
      em as never,
      makeAccount() as never,
      baseInput({ sourceRef: 'batch-42' }),
    )

    expect(result.deduplicated).toBe(true)
    expect(result.id).toBe('usage-prior')
    expect(result.ratedAmount).toBe('8.0000')
    expect(result.balance).toBe('92.0000')
    // No new usage record, no new transaction.
    expect(em.usages.filter((u) => u.id !== 'usage-prior')).toHaveLength(0)
    expect(em.transactions).toHaveLength(1)
  })
})

describe('consumePrepaidUsage — credit line', () => {
  it('reports within_limit while exhausted on funds (credit covers the overdraft)', async () => {
    const em = createPrepaidMockEm({
      account: makeAccount({ creditLimit: '50.0000' }),
      balance: balanceRow('5.0000'),
      usageItem: flatUsageItem(),
    })
    const { result, events } = await consumePrepaidUsage(
      em as never,
      makeAccount({ creditLimit: '50.0000' }) as never,
      baseInput(),
    )
    expect(result.balanceStatus).toBe('exhausted') // balance -3
    expect(result.creditStatus).toBe('within_limit') // used 3 of 50
    expect(events.map((e) => e.id)).not.toContain('billing.credit.over_limit')
  })
})
