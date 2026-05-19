import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * `source_ref` idempotency helper.
 *
 * The unique index on `(tenant_id, bill_account_id, source_ref)` does the
 * heavy lifting at the database level — Postgres treats NULLs as distinct,
 * so multiple NULL `source_ref` values coexist for the same account. This
 * helper checks for an existing row *before* the insert so we can return
 * it (HTTP 200 with `deduplicated: true`) instead of taking the round-trip
 * to the DB and unwinding a unique-violation.
 *
 * Why not rely solely on the unique constraint and catch the conflict?
 * Two reasons:
 *   1. Catching the conflict requires a SAVEPOINT or a separate tx —
 *      complicates error handling and rolls back the surrounding work.
 *   2. Idempotency is also a read-side guarantee: if a connector POSTs
 *      twice, the *second* call should observe what the first one
 *      persisted, not just "duplicate, sorry."
 *
 * The constraint stays in place as the *correctness* gate — if a race
 * sneaks past this check, the DB still refuses the duplicate.
 */

type SourceRefScope = {
  tenantId: string
  billAccountId: string
  sourceRef: string
  deletedAt?: null
}

type EntityCtor<T> = new (...args: never[]) => T

export async function findBySourceRef<T extends { sourceRef?: string | null }>(
  em: EntityManager,
  entity: EntityCtor<T>,
  scope: { tenantId: string; billAccountId: string; sourceRef: string },
): Promise<T | null> {
  const where: SourceRefScope = {
    tenantId: scope.tenantId,
    billAccountId: scope.billAccountId,
    sourceRef: scope.sourceRef,
    deletedAt: null,
  }
  return em.findOne(entity, where as never)
}
