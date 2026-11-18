import {
  allocate,
  applyAccountCredit,
  fromCents,
  paymentStatusFor,
  planAllocation,
  recomputeReceivable,
  sortOpenReceivables,
  toCents,
  unallocate,
} from '../../lib/allocation'
import { accountLockKey, withAccountLock } from '../../lib/accountLock'

const scope = { tenantId: 't-1', organizationId: 'o-1' }

describe('allocation — pure helpers', () => {
  it('converts money to cents and back (4 dp column format)', () => {
    expect(toCents('123.4500')).toBe(12345)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(null)).toBe(0)
    expect(fromCents(12345)).toBe('123.4500')
  })

  it('orders receivables oldest due first, nulls last, then issue date and number', () => {
    const rows = [
      { id: 'c', dueDate: null, issueDate: '2026-01-01', number: 'C' },
      { id: 'b', dueDate: '2026-02-01', issueDate: '2026-01-10', number: 'B' },
      { id: 'a', dueDate: '2026-01-15', issueDate: '2026-01-01', number: 'A' },
      { id: 'a2', dueDate: '2026-01-15', issueDate: '2026-01-01', number: 'A2' },
    ]
    expect(sortOpenReceivables(rows).map((r) => r.id)).toEqual(['a', 'a2', 'b', 'c'])
  })

  it('plans allocations never above outstanding and returns the remainder', () => {
    expect(
      planAllocation(15000, [
        { id: 'i1', outstandingCents: 10000 },
        { id: 'i2', outstandingCents: 0 },
        { id: 'i3', outstandingCents: 3000 },
      ]),
    ).toEqual({
      allocations: [
        { invoiceId: 'i1', amountCents: 10000 },
        { invoiceId: 'i3', amountCents: 3000 },
      ],
      remainderCents: 2000,
    })
    expect(planAllocation(500, [{ id: 'i1', outstandingCents: 10000 }])).toEqual({
      allocations: [{ invoiceId: 'i1', amountCents: 500 }],
      remainderCents: 0,
    })
  })

  it.each([
    [{ status: 'posted', totalGrossCents: 12300, paidCents: 0, creditedCents: 0 }, 'posted', 12300],
    [{ status: 'posted', totalGrossCents: 12300, paidCents: 5000, creditedCents: 0 }, 'partially_paid', 7300],
    [{ status: 'partially_paid', totalGrossCents: 12300, paidCents: 12300, creditedCents: 0 }, 'paid', 0],
    [{ status: 'posted', totalGrossCents: 12300, paidCents: 0, creditedCents: 12300 }, 'credited', 0],
    [{ status: 'posted', totalGrossCents: 12300, paidCents: 2300, creditedCents: 10000 }, 'paid', 0],
    [{ status: 'paid', totalGrossCents: 12300, paidCents: 0, creditedCents: 0 }, 'posted', 12300],
    [{ status: 'draft', totalGrossCents: 12300, paidCents: 0, creditedCents: 0 }, 'draft', 12300],
  ])('recomputes %j → %s', (state, status, outstanding) => {
    expect(recomputeReceivable(state)).toMatchObject({ status, outstandingCents: outstanding })
  })

  it('derives payment status from the unallocated amount', () => {
    const base = { status: 'matched', billAccountId: 'a', amountCents: 10000 }
    expect(paymentStatusFor({ ...base, unallocatedCents: 10000 })).toBe('matched')
    expect(paymentStatusFor({ ...base, unallocatedCents: 4000 })).toBe('partially_allocated')
    expect(paymentStatusFor({ ...base, unallocatedCents: 0 })).toBe('allocated')
    expect(paymentStatusFor({ ...base, billAccountId: null, unallocatedCents: 10000 })).toBe('unmatched')
    expect(paymentStatusFor({ ...base, status: 'ignored', unallocatedCents: 10000 })).toBe('ignored')
    expect(paymentStatusFor({ ...base, status: 'converted_to_topup', unallocatedCents: 0 })).toBe('converted_to_topup')
  })
})

// ─── DB service with an in-memory SQL fake ───────────────────────

