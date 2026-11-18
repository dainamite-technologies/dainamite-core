import { processPrepaidAccount } from '../../lib/prepaidPeriodClose'
import { createPrepaidMockEm, type MockEm } from '../helpers/prepaidMockEm'

const TENANT = 'ten-1'
const ORG = 'org-1'
const ACCT = 'acct-1'

type Row = Record<string, unknown>

function prepaidAccount(overrides: Row = {}): Row {
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
}

/** A recurring item already charged through April, billed in arrears (the pre-Spec F behaviour). */
function arrearsItem(overrides: Row = {}): Row {
  return {
    id: 'item-rec',
    type: 'recurring',
    billStartDate: new Date('2026-01-01'),
    billEndDate: null,
    billedToDate: new Date('2026-04-30'),
    chargeTiming: 'in_arrears',
    prorate: true,
    taxRate: '23',
    priceBasis: 'net',
    isActive: true,
    deletedAt: null,
    rateJson: { unit_price: 20 },
    description: 'Platform fee',
    ...overrides,
  }
}

// Seed the period's real-time movements: a 100 top-up + 103 usage (May 2026).
function seedWindowActivity(em: MockEm) {
  em.transactions.push(
    { id: 't-top', type: 'topup', amount: '100.0000', billAccountId: ACCT, createdAt: new Date('2026-05-02') },
    { id: 't-use', type: 'usage', amount: '-103.0000', billAccountId: ACCT, createdAt: new Date('2026-05-15') },
  )
}

function persistedStatement(em: MockEm): Row {
  return em.persisted.find((e) => (e as { status?: string }).status === 'generated') as Row
}

function iso(value: unknown): string {
  return new Date(value as Date | string).toISOString().slice(0, 10)
}

function okResult<T extends { status: string }>(result: T): Exclude<T, { status: 'failed' }> {
  if (result.status === 'failed') throw new Error('unexpected failure')
  return result as Exclude<T, { status: 'failed' }>
}

describe('processPrepaidAccount — period close and statement (SPEC-002)', () => {
  it('catches up on every due period in one real run', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0.0000' },
      items: [arrearsItem()],
      existingStatement: null,
    })

    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        triggeredBy: 'schedule',
        asOfDate: new Date('2026-08-01'),
      }),
    )
    expect(result.cyclesEmitted).toBe(3)
    expect(result.cycles.map((c) => [c.bill_date, c.status])).toEqual([
      ['2026-06-01', 'charged'],
      ['2026-07-01', 'charged'],
      ['2026-08-01', 'charged'],
    ])
    expect(iso(account.nextBillDate)).toBe('2026-09-01')
    expect(em.transactions.filter((t) => t.type === 'recurring').map((t) => t.sourceRef)).toEqual([
      'recurring-item-rec-charge-2026-05-01-2026-05-31',
      'recurring-item-rec-charge-2026-06-01-2026-06-30',
      'recurring-item-rec-charge-2026-07-01-2026-07-31',
    ])
  })

  it('charges recurring to the balance and builds the statement', async () => {
    const account = prepaidAccount()
    const item = arrearsItem()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [item],
      existingStatement: null,
    })
    seedWindowActivity(em)

    const result = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    expect(result.status).toBe('success')
    expect(result.statementId).toBeTruthy()
    expect(result.statementEvents.map((e) => e.id)).toEqual(['billing.statement.generated'])

    const recurringTxn = em.transactions.find((t) => t.type === 'recurring')!
    expect(recurringTxn.amount).toBe('-20.0000')
    expect(recurringTxn.metadata).toMatchObject({
      service_period_start: '2026-05-01',
      service_period_end: '2026-05-31',
      tax_point: 'topup',
      tax: '0.0000',
    })

    // opening 0, +100 top-ups, −103 usage, −20 charges = −23.
    const statement = persistedStatement(em)
    expect(statement.openingBalance).toBe('0.0000')
    expect(statement.totalTopups).toBe('100.0000')
    expect(statement.totalUsage).toBe('103.0000')
    expect(statement.totalRecurring).toBe('20.0000')
    expect(statement.closingBalance).toBe('-23.0000')
    expect(statement.vatSummary).toEqual([])

    expect(iso(item.billedToDate)).toBe('2026-05-31')
    expect(iso(account.nextBillDate)).toBe('2026-07-01')
  })

  it('still generates a statement with no charges (usage-only account)', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [],
    })
    seedWindowActivity(em)

    const result = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    expect(result.statementId).toBeTruthy()
    expect(result.cycles[0].status).toBe('empty')
    const statement = persistedStatement(em)
    expect(statement.totalRecurring).toBe('0.0000')
    expect(statement.closingBalance).toBe('-3.0000') // 0 + 100 − 103 − 0
  })

  it('chains the opening balance from the prior statement closing', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-13.0000' },
      items: [arrearsItem()],
      existingStatement: null,
      priorStatement: { id: 'stmt-may', closingBalance: '-23.0000' },
    })
    em.transactions.push(
      { id: 't-top2', type: 'topup', amount: '50.0000', billAccountId: ACCT, createdAt: new Date('2026-05-10') },
      { id: 't-use2', type: 'usage', amount: '-40.0000', billAccountId: ACCT, createdAt: new Date('2026-05-20') },
    )

    okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    const statement = persistedStatement(em)
    expect(statement.openingBalance).toBe('-23.0000')
    expect(statement.closingBalance).toBe('-33.0000') // −23 + 50 − 40 − 20
  })

  it('fires a balance.low crossing when a charge drops into the low band', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '25.0000', lowBalanceThreshold: '10.0000' },
      items: [arrearsItem()],
    })
    const result = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    expect(result.statementEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining(['billing.balance.low', 'billing.statement.generated']),
    )
  })

  it('includes manual adjustments in the statement math', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '7.0000' },
      items: [arrearsItem()],
    })
    seedWindowActivity(em)
    em.transactions.push({ id: 't-adj', type: 'adjustment', amount: '10.0000', billAccountId: ACCT, createdAt: new Date('2026-05-12') })
    okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    const statement = persistedStatement(em)
    expect(statement.totalAdjustments).toBe('10.0000')
    expect(statement.closingBalance).toBe('-13.0000')
  })
})

