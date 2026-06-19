import { processPrepaidAccount } from '../../lib/prepaidPeriodClose'
import { createPrepaidMockEm, type MockEm } from '../helpers/prepaidMockEm'

const TENANT = 'ten-1'
const ORG = 'org-1'
const ACCT = 'acct-1'

function prepaidAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCT,
    tenantId: TENANT,
    organizationId: ORG,
    currencyCode: 'EUR',
    billingMode: 'prepaid',
    billCycle: 'monthly',
    nextBillDate: new Date('2026-06-01'),
    lastBillDate: null,
    creditLimit: '0',
    updatedAt: new Date('2026-05-01'),
    ...overrides,
  }
}

const billRun = { id: 'run-1' }
const realParams = {
  asOfDate: new Date('2026-06-01'),
  mode: 'real' as const,
  triggeredBy: 'manual' as const,
  catchUp: false,
}

function recurringItem() {
  return {
    id: 'item-rec',
    type: 'recurring',
    billStartDate: new Date('2026-01-01'),
    billEndDate: null,
    billedToDate: null,
    isActive: true,
    deletedAt: null,
    rateJson: { unit_price: 20 },
    description: 'Platform fee',
  }
}

// Seed the period's real-time movements: a 100 top-up + 103 usage (May 2026).
function seedWindowActivity(em: MockEm) {
  em.transactions.push(
    {
      id: 't-top',
      type: 'topup',
      amount: '100.0000',
      billAccountId: ACCT,
      createdAt: new Date('2026-05-02'),
    },
    {
      id: 't-use',
      type: 'usage',
      amount: '-103.0000',
      billAccountId: ACCT,
      createdAt: new Date('2026-05-15'),
    },
  )
}

