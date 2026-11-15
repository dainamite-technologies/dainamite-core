import { ACCOUNT_SUMMARY_SQL, getAccountArSummary } from '../../lib/accountSummary'

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