describe('processPrepaidAccount — anti-duplicate (Spec F)', () => {
  it('an existing statement is not duplicated; charges stay idempotent and the account advances', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [arrearsItem()],
      existingStatement: { id: 'stmt-prior' },
    })
    const result = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    expect(result.statementId).toBeNull()
    expect(persistedStatement(em)).toBeUndefined()
    expect(result.cycles[0]).toMatchObject({ status: 'charged', statement_id: 'stmt-prior' })
    // Never stuck behind the existing statement.
    expect(iso(account.nextBillDate)).toBe('2026-07-01')
  })

  it('reports skipped_existing when the statement and the charge both already exist', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [arrearsItem()],
      existingStatement: { id: 'stmt-prior' },
    })
    em.transactions.push({
      id: 't-charged',
      type: 'recurring',
      amount: '-20.0000',
      billAccountId: ACCT,
      sourceRef: 'recurring-item-rec-charge-2026-05-01-2026-05-31',
      createdAt: new Date('2026-06-01'),
    })
    const result = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, realParams))
    expect(result.cycles[0].status).toBe('skipped_existing')
    expect(em.transactions.filter((t) => t.type === 'recurring')).toHaveLength(1)
  })
})

describe('processPrepaidAccount — charge timing and proration (Spec F, F-D4)', () => {
  // The operator's scenario, with dates as MikroORM hydrates `date` columns
  // (YYYY-MM-DD strings) — the F4 report: a real run as of the second bill
  // date must close BOTH bill dates.
  function operatorScenario(chargeTiming: 'in_advance' | 'in_arrears') {
    const account = prepaidAccount({ nextBillDate: '2026-11-14' })
    const setupFee = {
      id: 'item-setup',
      type: 'one_time',
      billStartDate: '2026-11-14',
      billEndDate: null,
      billedToDate: null,
      taxRate: '23',
      priceBasis: 'net',
      isActive: true,
      deletedAt: null,
      rateJson: { amount: 99 },
      description: 'Setup fee',
    }
    const plan = {
      ...arrearsItem({ id: 'item-plan', description: 'Plan', rateJson: { unit_price: 49 } }),
      billStartDate: '2026-11-14',
      billedToDate: null,
      chargeTiming,
    }
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '500.0000' },
      items: [setupFee, plan],
    })
    return { account, em, plan, setupFee }
  }

  it('in advance: the Nov 14 run charges the setup fee + Nov 14–Dec 13, the Dec 14 cycle charges Dec 14–Jan 13', async () => {
    const { account, em, plan } = operatorScenario('in_advance')
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-14'),
      }),
    )
    expect(result.cycles.map((c) => [c.bill_date, c.status, c.total_debit])).toEqual([
      ['2026-11-14', 'charged', '148.0000'],
      ['2026-12-14', 'charged', '49.0000'],
    ])
    expect(em.transactions.filter((t) => t.type !== 'topup').map((t) => [t.type, t.amount, t.sourceRef])).toEqual([
      ['recurring', '-49.0000', 'recurring-item-plan-charge-2026-11-14-2026-12-13'],
      ['one_time', '-99.0000', 'one_time-item-setup'],
      ['recurring', '-49.0000', 'recurring-item-plan-charge-2026-12-14-2027-01-13'],
    ])
    expect(iso(account.nextBillDate)).toBe('2027-01-14')
    expect(iso(plan.billedToDate)).toBe('2027-01-13')
  })

  it('in arrears: the Nov 14 bill date charges only the setup fee; Dec 14 charges Nov 14–Dec 13', async () => {
    const { account, em } = operatorScenario('in_arrears')
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-14'),
      }),
    )
    expect(result.cycles.map((c) => [c.bill_date, c.total_debit])).toEqual([
      ['2026-11-14', '99.0000'],
      ['2026-12-14', '49.0000'],
    ])
    expect(em.transactions.find((t) => t.type === 'recurring')!.sourceRef).toBe(
      'recurring-item-plan-charge-2026-11-14-2026-12-13',
    )
    expect(iso(account.nextBillDate)).toBe('2027-01-14')
  })

  it('switching in advance → in arrears never charges a period twice', async () => {
    const account = prepaidAccount({ nextBillDate: '2026-12-14' })
    const item = arrearsItem({ billStartDate: '2026-11-14', billedToDate: '2026-12-13', chargeTiming: 'in_arrears' })
    const em = createPrepaidMockEm({ account, balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' }, items: [item] })
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-14'),
      }),
    )
    expect(result.cycles[0].status).toBe('empty')
    expect(em.transactions.filter((t) => t.type === 'recurring')).toHaveLength(0)
  })

  it('prorates a mid-period start; with prorate off it is skipped and reported', async () => {
    const make = (prorate: boolean) => {
      const account = prepaidAccount({ nextBillDate: '2026-11-14' })
      const item = arrearsItem({
        billStartDate: '2026-11-20',
        billedToDate: null,
        chargeTiming: 'in_advance',
        prorate,
        rateJson: { unit_price: 49 },
      })
      return { account, em: createPrepaidMockEm({ account, balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' }, items: [item] }) }
    }
    const params = { ...realParams, asOfDate: new Date('2026-11-14') }

    const prorated = make(true)
    okResult(await processPrepaidAccount(prorated.em as never, prorated.account as never, billRun as never, params))
    // Nov 20 – Dec 13 = 24 of 30 days → 49 × 24 / 30 = 39.20.
    expect(prorated.em.transactions.find((t) => t.type === 'recurring')!.amount).toBe('-39.2000')

    const skipped = make(false)
    const result = okResult(await processPrepaidAccount(skipped.em as never, skipped.account as never, billRun as never, params))
    expect(skipped.em.transactions.filter((t) => t.type === 'recurring')).toHaveLength(0)
    expect(result.warnings?.skipped_items?.[0]).toMatchObject({ item_id: 'item-rec', reason: 'partial-period-not-prorated' })
  })

  it('credits unused days back to the balance when an item ends inside a charged period', async () => {
    const account = prepaidAccount({ nextBillDate: '2026-12-14' })
    const item = arrearsItem({
      billStartDate: '2026-11-14',
      billEndDate: '2026-11-30',
      billedToDate: '2026-12-13',
      chargeTiming: 'in_advance',
      rateJson: { unit_price: 30 },
    })
    const em = createPrepaidMockEm({ account, balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' }, items: [item] })
    okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-14'),
      }),
    )
    const credit = em.transactions.find((t) => String(t.sourceRef).includes('-credit-'))!
    expect(credit.type).toBe('recurring')
    expect(Number(credit.amount)).toBeGreaterThan(0)
  })
})