describe('processPrepaidAccount — period close (spec story step 6)', () => {
  it('charges recurring to the balance and builds the statement', async () => {
    const account = prepaidAccount()
    const item = recurringItem()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [item],
      existingStatement: null,
    })
    seedWindowActivity(em)

    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)

    expect(result.status).toBe('success')
    if (result.status === 'failed') throw new Error('unexpected failure')
    expect(result.statementId).toBeTruthy()
    expect(result.statementEvents.map((e) => e.id)).toEqual(['billing.statement.generated'])

    // The recurring charge hit the balance with a deterministic source_ref.
    const recurringTxn = em.transactions.find((t) => t.type === 'recurring')
    expect(recurringTxn).toBeTruthy()
    expect(recurringTxn!.amount).toBe('-20.0000')
    expect(recurringTxn!.sourceRef).toBe('recurring-item-rec-2026-05-31')

    // The statement chains: opening 0, +100 topups, −103 usage, −20 recurring = −23.
    const statement = em.persisted.find(
      (e) => (e as { status?: string }).status === 'generated',
    ) as Record<string, unknown>
    expect(statement).toBeTruthy()
    expect(statement.openingBalance).toBe('0.0000')
    expect(statement.totalTopups).toBe('100.0000')
    expect(statement.totalUsage).toBe('103.0000')
    expect(statement.totalRecurring).toBe('20.0000')
    expect(statement.closingBalance).toBe('-23.0000')

    // billed_to_date guard set; the cycle advanced.
    expect(item.billedToDate).toEqual(new Date('2026-05-31'))
    expect((account.nextBillDate as Date).toISOString().slice(0, 7)).toBe('2026-07')
  })

  it('still generates a statement with no recurring items (usage-only account)', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [],
    })
    seedWindowActivity(em)

    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)
    if (result.status === 'failed') throw new Error('unexpected failure')
    expect(result.statementId).toBeTruthy()
    const statement = em.persisted.find(
      (e) => (e as { status?: string }).status === 'generated',
    ) as Record<string, unknown>
    expect(statement.totalRecurring).toBe('0.0000')
    expect(statement.closingBalance).toBe('-3.0000') // 0 + 100 − 103 − 0
  })

  it('chains the opening balance from the prior statement closing', async () => {
    // Prior month closed at −23. This month: +50 top-ups, −40 usage, −20 recurring
    // → opening −23, closing −23 + 50 − 40 − 20 = −33. (A created_at sum would
    // wrongly drop the prior recurring and overstate the opening.)
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-13.0000' },
      items: [recurringItem()],
      existingStatement: null,
      priorStatement: { id: 'stmt-may', closingBalance: '-23.0000' },
    })
    em.transactions.push(
      { id: 't-top2', type: 'topup', amount: '50.0000', billAccountId: ACCT, createdAt: new Date('2026-05-10') },
      { id: 't-use2', type: 'usage', amount: '-40.0000', billAccountId: ACCT, createdAt: new Date('2026-05-20') },
    )

    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)
    if (result.status === 'failed') throw new Error('unexpected failure')
    const statement = em.persisted.find(
      (e) => (e as { status?: string }).status === 'generated',
    ) as Record<string, unknown>
    expect(statement.openingBalance).toBe('-23.0000')
    expect(statement.totalTopups).toBe('50.0000')
    expect(statement.totalUsage).toBe('40.0000')
    expect(statement.totalRecurring).toBe('20.0000')
    expect(statement.closingBalance).toBe('-33.0000')
  })

  it('fires a balance.low crossing when the recurring charge drops into the low band', async () => {
    // Balance 25 with threshold 10; the €20 recurring fee drops it to 5 → low.
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '25.0000', lowBalanceThreshold: '10.0000' },
      items: [recurringItem()],
    })
    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)
    if (result.status === 'failed') throw new Error('unexpected failure')
    expect(result.statementEvents.map((e) => e.id)).toContain('billing.balance.low')
    expect(result.statementEvents.map((e) => e.id)).toContain('billing.statement.generated')
  })

  it('includes manual adjustments in the statement math (closing stays consistent)', async () => {
    // Window has a +10 adjustment. opening 0, topups 100, usage 103, adj +10,
    // recurring 20 → closing 0 + 100 + 10 − 103 − 20 = −13.
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '7.0000' },
      items: [recurringItem()],
    })
    seedWindowActivity(em)
    em.transactions.push({
      id: 't-adj',
      type: 'adjustment',
      amount: '10.0000',
      billAccountId: ACCT,
      createdAt: new Date('2026-05-12'),
    })
    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)
    if (result.status === 'failed') throw new Error('unexpected failure')
    const statement = em.persisted.find(
      (e) => (e as { status?: string }).status === 'generated',
    ) as Record<string, unknown>
    expect(statement.totalAdjustments).toBe('10.0000')
    expect(statement.closingBalance).toBe('-13.0000')
  })

  it('skips when a statement already exists for the period (anti-duplicate)', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [recurringItem()],
      existingStatement: { id: 'stmt-prior' },
    })
    seedWindowActivity(em)

    const result = await processPrepaidAccount(em as never, account as never, billRun as never, realParams)
    expect(result.status).toBe('skipped_existing_statement')
    if (result.status === 'failed') throw new Error('unexpected failure')
    expect(result.statementId).toBe('stmt-prior')
    // No recurring charge applied.
    expect(em.transactions.find((t) => t.type === 'recurring')).toBeUndefined()
  })

  it('dry run computes nothing persisted and does not advance', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [recurringItem()],
    })
    seedWindowActivity(em)

    const result = await processPrepaidAccount(em as never, account as never, billRun as never, {
      ...realParams,
      mode: 'dry',
    })
    if (result.status === 'failed') throw new Error('unexpected failure')
    expect(result.statementId).toBeNull()
    expect(em.transactions.find((t) => t.type === 'recurring')).toBeUndefined()
    // Cycle not advanced (still June 1).
    expect((account.nextBillDate as Date).toISOString().slice(0, 10)).toBe('2026-06-01')
  })
})