type Invoice = {
  id: string
  bill_account_id: string
  currency_code: string
  status: string
  document_type: string
  test_run: boolean
  total_gross: string
  outstanding: string
  paid_total: string
  credited_total: string
  due_date: string | null
  issue_date: string | null
  number: string
}
type Payment = { id: string; bill_account_id: string | null; currency_code: string; amount: string; unallocated_amount: string; status: string; received_at: string; created_at: string }
type Allocation = { id: string; source_type: string; source_id: string; invoice_id: string; amount: string; deleted_at: Date | null }

function fakeDb(state: { invoices: Invoice[]; payments: Payment[] }) {
  const allocations: Allocation[] = []
  let seq = 0
  const cents = (v: unknown) => Math.round(Number.parseFloat(String(v)) * 100)
  const execute = jest.fn(async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.startsWith('SELECT id, bill_account_id, currency_code, status, document_type')) {
      return state.invoices.filter((i) => i.id === p[0]).map((i) => ({ ...i }))
    }
    if (s.startsWith('SELECT id, bill_account_id, currency_code, unallocated_amount AS unallocated')) {
      return state.payments.filter((x) => x.id === p[0]).map((x) => ({ ...x, unallocated: x.unallocated_amount }))
    }
    if (s.startsWith('SELECT id, bill_account_id, currency_code, outstanding AS unallocated')) {
      return state.invoices.filter((i) => i.id === p[0] && i.document_type === 'credit_memo').map((i) => ({ ...i, unallocated: i.outstanding }))
    }
    if (s.startsWith('UPDATE billing_invoices SET outstanding = outstanding -')) {
      const memo = state.invoices.find((i) => i.id === p[2])
      if (!memo || cents(memo.outstanding) < cents(p[0])) return []
      const left = cents(memo.outstanding) - cents(p[0])
      memo.outstanding = (left / 100).toFixed(4)
      memo.status = left <= 0 ? 'paid' : 'posted'
      return [{ id: memo.id }]
    }
    if (s.startsWith('UPDATE billing_invoices SET outstanding = LEAST')) {
      const memo = state.invoices.find((i) => i.id === p[1])!
      memo.outstanding = (Math.min(cents(memo.total_gross), cents(memo.outstanding) + cents(p[0])) / 100).toFixed(4)
      memo.status = 'posted'
      return [{ id: memo.id }]
    }
    if (s.startsWith('UPDATE billing_payments SET unallocated_amount = unallocated_amount -')) {
      const pay = state.payments.find((x) => x.id === p[1])
      if (!pay || cents(pay.unallocated_amount) < cents(p[0])) return []
      pay.unallocated_amount = ((cents(pay.unallocated_amount) - cents(p[0])) / 100).toFixed(4)
      return [{ id: pay.id }]
    }
    if (s.startsWith('UPDATE billing_payments SET unallocated_amount = LEAST')) {
      const pay = state.payments.find((x) => x.id === p[1])!
      pay.unallocated_amount = (Math.min(cents(pay.amount), cents(pay.unallocated_amount) + cents(p[0])) / 100).toFixed(4)
      return [{ id: pay.id }]
    }
    if (s.startsWith('UPDATE billing_payments SET status = CASE')) {
      const pay = state.payments.find((x) => x.id === p[0])!
      const u = cents(pay.unallocated_amount)
      pay.status = u <= 0 ? 'allocated' : u < cents(pay.amount) ? 'partially_allocated' : 'matched'
      return []
    }
    if (s.startsWith('SELECT COALESCE(SUM(amount) FILTER')) {
      const active = allocations.filter((a) => a.invoice_id === p[0] && !a.deleted_at)
      const sum = (type: string) => active.filter((a) => a.source_type === type).reduce((t, a) => t + cents(a.amount), 0) / 100
      return [{ paid: String(sum('payment')), credited: String(sum('credit_memo')) }]
    }
    if (s.startsWith('UPDATE billing_invoices SET paid_total')) {
      const inv = state.invoices.find((i) => i.id === p[4])!
      Object.assign(inv, { paid_total: p[0], credited_total: p[1], outstanding: p[2], status: p[3] })
      return []
    }
    if (s.startsWith('UPDATE billing_allocations SET deleted_at')) {
      const a = allocations.find((x) => x.id === p[1] && !x.deleted_at)
      if (!a) return []
      a.deleted_at = new Date()
      return [a]
    }
    if (s.startsWith('SELECT id, outstanding, due_date, issue_date, number')) {
      return state.invoices.filter(
        (i) =>
          i.bill_account_id === p[2] &&
          i.currency_code === p[3] &&
          ['posted', 'partially_paid'].includes(i.status) &&
          ['invoice', 'debit_memo'].includes(i.document_type) &&
          cents(i.outstanding) > 0,
      )
    }
    if (s.startsWith("SELECT 'payment' AS source_type")) {
      return state.payments
        .filter((x) => x.bill_account_id === p[2] && x.currency_code === p[3] && ['matched', 'partially_allocated'].includes(x.status) && cents(x.unallocated_amount) > 0)
        .sort((a, b) => (a.received_at < b.received_at ? -1 : 1))
        .map((x) => ({ source_type: 'payment', id: x.id, available: x.unallocated_amount }))
    }
    throw new Error(`unexpected SQL: ${s.slice(0, 80)}`)
  })
  const em = {
    execute,
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => {
      const row = { id: `alloc-${++seq}`, ...data }
      allocations.push({
        id: row.id,
        source_type: String(data.sourceType),
        source_id: String(data.sourceId),
        invoice_id: String(data.invoiceId),
        amount: String(data.amount),
        deleted_at: null,
      })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em, allocations }
}

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: 'inv-1',
    bill_account_id: 'acc-1',
    currency_code: 'PLN',
    status: 'posted',
    document_type: 'invoice',
    test_run: false,
    total_gross: '123.0000',
    outstanding: '123.0000',
    paid_total: '0',
    credited_total: '0',
    due_date: '2026-11-28',
    issue_date: '2026-11-14',
    number: 'INV/2026/11/0001',
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: 'pay-1',
    bill_account_id: 'acc-1',
    currency_code: 'PLN',
    amount: '200.0000',
    unallocated_amount: '200.0000',
    status: 'matched',
    received_at: '2026-11-20',
    created_at: '2026-11-20T10:00:00Z',
    ...overrides,
  }
}

