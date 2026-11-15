import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Per-billing-account transaction-scoped advisory lock (Spec C, P-D3).
 *
 * Every change to an account's receivables — CSV import allocations, manual
 * allocate / un-allocate, credit auto-apply on post, gateway captures and
 * (Spec D) credit memo posts — runs inside this lock, so two of them can
 * never spend the same credit or over-allocate the same invoice.
 *
 * Unlike `tenantLock` (a non-blocking try-lock for bill runs), this one
 * BLOCKS: operations on one account simply queue up. The lock is released
 * when the transaction ends (commit, rollback or process death). Keep the
 * callback short — it holds a database transaction.
 */

export type AccountLockScope = { tenantId: string; billAccountId: string }

export function accountLockKey(scope: AccountLockScope): string {
  return `billing-ar:${scope.tenantId}:${scope.billAccountId}`
}

export async function withAccountLock<T>(
  em: EntityManager,
  scope: AccountLockScope,
  fn: (tem: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional(async (tem) => {
    await (tem as EntityManager).execute('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [accountLockKey(scope)])
    return fn(tem as EntityManager)
  })
}
