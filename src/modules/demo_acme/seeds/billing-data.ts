import type { BillingSettingsUpdateInput } from '@dainamite/billing/modules/billing/data/validators'

/**
 * ACME (primary tenant) billing demo data — a replay of a hand-made demo
 * session, captured 2026-11-18. Pure data + date helpers, no I/O; the
 * executor in `./billing.ts` replays it through the billing commands.
 *
 * Dates are written as (day-of-month, month offset) relative to the month
 * the seed runs in (the original session ran in 2026-11 = offset 0), so the
 * demo always looks current while every cycle day stays aligned.
 */

export type AcmeDay = { day: number; month?: number }

/** UTC midnight of `day` in the anchor month shifted by `month` months. */
export function acmeDate(anchor: Date, at: AcmeDay): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + (at.month ?? 0), at.day))
}

/** Billing settings of the ACME organization (logo attachment intentionally omitted). */
export const ACME_BILLING_SETTINGS: Omit<BillingSettingsUpdateInput, 'tenantId' | 'organizationId'> = {
  legalName: 'ACME',
  sellerAddress: { line1: '123 Boulevard of Broken Dreams', city: 'San Francisco', postal_code: '90210', country: 'US' },
  taxId: '123-123-1234',
  bankName: 'Gringotts Bank',
  iban: 'US70021000021123456789',
  bic: 'CHASUS33',
  defaultPaymentTermsDays: 14,
  defaultTaxRate: 10,
  statementEnabled: true,
  topupTaxRate: 0,
  topupProvider: 'stripe',
  prepaidTaxPoint: 'topup',
  numberMasks: {
    invoice: 'INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:6}',
    receipt: 'RC/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:6}',
    credit_memo: 'CN/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:6}',
  },
}

export type AcmeItem = {
  ref: string
  type: 'recurring' | 'one_time' | 'usage'
  description: string
  rateJson: Record<string, unknown>
  taxRate: number
  start: AcmeDay
  uomCode?: string
}

export type AcmeUsage = { ref: string; uomCode: string; quantity: number; from: AcmeDay; to: AcmeDay }

/**
 * One step of the replay, in the order the original session ran them.
 * `run` triggers a Bill Run scoped to the account; `postDrafts` posts the
 * drafts that run produced; `topUp` is a manual prepaid balance adjustment.
 */
export type AcmeStep =
  | { kind: 'items'; refs: string[] }
  | { kind: 'usage'; refs: string[] }
  | { kind: 'run'; asOf: AcmeDay; post: boolean }
  | { kind: 'topUp'; amount: number; ref: string }

export type AcmeAccount = {
  key: string
  /** The account comes from the CPQ order activation, not from this seed. */
  fromCpq?: boolean
  /** Display name of the core example customer the account belongs to. */
  customerName: string
  customerKind: 'company' | 'person'
  currencyCode: string
  billingMode: 'postpaid' | 'prepaid'
  billCycleDay: string
  nextBillDate: AcmeDay
  /** `null` → `billing+<customerId>@invalid.local`, the CPQ connector's shell address. */
  invoiceEmail: string | null
  invoiceAddress: { line1: string; city: string; postal_code: string; country: string }
  items: AcmeItem[]
  usage: AcmeUsage[]
  steps: AcmeStep[]
}

const SRC = 'demo-acme'
const TOKENS = 'mln_token_usage'

