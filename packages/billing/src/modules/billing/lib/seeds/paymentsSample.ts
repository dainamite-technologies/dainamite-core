import type { EntityManager } from '@mikro-orm/postgresql'
import { PAYMENT_CSV_HEADER } from '../paymentCsv'

/**
 * Demo bank statement (Spec C): a `payments-sample.csv` built from the
 * organization's real posted invoices, so numbers and amounts line up and
 * every matcher outcome shows up after one upload:
 *
 *   exact amount + number            → allocated, invoice paid
 *   half the amount                  → invoice partially paid
 *   amount + 50                      → paid, 50 credit applied to the next open invoice
 *   two numbers, sum of both         → both paid
 *   no reference, known payer        → unmatched → assign to account
 *   a top-up receipt number          → unmatched (prepaid) → convert to top-up
 *   junk title                       → unmatched (no reference)
 *   other currency                   → unmatched (currency mismatch)
 *   the same line twice              → both stored (occurrence index); re-upload = duplicates
 *
 * Pure builder + a loader for the CLI (`mercato billing payments-sample`).
 */

export type SampleInvoice = {
  number: string
  totalGross: string
  currencyCode: string
  accountName: string
}

export type SampleReceipt = { number: string; currencyCode: string; accountName: string }

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function money(value: number): string {
  return value.toFixed(2)
}

export function buildPaymentsSampleCsv(params: {
  invoices: SampleInvoice[]
  receipt?: SampleReceipt | null
  /** Spec D: a posted debit memo — paid by its own number like an invoice. */
  debitMemo?: SampleInvoice | null
  date: string
}): { csv: string; rows: number; missing: string[] } {
  const { invoices, receipt, date, debitMemo } = params
  const rows: string[][] = []
  const missing: string[] = []
  const gross = (inv: SampleInvoice) => Number.parseFloat(inv.totalGross)
  const [a, b, c] = invoices
  // Two invoices of the SAME account (references to two customers are ambiguous).
  const rest = invoices.slice(3)
  let d: SampleInvoice | undefined
  let e: SampleInvoice | undefined
  for (let i = 0; i < rest.length && !d; i += 1) {
    const match = rest.slice(i + 1).find((other) => other.accountName === rest[i].accountName && other.currencyCode === rest[i].currencyCode)
    if (match) {
      d = rest[i]
      e = match
    }
  }

  if (a) rows.push([date, money(gross(a)), a.currencyCode, `Payment for ${a.number}`, a.accountName, ''])
  else missing.push('exact payment (needs 1 posted invoice)')
  if (b) rows.push([date, money(gross(b) / 2), b.currencyCode, `${b.number} part 1`, b.accountName, ''])
  else missing.push('partial payment (needs 2 posted invoices)')
  if (c) rows.push([date, money(gross(c) + 50), c.currencyCode, `Invoice ${c.number} + advance`, c.accountName, ''])
  else missing.push('overpayment (needs 3 posted invoices)')
  if (d && e) rows.push([date, money(gross(d) + gross(e)), d.currencyCode, `${d.number}, ${e.number}`, d.accountName, ''])
  else missing.push('two invoices in one title (needs two more posted invoices of one account)')
  if (a) rows.push([date, '25.00', a.currencyCode, 'Thank you', a.accountName, 'PL61109010140000071219812874'])
  if (receipt) rows.push([date, '100.00', receipt.currencyCode, `Top-up ${receipt.number}`, receipt.accountName, ''])
  else missing.push('prepaid top-up (needs a prepaid top-up receipt)')
  if (debitMemo) {
    rows.push([date, money(gross(debitMemo)), debitMemo.currencyCode, `Note ${debitMemo.number}`, debitMemo.accountName, ''])
  }
  rows.push([date, '12.34', 'PLN', 'misc transfer', 'Unknown payer', ''])
  if (a) {
    const other = a.currencyCode === 'EUR' ? 'PLN' : 'EUR'
    rows.push([date, money(gross(a)), other, a.number, a.accountName, ''])
    const dup = [date, '10.00', a.currencyCode, 'Duplicate line', a.accountName, '']
    rows.push(dup, [...dup])
  }
  const csv = [PAYMENT_CSV_HEADER.join(','), ...rows.map((row) => row.map(csvField).join(','))].join('\n') + '\n'
  return { csv, rows: rows.length, missing }
}

/** Posted, unpaid invoices of the org (oldest first) and one top-up receipt. */
export async function loadSampleSources(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<{ invoices: SampleInvoice[]; receipt: SampleReceipt | null; debitMemo: SampleInvoice | null }> {
  const invoices = (await em.execute(
    `SELECT i.number, i.total_gross, i.currency_code, a.name AS account_name
       FROM billing_invoices i
       JOIN billing_accounts a ON a.id = i.bill_account_id
      WHERE i.tenant_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL AND i.test_run = false
        AND i.document_type = 'invoice' AND i.status = 'posted' AND a.billing_mode = 'postpaid'
      ORDER BY i.issue_date ASC, i.number ASC
      LIMIT 20`,
    [scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ number: string; total_gross: string; currency_code: string; account_name: string }>
  const receipts = (await em.execute(
    `SELECT i.number, i.currency_code, a.name AS account_name
       FROM billing_invoices i
       JOIN billing_accounts a ON a.id = i.bill_account_id
      WHERE i.tenant_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL AND i.document_type = 'receipt'
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ number: string; currency_code: string; account_name: string }>
  const debits = (await em.execute(
    `SELECT i.number, i.total_gross, i.currency_code, a.name AS account_name
       FROM billing_invoices i
       JOIN billing_accounts a ON a.id = i.bill_account_id
      WHERE i.tenant_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL AND i.test_run = false
        AND i.document_type = 'debit_memo' AND i.status = 'posted'
      ORDER BY i.issue_date ASC
      LIMIT 1`,
    [scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ number: string; total_gross: string; currency_code: string; account_name: string }>
  return {
    debitMemo: debits?.[0]
      ? { number: debits[0].number, totalGross: debits[0].total_gross, currencyCode: debits[0].currency_code, accountName: debits[0].account_name }
      : null,
    invoices: (invoices ?? []).map((row) => ({
      number: row.number,
      totalGross: row.total_gross,
      currencyCode: row.currency_code,
      accountName: row.account_name,
    })),
    receipt: receipts?.[0]
      ? { number: receipts[0].number, currencyCode: receipts[0].currency_code, accountName: receipts[0].account_name }
      : null,
  }
}