describe('processPrepaidAccount — tax point (Spec F, F-D3)', () => {
  function run(taxPoint: 'topup' | 'consumption', item: Row) {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '100.0000' },
      items: [item],
      configs: { 'prepaid.tax_point': taxPoint },
    })
    return { em, promise: processPrepaidAccount(em as never, account as never, billRun as never, realParams) }
  }

  it('topup: debits the item amount as entered, without VAT', async () => {
    const { em, promise } = run('topup', arrearsItem({ rateJson: { unit_price: 49 } }))
    okResult(await promise)
    expect(em.transactions.find((t) => t.type === 'recurring')!.amount).toBe('-49.0000')
    expect(persistedStatement(em).vatSummary).toEqual([])
  })

  it('consumption: debits the gross at the item rate (10 net @ 23 % → 12.30)', async () => {
    const { em, promise } = run('consumption', arrearsItem({ rateJson: { unit_price: 10 } }))
    okResult(await promise)
    const txn = em.transactions.find((t) => t.type === 'recurring')!
    expect(txn.amount).toBe('-12.3000')
    expect(txn.metadata).toMatchObject({ net: '10.0000', tax: '2.3000', tax_rate: '23', tax_point: 'consumption' })
    expect(persistedStatement(em).vatSummary).toEqual([{ rate: '23', net: '10.0000', tax: '2.3000', gross: '12.3000' }])
    expect(em.balances.get(`${TENANT}:${ACCT}`)!.balance).toBe('87.7000')
  })

  it('consumption: a gross-basis price is debited exactly as typed', async () => {
    const { em, promise } = run('consumption', arrearsItem({ priceBasis: 'gross', rateJson: { unit_price: 12.3 } }))
    okResult(await promise)
    expect(em.transactions.find((t) => t.type === 'recurring')!.amount).toBe('-12.3000')
  })
})

