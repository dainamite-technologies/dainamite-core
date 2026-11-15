import { buildPaymentsSampleCsv } from '../../lib/seeds/paymentsSample'
import { parsePaymentCsv } from '../../lib/paymentCsv'
import { matchPayment, type MatchableDocument } from '../../lib/paymentMatcher'

const invoices = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: `INV/2026/11/000${n}`,
  totalGross: `${n * 100}.0000`,
  currencyCode: 'PLN',
  accountName: n % 2 ? 'Northwind, Ltd' : 'Globex',
}))
const receipt = { number: 'RC/2026/11/0001', currencyCode: 'PLN', accountName: 'Prepaid Co' }

describe('buildPaymentsSampleCsv', () => {
  it('produces a parseable CSV covering every outcome', () => {
    const sample = buildPaymentsSampleCsv({ invoices, receipt, date: '2026-11-20' })
    expect(sample.missing).toEqual([])
    const parsed = parsePaymentCsv(sample.csv)
    expect(parsed.fatal).toBeNull()
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(10)
    expect(parsed.rows.map((r) => r.amount)).toEqual(
      expect.arrayContaining(['100.0000', '100.0000', '350.0000', '1000.0000', '25.0000', '12.3400']),
    )
    // Payer names with commas are quoted.
    expect(sample.csv).toContain('"Northwind, Ltd"')

    const lookup = new Map<string, MatchableDocument>(
      [
        ...invoices.map((inv, i) => ({
          invoiceId: `i${i}`,
          number: inv.number,
          billAccountId: inv.accountName,
          billingMode: 'postpaid',
          currencyCode: 'PLN',
          documentType: 'invoice',
          status: 'posted',
          outstanding: inv.totalGross,
        })),
        { invoiceId: 'r', number: receipt.number, billAccountId: 'prepaid', billingMode: 'prepaid', currencyCode: 'PLN', documentType: 'receipt', status: 'paid', outstanding: '0' },
      ].map((doc) => [doc.number.toUpperCase(), doc]),
    )
    const outcomes = parsed.rows.map((row) => {
      const decision = matchPayment({ reference: row.reference, currency: row.currency }, lookup)
      return decision.outcome === 'allocate' ? 'allocate' : decision.reason
    })
    expect(outcomes).toEqual([
      'allocate',
      'allocate',
      'allocate',
      'allocate', // two invoices of one account (4 and 6)
      'no_reference',
      'prepaid_account',
      'no_reference',
      'currency_mismatch',
      'no_reference',
      'no_reference',
    ])
  })

  it('reports what it could not build with few invoices', () => {
    const sample = buildPaymentsSampleCsv({ invoices: invoices.slice(0, 1), receipt: null, date: '2026-11-20' })
    expect(sample.missing.length).toBeGreaterThanOrEqual(3)
    expect(parsePaymentCsv(sample.csv).errors).toEqual([])
  })

  it('adds a row paying a posted debit memo by its number (Spec D)', () => {
    const debitMemo = { number: 'INV/2026/11/0099', totalGross: '12.3000', currencyCode: 'PLN', accountName: 'Globex' }
    const sample = buildPaymentsSampleCsv({ invoices, receipt, debitMemo, date: '2026-11-20' })
    const parsed = parsePaymentCsv(sample.csv)
    expect(parsed.rows.some((r) => r.reference === 'Note INV/2026/11/0099' && r.amount === '12.3000')).toBe(true)
  })
})

