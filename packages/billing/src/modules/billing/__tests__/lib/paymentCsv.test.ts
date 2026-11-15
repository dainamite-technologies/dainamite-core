import { parsePaymentCsv, paymentSourceRef, sourceRefsForRows, splitCsv } from '../../lib/paymentCsv'
import { extractInvoiceTokens, matchPayment, type MatchableDocument } from '../../lib/paymentMatcher'

const HEADER = 'date,amount,currency,reference,payer_name,payer_account'
const scope = { tenantId: 't-1', organizationId: 'o-1' }

describe('splitCsv', () => {
  it('handles quotes, escaped quotes, commas and newlines inside quotes, CRLF', () => {
    const records = splitCsv('a,"b, c","d ""q"""\r\n1,"multi\nline",3\n')
    expect(records).toEqual([
      { line: 1, fields: ['a', 'b, c', 'd "q"'] },
      { line: 2, fields: ['1', 'multi\nline', '3'] },
    ])
  })
})

describe('parsePaymentCsv', () => {
  it('parses valid rows (BOM, case-insensitive header, normalised amount / currency / IBAN)', () => {
    const result = parsePaymentCsv(
      `﻿Date,Amount,Currency,Reference,Payer_Name,Payer_Account\n2026-11-20,123,pln,"Payment for INV/2026/11/0003",ACME,pl61 1090 1014\n`,
    )
    expect(result.fatal).toBeNull()
    expect(result.rows).toEqual([
      {
        line: 2,
        receivedAt: '2026-11-20',
        amount: '123.0000',
        currency: 'PLN',
        reference: 'Payment for INV/2026/11/0003',
        payerName: 'ACME',
        payerAccount: 'PL6110901014',
      },
    ])
  })

  it('reports invalid rows with line numbers and keeps the valid ones', () => {
    const result = parsePaymentCsv(
      [HEADER, '2026-11-20,0,PLN,x,,', '20.11.2026,10,PLN,x,,', '2026-11-20,10,PLN,x', '2026-11-20,1,000.50,PLN,x,,', '2026-11-21,10.5,EUR,,,'].join('\n'),
    )
    expect(result.rows.map((r) => r.line)).toEqual([6])
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5])
    expect(result.errors[0].message).toContain('greater than 0')
  })

  it('rejects a wrong header or an empty file as fatal', () => {
    expect(parsePaymentCsv('').fatal).toBeTruthy()
    expect(parsePaymentCsv('date;amount\n').fatal).toContain('header')
  })

  it('caps the file at 5,000 rows', () => {
    const rows = Array.from({ length: 5001 }, () => '2026-11-20,1,PLN,x,,')
    expect(parsePaymentCsv([HEADER, ...rows].join('\n')).fatal).toContain('5000')
  })
})

describe('source refs (duplicate guard)', () => {
  const row = { receivedAt: '2026-11-20', amount: '10.0000', currency: 'PLN', reference: 'x', payerAccount: null }

  it('is stable for the same line and differs per occurrence within a file', () => {
    expect(paymentSourceRef(scope, row, 1)).toBe(paymentSourceRef(scope, row, 1))
    expect(paymentSourceRef(scope, row, 1)).not.toBe(paymentSourceRef(scope, row, 2))
    const rows = [row, row, { ...row, amount: '11.0000' }].map((r, i) => ({ ...r, line: i + 2, payerName: null }))
    const refs = sourceRefsForRows(scope, rows)
    expect(new Set(refs).size).toBe(3)
    expect(refs[0]).toBe(paymentSourceRef(scope, row, 1))
    expect(refs[1]).toBe(paymentSourceRef(scope, row, 2))
  })

  it('is scoped per organization', () => {
    expect(paymentSourceRef(scope, row, 1)).not.toBe(paymentSourceRef({ ...scope, organizationId: 'o-2' }, row, 1))
  })
})

