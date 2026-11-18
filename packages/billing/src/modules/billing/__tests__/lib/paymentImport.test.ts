jest.mock('../../lib/accountLock', () => ({
  withAccountLock: jest.fn(async (em: unknown, _scope: unknown, fn: (tem: unknown) => Promise<unknown>) => fn(em)),
}))
jest.mock('../../lib/allocation', () => {
  const actual = jest.requireActual('../../lib/allocation')
  return {
    ...actual,
    allocate: jest.fn(async () => actual.emptyEffects()),
    applyAccountCredit: jest.fn(async () => actual.emptyEffects()),
    loadOpenReceivables: jest.fn(async (_tem: unknown, _scope: unknown, _account: unknown, ids: string[]) =>
      ids.map((id: string) => ({ id, outstandingCents: 10000, dueDate: null, issueDate: null, number: id })),
    ),
  }
})

import { BillingPayment, BillingPaymentImport } from '../../data/entities'
import { allocate, applyAccountCredit } from '../../lib/allocation'
import { withAccountLock } from '../../lib/accountLock'
import { importPayments } from '../../lib/paymentImport'
import { paymentSourceRef } from '../../lib/paymentCsv'

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const HEADER = 'date,amount,currency,reference,payer_name,payer_account'

function makeEm(opts: { existingRefs?: string[]; statusCounts?: Array<{ status: string; n: number }> } = {}) {
  const created: Array<{ entity: string; data: Record<string, unknown> }> = []
  let seq = 0
  const em = {
    execute: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT source_ref')) return (opts.existingRefs ?? []).map((source_ref) => ({ source_ref }))
      if (sql.includes('upper(i.number)')) {
        return [
          { id: 'inv-1', number: 'INV/2026/11/0001', bill_account_id: 'acc-1', billing_mode: 'postpaid', currency_code: 'PLN', document_type: 'invoice', status: 'posted', outstanding: '100.0000' },
          { id: 'inv-2', number: 'INV/2026/11/0002', bill_account_id: 'acc-2', billing_mode: 'postpaid', currency_code: 'PLN', document_type: 'invoice', status: 'paid', outstanding: '0' },
        ]
      }
      if (sql.includes('GROUP BY status')) return opts.statusCounts ?? []
      return []
    }),
    create: jest.fn((entity: { name: string }, data: Record<string, unknown>) => {
      const row = { id: `${entity.name}-${++seq}`, ...data }
      created.push({ entity: entity.name, data: row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 1),
  }
  return { em, created }
}

beforeEach(() => jest.clearAllMocks())

describe('importPayments', () => {
  const csv = [
    HEADER,
    '2026-11-20,100.00,PLN,Payment INV/2026/11/0001,ACME,',
    '2026-11-21,40.00,PLN,INV/2026/11/0002 again,Globex,',
    '2026-11-22,15.00,PLN,thanks,Unknown,',
    '2026-11-23,10.00,EUR,INV/2026/11/0001,ACME,',
    '2026-11-24,-5,PLN,bad,,',
  ].join('\n')

  it('creates one payment per new row with the matcher outcome and settles per account', async () => {
    const { em, created } = makeEm({
      statusCounts: [
        { status: 'allocated', n: 1 },
        { status: 'matched', n: 1 },
        { status: 'unmatched', n: 2 },
      ],
    })
    const { summary } = await importPayments(em as never, { scope, fileName: 'bank.csv', content: csv, userId: 'u-1' })

    const payments = created.filter((c) => c.entity === BillingPayment.name).map((c) => c.data)
    expect(payments.map((p) => [p.status, p.billAccountId, p.matchReason])).toEqual([
      ['matched', 'acc-1', null],
      ['matched', 'acc-2', 'invoice_already_paid'],
      ['unmatched', null, 'no_reference'],
      ['unmatched', 'acc-1', 'currency_mismatch'],
    ])
    expect(created.find((c) => c.entity === BillingPaymentImport.name)!.data).toMatchObject({ fileName: 'bank.csv', rowCount: 5, userId: 'u-1' })

    // One lock per matched account; referenced invoice allocated, then credit for the remainder.
    expect((withAccountLock as jest.Mock).mock.calls.map((c) => c[1].billAccountId)).toEqual(['acc-1', 'acc-2'])
    expect(allocate).toHaveBeenCalledTimes(1)
    expect((allocate as jest.Mock).mock.calls[0][2]).toMatchObject({ invoiceId: 'inv-1', amountCents: 10000, by: 'auto' })
    expect(applyAccountCredit).toHaveBeenCalledTimes(2)

    expect(summary.counts).toEqual({ allocated: 1, partially_allocated: 0, matched: 1, unmatched: 2, duplicate: 0, rejected: 1 })
    expect(summary.errors).toEqual([expect.objectContaining({ row: 6 })])
  })

  it('counts already imported lines as duplicates and does not store them again', async () => {
    const line = { receivedAt: '2026-11-20', amount: '100.0000', currency: 'PLN', reference: 'Payment INV/2026/11/0001', payerAccount: null }
    const { em, created } = makeEm({ existingRefs: [paymentSourceRef(scope, line, 1)] })
    const { summary } = await importPayments(em as never, {
      scope,
      fileName: 'bank.csv',
      content: [HEADER, '2026-11-20,100.00,PLN,Payment INV/2026/11/0001,ACME,'].join('\n'),
    })
    expect(created.filter((c) => c.entity === BillingPayment.name)).toHaveLength(0)
    expect(summary.counts.duplicate).toBe(1)
    expect(withAccountLock).not.toHaveBeenCalled()
  })

  it('rejects an invalid file with 400', async () => {
    const { em } = makeEm()
    await expect(importPayments(em as never, { scope, fileName: 'x.csv', content: 'nope' })).rejects.toMatchObject({
      status: 400,
      body: expect.objectContaining({ code: 'billing.payment_import.invalid_file' }),
    })
  })
})