describe('processPrepaidAccount — test and dry runs (Spec F, P-D9)', () => {
  it('test mode previews every due cycle and persists nothing', async () => {
    const account = prepaidAccount()
    const item = arrearsItem()
    const em = createPrepaidMockEm({ account, balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' }, items: [item] })
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        mode: 'test',
        asOfDate: new Date('2026-08-01'),
      }),
    )
    expect(result.cycles.map((c) => c.status)).toEqual(['previewed', 'previewed', 'previewed'])
    expect(result.cyclesEmitted).toBe(3)
    expect(em.transactions.filter((t) => t.type === 'recurring')).toHaveLength(0)
    expect(persistedStatement(em)).toBeUndefined()
    expect(iso(account.nextBillDate)).toBe('2026-06-01')
    expect(iso(item.billedToDate)).toBe('2026-04-30')
  })

  it('dry run persists nothing and does not advance', async () => {
    const account = prepaidAccount()
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '-3.0000' },
      items: [arrearsItem()],
    })
    seedWindowActivity(em)
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, { ...realParams, mode: 'dry' }),
    )
    expect(result.statementId).toBeNull()
    expect(result.cycles[0]).toMatchObject({ status: 'previewed', total_debit: '20.0000' })
    expect(em.transactions.find((t) => t.type === 'recurring')).toBeUndefined()
    expect(iso(account.nextBillDate)).toBe('2026-06-01')
  })
})

