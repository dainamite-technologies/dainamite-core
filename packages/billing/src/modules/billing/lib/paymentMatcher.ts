/**
 * Payment auto-matcher (Spec C, C-D1) — pure.
 *
 * Matching uses ONLY invoice numbers found in the payment reference:
 *   1. `extractInvoiceTokens` pulls number-like tokens out of the title;
 *   2. the import looks up all tokens of the whole file in one query and
 *      passes the hits as a map (upper-cased number → document);
 *   3. `matchPayment` decides per row.
 *
 * Exact, full-number, case-insensitive matches only (false positives are
 * worse than misses; every auto allocation is un-allocatable anyway).
 */

export type MatchableDocument = {
  invoiceId: string
  number: string
  billAccountId: string
  billingMode: string
  currencyCode: string
  documentType: string
  status: string
  outstanding: string
}

export type MatchDecision =
  | {
      outcome: 'allocate'
      billAccountId: string
      /** Referenced open receivables, in the order they appear in the title. */
      invoiceIds: string[]
    }
  | {
      /** Account known but nothing referenced is open → the amount becomes credit. */
      outcome: 'credit'
      billAccountId: string
      reason: 'invoice_already_paid'
    }
  | {
      outcome: 'unmatched'
      billAccountId: string | null
      reason: 'no_reference' | 'currency_mismatch' | 'prepaid_account'
    }

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9/_.\-]{1,62}[A-Za-z0-9]/g

/** Number-like tokens of a payment title, upper-cased, de-duplicated, in order. */
export function extractInvoiceTokens(reference: string | null | undefined): string[] {
  if (!reference) return []
  const tokens: string[] = []
  for (const match of reference.matchAll(TOKEN_RE)) {
    const token = match[0].toUpperCase()
    // A number needs at least one digit; plain words are never invoice numbers.
    if (!/\d/.test(token)) continue
    if (!tokens.includes(token)) tokens.push(token)
  }
  return tokens
}

const OPEN = ['posted', 'partially_paid']
const RECEIVABLE = ['invoice', 'debit_memo']

export function matchPayment(
  payment: { reference: string | null; currency: string },
  documentsByNumber: ReadonlyMap<string, MatchableDocument>,
): MatchDecision {
  const hits = extractInvoiceTokens(payment.reference)
    .map((token) => documentsByNumber.get(token))
    .filter((doc): doc is MatchableDocument => Boolean(doc))
  if (hits.length === 0) return { outcome: 'unmatched', billAccountId: null, reason: 'no_reference' }

  const accounts = new Set(hits.map((doc) => doc.billAccountId))
  // References to several customers are ambiguous — the operator decides.
  if (accounts.size > 1) return { outcome: 'unmatched', billAccountId: null, reason: 'no_reference' }
  const billAccountId = hits[0].billAccountId

  // Prepaid accounts (or their top-up receipts): never allocated (C-D3).
  if (hits.some((doc) => doc.billingMode === 'prepaid' || doc.documentType === 'receipt')) {
    return { outcome: 'unmatched', billAccountId, reason: 'prepaid_account' }
  }
  if (hits.some((doc) => doc.currencyCode !== payment.currency.toUpperCase())) {
    return { outcome: 'unmatched', billAccountId, reason: 'currency_mismatch' }
  }
  const open = hits.filter(
    (doc) => RECEIVABLE.includes(doc.documentType) && OPEN.includes(doc.status) && Number.parseFloat(doc.outstanding) > 0,
  )
  if (open.length === 0) return { outcome: 'credit', billAccountId, reason: 'invoice_already_paid' }
  return { outcome: 'allocate', billAccountId, invoiceIds: open.map((doc) => doc.invoiceId) }
}