describe('allocation — DB service', () => {
  it('allocates part of a payment: invoice partially paid, payment partially allocated', async () => {
    const state = { invoices: [invoice({})], payments: [payment({})] }
    const { em } = fakeDb(state)
    const effects = await allocate(em as never, scope, {
      source: { type: 'payment', id: 'pay-1' },
      invoiceId: 'inv-1',
      amountCents: 5000,
      by: 'user',
    })
    expect(state.invoices[0]).toMatchObject({ status: 'partially_paid', outstanding: '73.0000', paid_total: '50.0000' })
    expect(state.payments[0]).toMatchObject({ unallocated_amount: '150.0000', status: 'partially_allocated' })
    expect(effects.invoiceStatusChanges).toEqual([{ invoiceId: 'inv-1', from: 'posted', to: 'partially_paid' }])
  })

  it('refuses over-allocation, other accounts, other currencies and settled invoices', async () => {
    const make = (inv: Partial<Invoice>, pay: Partial<Payment> = {}) =>
      fakeDb({ invoices: [invoice(inv)], payments: [payment(pay)] }).em
    const call = (em: unknown, amountCents = 1000) =>
      allocate(em as never, scope, { source: { type: 'payment', id: 'pay-1' }, invoiceId: 'inv-1', amountCents, by: 'user' })
    await expect(call(make({}), 20000)).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.allocation.exceeds_outstanding' }) })
    await expect(call(make({ bill_account_id: 'acc-2' }))).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.allocation.account_mismatch' }) })
    await expect(call(make({ currency_code: 'EUR' }))).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.allocation.currency_mismatch' }) })
    await expect(call(make({ status: 'paid', outstanding: '0' }))).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.allocation.invoice_not_open' }) })
    await expect(call(make({}, { unallocated_amount: '5.0000' }))).rejects.toMatchObject({ body: expect.objectContaining({ code: 'billing.allocation.insufficient_unallocated' }) })
  })

  it('un-allocates: restores the payment and reopens the invoice', async () => {
    const state = { invoices: [invoice({})], payments: [payment({})] }
    const { em } = fakeDb(state)
    const created = await allocate(em as never, scope, { source: { type: 'payment', id: 'pay-1' }, invoiceId: 'inv-1', amountCents: 12300, by: 'user' })
    expect(state.invoices[0].status).toBe('paid')
    const effects = await unallocate(em as never, scope, { allocationId: created.created[0].allocationId })
    expect(state.invoices[0]).toMatchObject({ status: 'posted', outstanding: '123.0000' })
    expect(state.payments[0]).toMatchObject({ unallocated_amount: '200.0000', status: 'matched' })
    expect(effects.removed).toHaveLength(1)
    await expect(unallocate(em as never, scope, { allocationId: created.created[0].allocationId })).rejects.toMatchObject({ status: 404 })
  })

  it('applies account credit to the oldest due invoices first, oldest payment first', async () => {
    const state = {
      invoices: [
        invoice({ id: 'late', due_date: '2026-12-28', number: 'INV/2' }),
        invoice({ id: 'early', due_date: '2026-11-28', number: 'INV/1' }),
      ],
      payments: [payment({ id: 'p-new', received_at: '2026-11-25', amount: '100.0000', unallocated_amount: '100.0000' }), payment({ id: 'p-old', received_at: '2026-11-20', amount: '50.0000', unallocated_amount: '50.0000' })],
    }
    const { em, allocations } = fakeDb(state)
    await applyAccountCredit(em as never, scope, { id: 'acc-1', currencyCode: 'PLN' })
    expect(allocations.map((a) => [a.source_id, a.invoice_id, a.amount])).toEqual([
      ['p-old', 'early', '50.0000'],
      ['p-new', 'early', '73.0000'],
      ['p-new', 'late', '27.0000'],
    ])
    expect(state.invoices.find((i) => i.id === 'early')!.status).toBe('paid')
    expect(state.invoices.find((i) => i.id === 'late')!.outstanding).toBe('96.0000')
  })

  it('withAccountLock takes a per-account advisory lock inside a transaction', async () => {
    const tem = { execute: jest.fn(async () => []) }
    const em = { transactional: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tem)) }
    const result = await withAccountLock(em as never, { tenantId: 't-1', billAccountId: 'acc-1' }, async () => 'done')
    expect(result).toBe('done')
    expect(tem.execute).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [accountLockKey({ tenantId: 't-1', billAccountId: 'acc-1' })])
  })

  it('credit memo source (Spec D): full credit marks the original credited and the memo settled; un-allocate reverts', async () => {
    const memo = invoice({ id: 'cm-1', document_type: 'credit_memo', number: 'CN/1', total_gross: '123.0000', outstanding: '123.0000' })
    const state = { invoices: [invoice({}), memo], payments: [] as Payment[] }
    const { em } = fakeDb(state)
    const effects = await allocate(em as never, scope, { source: { type: 'credit_memo', id: 'cm-1' }, invoiceId: 'inv-1', amountCents: 12300, by: 'credit' })
    expect(state.invoices[0]).toMatchObject({ status: 'credited', outstanding: '0.0000', credited_total: '123.0000', paid_total: '0.0000' })
    expect(memo).toMatchObject({ status: 'paid', outstanding: '0.0000' })
    expect(effects.invoiceStatusChanges).toEqual([{ invoiceId: 'inv-1', from: 'posted', to: 'credited' }])
    await unallocate(em as never, scope, { allocationId: effects.created[0].allocationId })
    expect(state.invoices[0]).toMatchObject({ status: 'posted', outstanding: '123.0000' })
    expect(memo).toMatchObject({ status: 'posted', outstanding: '123.0000' })
  })

  it('partial credit plus a payment settles the invoice as paid (not credited)', async () => {
    const memo = invoice({ id: 'cm-1', document_type: 'credit_memo', number: 'CN/1', total_gross: '23.0000', outstanding: '23.0000' })
    const state = { invoices: [invoice({}), memo], payments: [payment({ amount: '100.0000', unallocated_amount: '100.0000' })] }
    const { em } = fakeDb(state)
    await allocate(em as never, scope, { source: { type: 'credit_memo', id: 'cm-1' }, invoiceId: 'inv-1', amountCents: 2300, by: 'credit' })
    expect(state.invoices[0]).toMatchObject({ status: 'partially_paid', outstanding: '100.0000' })
    await allocate(em as never, scope, { source: { type: 'payment', id: 'pay-1' }, invoiceId: 'inv-1', amountCents: 10000, by: 'user' })
    expect(state.invoices[0]).toMatchObject({ status: 'paid', outstanding: '0.0000', paid_total: '100.0000', credited_total: '23.0000' })
  })
})