export const ACME_ACCOUNTS: AcmeAccount[] = [
  {
    // Bought via CPQ: the account and its two items are created by the
    // CPQ → billing connector when the seeded order is activated (see
    // `cpq.ts`), so this entry only replays the billing side.
    key: 'brightside',
    fromCpq: true,
    customerName: 'Brightside Solar',
    customerKind: 'company',
    currencyCode: 'USD',
    billingMode: 'postpaid',
    billCycleDay: '18',
    nextBillDate: { day: 18 },
    invoiceEmail: null,
    invoiceAddress: { line1: 'TBD', city: 'TBD', postal_code: 'TBD', country: 'XX' },
    items: [],
    usage: [],
    steps: [{ kind: 'run', asOf: { day: 18 }, post: true }],
  },
  {
    key: 'copperleaf',
    customerName: 'Copperleaf Design Co.',
    customerKind: 'company',
    currencyCode: 'USD',
    billingMode: 'postpaid',
    billCycleDay: '5',
    nextBillDate: { day: 5, month: 1 },
    invoiceEmail: 'studio@copperleaf.design',
    invoiceAddress: { line1: '1101 E 6th St Suite 220', city: 'Austin', postal_code: '78702', country: 'US' },
    items: [
      { ref: `${SRC}-cl-rec`, type: 'recurring', description: 'Managed Services', rateJson: { unit_price: 2500 }, taxRate: 10, start: { day: 5 } },
    ],
    usage: [],
    steps: [
      { kind: 'items', refs: [`${SRC}-cl-rec`] },
      // Catch-up: one invoice with this month's back period + next month in advance.
      { kind: 'run', asOf: { day: 5, month: 1 }, post: true },
    ],
  },
  {
    key: 'harborview',
    customerName: 'Harborview Analytics',
    customerKind: 'company',
    currencyCode: 'EUR',
    billingMode: 'postpaid',
    billCycleDay: '5',
    nextBillDate: { day: 5 },
    invoiceEmail: 'info@harborviewanalytics.com',
    invoiceAddress: { line1: '355 Atlantic Ave Floor 6', city: 'Boston', postal_code: '02210', country: 'US' },
    items: [
      { ref: `${SRC}-hv-rec`, type: 'recurring', description: 'Managed Services Fee', rateJson: { unit_price: 2500 }, taxRate: 10, start: { day: 5 } },
      { ref: `${SRC}-hv-usg`, type: 'usage', description: 'API Usage', rateJson: { unit_price: 0.56 }, taxRate: 10, start: { day: 5 }, uomCode: TOKENS },
    ],
    usage: [
      { ref: `${SRC}-hv-u1`, uomCode: TOKENS, quantity: 24, from: { day: 1 }, to: { day: 8 } },
      { ref: `${SRC}-hv-u2`, uomCode: TOKENS, quantity: 54, from: { day: 8 }, to: { day: 15 } },
      { ref: `${SRC}-hv-u3`, uomCode: TOKENS, quantity: 145, from: { day: 15 }, to: { day: 22 } },
      { ref: `${SRC}-hv-u4`, uomCode: TOKENS, quantity: 456, from: { day: 22 }, to: { day: 29 } },
    ],
    steps: [
      { kind: 'items', refs: [`${SRC}-hv-rec`, `${SRC}-hv-usg`] },
      { kind: 'usage', refs: [`${SRC}-hv-u1`, `${SRC}-hv-u2`, `${SRC}-hv-u3`, `${SRC}-hv-u4`] },
      // Both runs leave drafts (not posted) to show the draft review flow.
      { kind: 'run', asOf: { day: 5 }, post: false },
      { kind: 'run', asOf: { day: 5, month: 1 }, post: false },
    ],
  },
  {
    // Prepaid B2C: top-ups, usage debited on ingest, monthly statements.
    key: 'lena',
    customerName: 'Lena Ortiz',
    customerKind: 'person',
    currencyCode: 'EUR',
    billingMode: 'prepaid',
    billCycleDay: '10',
    nextBillDate: { day: 10 },
    invoiceEmail: 'lena.ortiz@harborviewanalytics.com',
    invoiceAddress: { line1: 'Test Prepaid', city: 'Prepaidopolis', postal_code: '123-123', country: 'PL' },
    items: [
      { ref: `${SRC}-lo-usg`, type: 'usage', description: 'API Usage', rateJson: { unit_price: 0.82 }, taxRate: 10, start: { day: 10 }, uomCode: TOKENS },
      { ref: `${SRC}-lo-rec`, type: 'recurring', description: 'Subscription Fee', rateJson: { unit_price: 150 }, taxRate: 10, start: { day: 10 } },
    ],
    usage: [
      { ref: `${SRC}-lo-u1`, uomCode: TOKENS, quantity: 140, from: { day: 10 }, to: { day: 17 } },
      { ref: `${SRC}-lo-u2`, uomCode: TOKENS, quantity: 74, from: { day: 17 }, to: { day: 24 } },
      { ref: `${SRC}-lo-u3`, uomCode: TOKENS, quantity: 123, from: { day: 24 }, to: { day: 1, month: 1 } },
    ],
    steps: [
      { kind: 'items', refs: [`${SRC}-lo-usg`] },
      { kind: 'topUp', amount: 120, ref: `${SRC}-lo-t1` },
      { kind: 'usage', refs: [`${SRC}-lo-u1`] },
      { kind: 'topUp', amount: 1200, ref: `${SRC}-lo-t2` },
      { kind: 'usage', refs: [`${SRC}-lo-u2`, `${SRC}-lo-u3`] },
      { kind: 'items', refs: [`${SRC}-lo-rec`] },
      { kind: 'run', asOf: { day: 10 }, post: false },
      { kind: 'run', asOf: { day: 10, month: 1 }, post: false },
    ],
  },
]

