/**
 * Billing document type helpers (Spec 0 / Spec D). Pure.
 *
 *   invoice     — receivable, `invoice` series
 *   debit_memo  — receivable (supplementary invoice), `invoice` series (D-D8)
 *   credit_memo — credit source, `credit_memo` series; amounts stored positive (D-D5)
 *   receipt     — prepaid top-up receipt, `receipt` series, never corrected (D-D6)
 */

export type DocumentType = 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt'

export function isReceivable(type: string): boolean {
  return type === 'invoice' || type === 'debit_memo'
}

export function isMemo(type: string): boolean {
  return type === 'credit_memo' || type === 'debit_memo'
}

/** Numbering series of a document type. */
export function seriesFor(type: string): 'invoice' | 'credit_memo' | 'receipt' {
  if (type === 'credit_memo') return 'credit_memo'
  if (type === 'receipt') return 'receipt'
  return 'invoice'
}

/** Sign used for DISPLAY only — credit memos read as negative amounts. */
export function displaySign(type: string): 1 | -1 {
  return type === 'credit_memo' ? -1 : 1
}

/** Originals a memo may correct (D-D3): posted, partially paid, paid (credited → debit only). */
export function canCorrect(original: { documentType: string; status: string; testRun: boolean }, memoType: string): boolean {
  if (original.testRun || original.documentType !== 'invoice') return false
  if (['posted', 'partially_paid', 'paid'].includes(original.status)) return true
  return original.status === 'credited' && memoType === 'debit_memo'
}