describe('processPrepaidAccount — statement window includes the bill date (Spec F tweak)', () => {
  it('a top-up made ON the bill date funds that statement: no negative opening on the next one', async () => {
    // Bill date Nov 15; 300 topped up on Nov 15; one-time 99 + monthly 49 in
    // advance, both from Nov 1; run executed later, as of Dec 31.
    const account = prepaidAccount({ nextBillDate: '2026-11-15' })
    const fee = {
      id: 'item-fee',
      type: 'one_time',
      billStartDate: '2026-11-01',
      billEndDate: null,
      billedToDate: null,
      taxRate: '23',
      priceBasis: 'net',
      isActive: true,
      deletedAt: null,
      rateJson: { amount: 99 },
      description: 'Setup fee',
    }
    const plan = arrearsItem({
      id: 'item-plan',
      billStartDate: '2026-11-01',
      billedToDate: null,
      chargeTiming: 'in_advance',
      rateJson: { unit_price: 49 },
    })
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '300.0000' },
      items: [fee, plan],
    })
    em.transactions.push({
      id: 't-topup',
      type: 'topup',
      amount: '300.0000',
      billAccountId: ACCT,
      createdAt: new Date('2026-11-15T10:00:00Z'),
    })

    okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-31'),
      }),
    )
    const statements = em.persisted.filter((e) => (e as { status?: string }).status === 'generated') as Row[]
    expect(statements).toHaveLength(2)
    const [first, second] = statements
    expect(first.openingBalance).toBe('0.0000')
    expect(first.totalTopups).toBe('300.0000')
    expect(Number(first.closingBalance)).toBeGreaterThan(0)
    expect(second.openingBalance).toBe(first.closingBalance)
    expect(second.totalTopups).toBe('0.0000')
  })
})