/**
 * Bank statement uploaded after the postpaid invoices are posted. `{brightside}`
 * / `{copperleaf}` resolve to that account's first posted invoice; amounts
 * marked `gross` / `halfGross` resolve to its total. Shows every matcher
 * outcome: exact match, partial payment, unmatched (no reference / other
 * currency) and a duplicate line.
 */
export type AcmePaymentRow = {
  amount: number | { gross: string } | { halfGross: string }
  currency: string
  reference: string
  payerName: string
  payerAccount?: string
  /** Assigned manually to this account after the import (was unmatched). */
  assignTo?: string
}

export const ACME_PAYMENT_ROWS: AcmePaymentRow[] = [
  { amount: { gross: 'brightside' }, currency: 'USD', reference: 'Payment for {brightside}', payerName: 'Brightside Solar' },
  { amount: { halfGross: 'copperleaf' }, currency: 'USD', reference: '{copperleaf} part 1', payerName: 'Copperleaf Design Co.' },
  { amount: 25, currency: 'USD', reference: 'Thank you', payerName: 'Brightside Solar', payerAccount: 'PL61109010140000071219812874', assignTo: 'brightside' },
  { amount: 12.34, currency: 'PLN', reference: 'misc transfer', payerName: 'Unknown payer' },
  { amount: { gross: 'brightside' }, currency: 'EUR', reference: '{brightside}', payerName: 'Brightside Solar' },
  { amount: 10, currency: 'USD', reference: 'Duplicate line', payerName: 'Brightside Solar', assignTo: 'brightside' },
  { amount: 10, currency: 'USD', reference: 'Duplicate line', payerName: 'Brightside Solar', assignTo: 'brightside' },
]

export const ACME_PAYMENT_FILE_NAME = 'payments-sample.csv'

/** Posted invoice per account key, as the CSV builder needs it. */
export type PostedInvoiceRef = { number: string; totalGross: string }

function toCents(value: string): number {
  return Math.round(Number(value) * 100)
}

/**
 * Pure: render the payment CSV. Rows whose invoice is missing (the account
 * was skipped) are dropped, so the import never references a phantom number.
 */
export function buildAcmePaymentsCsv(
  header: string,
  receivedAt: string,
  posted: Record<string, PostedInvoiceRef | undefined>,
): { content: string; rows: AcmePaymentRow[] } {
  const rows: AcmePaymentRow[] = []
  const lines: string[] = [header]
  for (const row of ACME_PAYMENT_ROWS) {
    const refs = [...row.reference.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    const amountKey = typeof row.amount === 'number' ? null : 'gross' in row.amount ? row.amount.gross : row.amount.halfGross
    const keys = amountKey ? [...refs, amountKey] : refs
    if (keys.some((key) => !posted[key])) continue
    const reference = row.reference.replace(/\{(\w+)\}/g, (_, key: string) => posted[key]!.number)
    let cents: number
    if (typeof row.amount === 'number') cents = Math.round(row.amount * 100)
    else if ('gross' in row.amount) cents = toCents(posted[row.amount.gross]!.totalGross)
    else cents = Math.round(toCents(posted[row.amount.halfGross]!.totalGross) / 2)
    lines.push([receivedAt, (cents / 100).toFixed(2), row.currency, reference, row.payerName, row.payerAccount ?? ''].join(','))
    rows.push({ ...row, reference })
  }
  return { content: `${lines.join('\n')}\n`, rows }
}
