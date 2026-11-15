import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Test-run cleanup shared by the "wipe test invoices" and "delete run"
 * commands (Spec F, P-D1).
 *
 * Hard-deletes test drafts (`test_run = true`, `document_type = 'invoice'`)
 * together with their lines and their draft-edit audit rows. Scoped by
 * tenant + organization, and optionally by one Bill Run. Must run inside the
 * caller's transaction.
 */

export type TestRunCleanupScope = {
  tenantId: string
  organizationId: string
  /** When set, only test invoices written by this Bill Run are removed. */
  billRunId?: string | null
}

export async function deleteTestRunArtifacts(
  em: EntityManager,
  scope: TestRunCleanupScope,
): Promise<number> {
  const params: unknown[] = [scope.tenantId, scope.organizationId]
  let billRunClause = ''
  if (scope.billRunId) {
    billRunClause = ' AND bill_run_id = ?'
    params.push(scope.billRunId)
  }
  const rows = (await em.execute(
    `SELECT id FROM billing_invoices
     WHERE tenant_id = ? AND organization_id = ? AND test_run = true AND document_type = 'invoice'${billRunClause}`,
    params,
  )) as unknown as Array<{ id: string }> | undefined
  const ids = (rows ?? []).map((row) => row.id)
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  await em.execute(`DELETE FROM billing_draft_invoice_edits WHERE invoice_id IN (${placeholders})`, ids)
  await em.execute(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (${placeholders})`, ids)
  await em.execute(`DELETE FROM billing_invoices WHERE id IN (${placeholders})`, ids)
  return ids.length
}