describe('extractInvoiceTokens', () => {
  it('extracts number-like tokens, upper-cased, without trailing punctuation', () => {
    expect(extractInvoiceTokens('Payment for inv/2026/11/0003, INV/2026/11/0004.')).toEqual(['INV/2026/11/0003', 'INV/2026/11/0004'])
    expect(extractInvoiceTokens('thanks for the service')).toEqual([])
    expect(extractInvoiceTokens(null)).toEqual([])
  })
})

describe('matchPayment', () => {
  const doc = (overrides: Partial<MatchableDocument>): MatchableDocument => ({
    invoiceId: 'i-1',
    number: 'INV/2026/11/0001',
    billAccountId: 'acc-1',
    billingMode: 'postpaid',
    currencyCode: 'PLN',
    documentType: 'invoice',
    status: 'posted',
    outstanding: '123.0000',
    ...overrides,
  })
  const lookup = (...docs: MatchableDocument[]) => new Map(docs.map((d) => [d.number.toUpperCase(), d]))

  it('allocates to referenced open invoices of one account', () => {
    const a = doc({})
    const b = doc({ invoiceId: 'i-2', number: 'INV/2026/11/0002' })
    expect(matchPayment({ reference: 'INV/2026/11/0001 + INV/2026/11/0002', currency: 'pln' }, lookup(a, b))).toEqual({
      outcome: 'allocate',
      billAccountId: 'acc-1',
      invoiceIds: ['i-1', 'i-2'],
    })
  })

  it('no reference / unknown number → unmatched(no_reference)', () => {
    expect(matchPayment({ reference: 'gift', currency: 'PLN' }, lookup(doc({})))).toMatchObject({ outcome: 'unmatched', reason: 'no_reference' })
    expect(matchPayment({ reference: 'INV/9', currency: 'PLN' }, lookup(doc({})))).toMatchObject({ reason: 'no_reference' })
  })

  it('references to two different accounts are ambiguous → unmatched', () => {
    const other = doc({ invoiceId: 'i-9', number: 'INV/9/1', billAccountId: 'acc-2' })
    expect(matchPayment({ reference: 'INV/2026/11/0001 INV/9/1', currency: 'PLN' }, lookup(doc({}), other))).toMatchObject({
      outcome: 'unmatched',
      reason: 'no_reference',
      billAccountId: null,
    })
  })

  it('prepaid accounts and top-up receipts → unmatched(prepaid_account) with the account kept', () => {
    expect(matchPayment({ reference: 'INV/2026/11/0001', currency: 'PLN' }, lookup(doc({ billingMode: 'prepaid' })))).toEqual({
      outcome: 'unmatched',
      billAccountId: 'acc-1',
      reason: 'prepaid_account',
    })
    expect(matchPayment({ reference: 'RC/2026/11/0001', currency: 'PLN' }, lookup(doc({ number: 'RC/2026/11/0001', documentType: 'receipt', status: 'paid' })))).toMatchObject({
      reason: 'prepaid_account',
    })
  })

  it('currency mismatch → unmatched(currency_mismatch)', () => {
    expect(matchPayment({ reference: 'INV/2026/11/0001', currency: 'EUR' }, lookup(doc({})))).toMatchObject({ reason: 'currency_mismatch' })
  })

  it('already paid invoice → account credit', () => {
    expect(matchPayment({ reference: 'INV/2026/11/0001', currency: 'PLN' }, lookup(doc({ status: 'paid', outstanding: '0' })))).toEqual({
      outcome: 'credit',
      billAccountId: 'acc-1',
      reason: 'invoice_already_paid',
    })
  })

  it('debit memos are matchable receivables', () => {
    expect(matchPayment({ reference: 'INV/2026/11/0009', currency: 'PLN' }, lookup(doc({ number: 'INV/2026/11/0009', documentType: 'debit_memo' })))).toMatchObject({
      outcome: 'allocate',
    })
  })
})