describe('processPrepaidAccount — first-cycle period never before the billing start (#138)', () => {
  // The issue's demo account: monthly, cycle day 10, a 150 EUR in-advance fee
  // and metered API usage, both from 2026-11-10. Top-ups were posted as manual
  // adjustments and, like the usage, created on 2026-11-18 (back-dated runs).
  function demoAccount() {
    const account = prepaidAccount({ nextBillDate: '2026-11-10', billCycleDay: '10' })
    const fee = arrearsItem({
      id: 'item-fee',
      description: 'Subscription Fee',
      billStartDate: '2026-11-10',
      billedToDate: null,
      chargeTiming: 'in_advance',
      rateJson: { unit_price: 150 },
    })
    const usageItem = {
      id: 'item-api',
      type: 'usage',
      billStartDate: '2026-11-10',
      billEndDate: null,
      billedToDate: null,
      isActive: true,
      deletedAt: null,
      uomCode: 'api_call',
      rateJson: { unit_price: 0.82 },
      description: 'API Usage',
    }
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '1063.6600' },
      items: [fee, usageItem],
    })
    const at = new Date('2026-11-18T12:00:00Z')
    em.transactions.push(
      { id: 'a1', type: 'adjustment', amount: '120.0000', billAccountId: ACCT, createdAt: at },
      { id: 'u1', type: 'usage', amount: '-114.8000', billAccountId: ACCT, createdAt: at },
      { id: 'a2', type: 'adjustment', amount: '1200.0000', billAccountId: ACCT, createdAt: at },
      { id: 'u2', type: 'usage', amount: '-60.6800', billAccountId: ACCT, createdAt: at },
      { id: 'u3', type: 'usage', amount: '-100.8600', billAccountId: ACCT, createdAt: at },
    )
    return { account, em, fee }
  }

  function statements(em: MockEm): Row[] {
    return em.persisted.filter((e) => (e as { status?: string }).status === 'generated') as Row[]
  }

  it('first bill date = start date: takes the in-advance charge but writes no pre-start statement', async () => {
    const { account, em, fee } = demoAccount()
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-11-10'),
      }),
    )
    expect(result.cycles).toEqual([
      expect.objectContaining({
        bill_date: '2026-11-10',
        period_start: null,
        period_end: null,
        status: 'charged',
        total_debit: '150.0000',
        statement_id: null,
      }),
    ])
    expect(result.statementId).toBeNull()
    expect(statements(em)).toHaveLength(0)
    const charge = em.transactions.find((t) => t.type === 'recurring')!
    expect(charge.sourceRef).toBe('recurring-item-fee-charge-2026-11-10-2026-12-09')
    expect(charge.metadata).toMatchObject({ bill_date: '2026-11-10', bill_period_start: null, bill_period_end: null })
    // The next period starts at the first bill date.
    expect(iso(account.lastBillDate)).toBe('2026-11-09')
    expect(iso(account.nextBillDate)).toBe('2026-12-10')
    expect(iso(fee.billedToDate)).toBe('2026-12-09')
  })

  it('the next run writes the first statement from the start date; opening carries the earlier charge', async () => {
    const { account, em } = demoAccount()
    okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-11-10'),
      }),
    )
    okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-10'),
      }),
    )
    const [first, ...rest] = statements(em)
    expect(rest).toHaveLength(0)
    expect([iso(first.periodStart), iso(first.periodEnd)]).toEqual(['2026-11-10', '2026-12-09'])
    expect(first.openingBalance).toBe('-150.0000')
    expect(first.totalTopups).toBe('0.0000')
    expect(first.totalAdjustments).toBe('1320.0000')
    expect(first.totalUsage).toBe('276.3400')
    expect(first.totalRecurring).toBe('150.0000')
    // −150 + 1,320 − 276.34 − 150 — the true ledger balance.
    expect(first.closingBalance).toBe('743.6600')
    expect(em.balances.get(`${TENANT}:${ACCT}`)!.balance).toBe('763.6600')
  })

  it('one catch-up run over both bill dates chains to the same statement', async () => {
    const { account, em } = demoAccount()
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-12-10'),
      }),
    )
    expect(result.cycles.map((c) => [c.bill_date, c.period_start, c.period_end])).toEqual([
      ['2026-11-10', null, null],
      ['2026-12-10', '2026-11-10', '2026-12-09'],
    ])
    const [only, ...rest] = statements(em)
    expect(rest).toHaveLength(0)
    expect(only.openingBalance).toBe('-150.0000')
    expect(only.closingBalance).toBe('743.6600')
  })

  it('re-running an opening cycle never double-charges', async () => {
    const { account, em, fee } = demoAccount()
    const params = { ...realParams, asOfDate: new Date('2026-11-10') }
    okResult(await processPrepaidAccount(em as never, account as never, billRun as never, params))
    // Simulate a re-run against the unadvanced state (e.g. a crash before flush).
    account.nextBillDate = '2026-11-10'
    account.lastBillDate = null
    fee.billedToDate = null
    const again = okResult(await processPrepaidAccount(em as never, account as never, billRun as never, params))
    expect(again.cycles[0]).toMatchObject({ status: 'empty', statement_id: null })
    expect(em.transactions.filter((t) => t.type === 'recurring')).toHaveLength(1)
    expect(statements(em)).toHaveLength(0)
  })

  it('clamps the first period to a mid-cycle billing start', async () => {
    const account = prepaidAccount({ nextBillDate: '2026-11-15' })
    const plan = arrearsItem({
      billStartDate: '2026-11-01',
      billedToDate: null,
      chargeTiming: 'in_advance',
      rateJson: { unit_price: 49 },
    })
    const em = createPrepaidMockEm({ account, balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' }, items: [plan] })
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-11-15'),
      }),
    )
    expect(result.cycles[0]).toMatchObject({ period_start: '2026-11-01', period_end: '2026-11-14' })
    expect(iso(persistedStatement(em).periodStart)).toBe('2026-11-01')
    expect(iso(account.lastBillDate)).toBe('2026-11-14')
  })

  it('an existing statement for the same bill date (pre-start, written before the fix) is not duplicated', async () => {
    const account = prepaidAccount({ nextBillDate: '2026-11-15' })
    const plan = arrearsItem({ billStartDate: '2026-11-01', billedToDate: null, chargeTiming: 'in_advance' })
    const em = createPrepaidMockEm({
      account,
      balance: { tenantId: TENANT, billAccountId: ACCT, balance: '0' },
      items: [plan],
      existingStatement: { id: 'stmt-legacy', periodStart: '2026-10-15', periodEnd: '2026-11-14' },
    })
    const result = okResult(
      await processPrepaidAccount(em as never, account as never, billRun as never, {
        ...realParams,
        asOfDate: new Date('2026-11-15'),
      }),
    )
    expect(persistedStatement(em)).toBeUndefined()
    expect(result.cycles[0]).toMatchObject({ statement_id: 'stmt-legacy' })
    // The anti-duplicate lookup keys on the bill date's period end.
    const lookup = em.findOne.mock.calls.find(
      ([entity, where]) => (entity as { name?: string }).name === 'BillingStatement' && !('$lt' in Object(where.periodEnd)),
    )!
    expect(lookup[1]).toEqual({ tenantId: TENANT, billAccountId: ACCT, periodEnd: '2026-11-14' })
  })
})
