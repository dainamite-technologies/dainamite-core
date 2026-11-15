import {
  ACCOUNT_FINANCIALS_SQL,
  OVERDUE_ACCOUNT_IDS_SQL,
  fetchAccountFinancials,
  fetchOverdueAccountIds,
  financialsOrZero,
} from '../../lib/accountFinancials'

const scope = { tenantId: 't-1', organizationId: 'o-1' }

describe('fetchAccountFinancials (Spec F, P-D15)', () => {
  it('runs ONE grouped query for the whole page (today first, then scope and the id array)', async () => {
    const execute = jest.fn(async () => [
      { bill_account_id: 'a-1', balance_due: '120.5', overdue_amount: '20' },
    ])
    const result = await fetchAccountFinancials({ execute } as never, scope, ['a-1', 'a-2'], new Date('2026-11-15T09:00:00Z'))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(ACCOUNT_FINANCIALS_SQL, ['2026-11-15', 't-1', 'o-1', '{a-1,a-2}'])
    expect(result.get('a-1')).toEqual({ balance_due: '120.5000', overdue_amount: '20.0000' })
    expect(financialsOrZero(result, 'a-2')).toEqual({ balance_due: '0.0000', overdue_amount: '0.0000' })
  })

  it('skips the query for an empty page', async () => {
    const execute = jest.fn()
    expect((await fetchAccountFinancials({ execute } as never, scope, [])).size).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  it('counts open receivables only and never test runs', () => {
    expect(ACCOUNT_FINANCIALS_SQL).toContain('i.test_run = false')
    expect(ACCOUNT_FINANCIALS_SQL).toContain("i.status IN ('posted', 'partially_paid')")
    expect(ACCOUNT_FINANCIALS_SQL).toContain('GROUP BY i.bill_account_id')
  })
})

describe('fetchOverdueAccountIds', () => {
  it('returns distinct ids across the visible organizations', async () => {
    const execute = jest.fn(async () => [{ bill_account_id: 'a-9' }])
    const ids = await fetchOverdueAccountIds(
      { execute } as never,
      { tenantId: 't-1', organizationIds: ['o-1', 'o-2'] },
      new Date('2026-11-15T00:00:00Z'),
    )
    expect(ids).toEqual(['a-9'])
    expect(execute).toHaveBeenCalledWith(OVERDUE_ACCOUNT_IDS_SQL, ['t-1', '{o-1,o-2}', '2026-11-15'])
  })

  it('returns nothing without an organization scope', async () => {
    const execute = jest.fn()
    expect(await fetchOverdueAccountIds({ execute } as never, { tenantId: 't-1', organizationIds: [] })).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })
})
