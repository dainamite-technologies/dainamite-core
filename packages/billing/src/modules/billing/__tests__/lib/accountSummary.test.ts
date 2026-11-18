import {
  ACCOUNT_SUMMARY_SQL,
  BALANCE_SQL,
  LAST_INVOICE_SQL,
  LAST_STATEMENT_SQL,
  getAccountArSummary,
  getAccountWorkspaceSummary,
} from '../../lib/accountSummary'

const account = { id: 'acc-1', tenantId: 't-1', organizationId: 'o-1', currencyCode: 'PLN' }

describe('getAccountArSummary', () => {
  it('runs one aggregate query with today bound for both overdue filters, then the scope', async () => {
    const execute = jest.fn(async (sql: string) =>
      sql === ACCOUNT_SUMMARY_SQL
        ? [{ open_amount: '300.5', overdue_amount: '120', overdue_count: 2 }]
        : [{ source_type: 'payment', id: 'p-1', available: '25.5' }, { source_type: 'credit_memo', id: 'm-1', available: '10' }],
    )
    const result = await getAccountArSummary({ execute } as never, account, new Date('2026-11-14T10:00:00Z'))
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledWith(ACCOUNT_SUMMARY_SQL, ['2026-11-14', '2026-11-14', 't-1', 'o-1', 'acc-1'])
    expect(result).toEqual({
      bill_account_id: 'acc-1',
      currency_code: 'PLN',
      open_amount: '300.5000',
      overdue_amount: '120.0000',
      overdue_count: 2,
      // Spec C: unallocated payments + open credit memos
      credit_amount: '35.5000',
    })
  })

  it('returns zeros when the account has no open documents', async () => {
    const execute = jest.fn(async (sql: string) =>
      sql === ACCOUNT_SUMMARY_SQL ? [{ open_amount: null, overdue_amount: null, overdue_count: null }] : [],
    )
    const result = await getAccountArSummary({ execute } as never, account)
    expect(result).toMatchObject({ open_amount: '0.0000', overdue_amount: '0.0000', overdue_count: 0 })
  })

  it('excludes test runs and non-receivable documents', () => {
    expect(ACCOUNT_SUMMARY_SQL).toContain('i.test_run = false')
    expect(ACCOUNT_SUMMARY_SQL).toContain("i.document_type IN ('invoice', 'debit_memo')")
    expect(ACCOUNT_SUMMARY_SQL).toContain("i.status IN ('posted', 'partially_paid')")
  })
})

describe('getAccountWorkspaceSummary (Spec F, F8)', () => {
  const settingsRow = { id: 's-1', lowBalanceThresholdDefault: '10' }
  function fakeEm(rows: Record<string, unknown[]>) {
    return {
      execute: jest.fn(async (sql: string) => rows[sql] ?? []),
      findOne: jest.fn(async () => settingsRow),
    }
  }

  it('postpaid: AR + cycle state + last invoice, no prepaid block', async () => {
    const em = fakeEm({
      [ACCOUNT_SUMMARY_SQL]: [{ open_amount: '50', overdue_amount: '0', overdue_count: 0 }],
      [LAST_INVOICE_SQL]: [{ id: 'inv-1', number: 'INV/2026/11/0001', issue_date: '2026-11-14', total_gross: '61.5' }],
    })
    const result = await getAccountWorkspaceSummary(
      em as never,
      { ...account, billingMode: 'postpaid', billCycle: 'monthly', nextBillDate: '2026-12-14' as never, creditLimit: '0' },
      new Date('2026-11-15T00:00:00Z'),
    )
    expect(result).toMatchObject({
      billing_mode: 'postpaid',
      next_bill_date: '2026-12-14',
      last_invoice: { id: 'inv-1', number: 'INV/2026/11/0001', issue_date: '2026-11-14', total_gross: '61.5000' },
      prepaid: null,
    })
    expect(em.execute).not.toHaveBeenCalledWith(BALANCE_SQL, expect.anything())
  })

  it('prepaid: balance with status from the threshold, credit limit and last statement', async () => {
    const em = fakeEm({
      [ACCOUNT_SUMMARY_SQL]: [{ open_amount: '0', overdue_amount: '0', overdue_count: 0 }],
      [BALANCE_SQL]: [{ balance: '8.5', low_balance_threshold: null }],
      [LAST_STATEMENT_SQL]: [{ id: 'st-1', period_start: '2026-10-14', period_end: '2026-11-13', closing_balance: '8.5' }],
    })
    const result = await getAccountWorkspaceSummary(em as never, {
      ...account,
      billingMode: 'prepaid',
      billCycle: 'monthly',
      nextBillDate: new Date('2026-12-14T00:00:00Z'),
      creditLimit: '100',
    })
    expect(result.prepaid).toEqual({
      balance: '8.5000',
      balance_status: 'low', // 8.50 ≤ the 10.00 org default threshold
      credit_limit: '100.0000',
      last_statement: { id: 'st-1', period_start: '2026-10-14', period_end: '2026-11-13', closing_balance: '8.5000' },
    })
    expect(result.last_invoice).toBeNull()
  })
})
