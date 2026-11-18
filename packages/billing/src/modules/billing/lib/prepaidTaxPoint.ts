import { lineVat, type PriceBasis } from './lineAmounts'
import { round2 } from './vat'

/**
 * Prepaid tax point (Spec F, F-D3 / P-D10) — how much a prepaid charge takes
 * from the balance. Shared by the Bill Run period close and real-time usage
 * consumption so the two paths can never drift apart.
 *
 *   - `topup` (default): VAT was charged on the top-up receipt, so the
 *     balance holds VAT-inclusive money and the item amount is debited as
 *     entered (`debit = net = amount`, `tax = 0`). The item's VAT rate and
 *     price basis do not apply.
 *   - `consumption`: the receipt carried no VAT; each debit is the line's
 *     gross at the item's rate and basis (`lineVat`).
 */

export type PrepaidTaxPoint = 'topup' | 'consumption'

export type PrepaidDebitInput = {
  /** Extended line amount on `priceBasis` (negative for credits). */
  lineAmount: number | string
  priceBasis: PriceBasis
  /** Item VAT rate in percent. */
  taxRate: number | string
  taxPoint: PrepaidTaxPoint
}

export type PrepaidDebit = {
  /** What leaves the balance (positive charge, negative credit back). */
  debit: number
  net: number
  tax: number
  /** VAT rate applied (0 in `topup` mode). */
  taxRate: number
}

function toNumber(value: number | string): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

export function resolvePrepaidDebit(input: PrepaidDebitInput): PrepaidDebit {
  if (input.taxPoint === 'topup') {
    const amount = round2(toNumber(input.lineAmount))
    return { debit: amount, net: amount, tax: 0, taxRate: 0 }
  }
  const rate = Math.max(0, toNumber(input.taxRate))
  const vat = lineVat({ amount: input.lineAmount, priceBasis: input.priceBasis, taxRate: rate })
  return { debit: vat.gross, net: vat.net, tax: vat.tax, taxRate: rate }
}

export type VatSummaryRow = { rate: string; net: string; tax: string; gross: string }

/**
 * Per-rate VAT summary of a set of prepaid debits (statement `vat_summary`).
 * Empty when no debit carried VAT information (`topup` mode).
 */
export function buildVatSummary(debits: ReadonlyArray<PrepaidDebit>, taxPoint: PrepaidTaxPoint): VatSummaryRow[] {
  if (taxPoint === 'topup') return []
  const byRate = new Map<number, { net: number; tax: number; gross: number }>()
  for (const debit of debits) {
    const row = byRate.get(debit.taxRate) ?? { net: 0, tax: 0, gross: 0 }
    row.net = round2(row.net + debit.net)
    row.tax = round2(row.tax + debit.tax)
    row.gross = round2(row.gross + debit.debit)
    byRate.set(debit.taxRate, row)
  }
  return Array.from(byRate.entries())
    .sort(([a], [b]) => b - a)
    .map(([rate, row]) => ({
      rate: String(rate),
      net: row.net.toFixed(4),
      tax: row.tax.toFixed(4),
      gross: row.gross.toFixed(4),
    }))
}
