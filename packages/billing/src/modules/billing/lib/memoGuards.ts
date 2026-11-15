import type { EntityManager } from '@mikro-orm/postgresql'
import { toCents } from './allocation'

/**
 * Credit memo guard (Spec D, P-D4). Pure core + one aggregate query.
 *
 *   Σ gross of posted credit memos on the original (incl. the new one)
 *     ≤ original gross + Σ gross of posted debit memos on it
 *
 * Evaluated inside the per-account lock at post (authoritative) and,
 * without the lock, when a draft memo is created (early feedback).
 */

export type CorrectionTotals = { creditCents: number; debitCents: number }

export function creditHeadroomCents(originalGrossCents: number, totals: CorrectionTotals): number {
  return originalGrossCents + totals.debitCents - totals.creditCents
}

export function creditFits(originalGrossCents: number, totals: CorrectionTotals, newCreditCents: number): boolean {
  return newCreditCents <= creditHeadroomCents(originalGrossCents, totals)
}

/** Σ gross of POSTED (non-draft) memos correcting an invoice, per type. */
export async function loadCorrectionTotals(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  originalId: string,
  opts: { excludeId?: string } = {},
): Promise<CorrectionTotals> {
  const rows = (await em.execute(
    `SELECT document_type, COALESCE(SUM(total_gross), 0) AS gross
       FROM billing_invoices
      WHERE corrects_invoice_id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL
        AND status <> 'draft' AND test_run = false AND id <> ?
      GROUP BY document_type`,
    [originalId, scope.tenantId, scope.organizationId, opts.excludeId ?? '00000000-0000-0000-0000-000000000000'],
  )) as unknown as Array<{ document_type: string; gross: string }>
  const of = (type: string) => toCents(rows?.find((r) => r.document_type === type)?.gross ?? '0')
  return { creditCents: of('credit_memo'), debitCents: of('debit_memo') }
}
