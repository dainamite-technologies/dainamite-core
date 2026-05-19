import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Per-tenant Postgres transaction-scoped advisory lock primitive.
 *
 * The Bill Run engine (Phase 2) uses this to guarantee at most one
 * concurrently-running run per tenant — the spec requires this so two
 * cron triggers or a "schedule" + "manual" overlap cannot produce
 * duplicate drafts.
 *
 * Why advisory locks (not row locks):
 *   - `pg_try_advisory_xact_lock` is non-blocking — we get a clean "busy"
 *     signal instead of waiting on a row.
 *   - It's released automatically when the transaction ends (commit,
 *     rollback, or process death) — so there is no lock-leak path even
 *     on `kill -9`. The `BillRun` row's `status='running'` may be left
 *     hanging, but the lock itself vanishes; the reaper worker
 *     (workers/reap-stale-bill-runs.ts) handles the orphaned row.
 *   - It works without a sentinel table — we hash a string key into the
 *     bigint key space the advisory-lock API requires.
 *
 * Usage:
 *
 * ```ts
 * import { withTenantLock, TenantLockBusyError } from '../lib/tenantLock'
 *
 * try {
 *   await withTenantLock(em, { tenantId, lockName: 'billing-run' }, async (tem) => {
 *     // tem is the transactional EntityManager; lock is held here.
 *     // Returns to caller after function resolves and tx commits.
 *   })
 * } catch (err) {
 *   if (err instanceof TenantLockBusyError) {
 *     // HTTP 409 — another run is in progress.
 *   }
 *   throw err
 * }
 * ```
 *
 * Keep work inside the callback short. The advisory lock is released only
 * when the transaction ends; long-running work blocks other triggers for
 * the whole tenant.
 */

export class TenantLockBusyError extends Error {
  readonly tenantId: string
  readonly lockName: string

  constructor(tenantId: string, lockName: string) {
    super(`Tenant ${tenantId} already holds the billing lock "${lockName}"`)
    this.name = 'TenantLockBusyError'
    this.tenantId = tenantId
    this.lockName = lockName
  }
}

const LOCK_KEY_PREFIX = 'dainamite-billing'

/**
 * Build the deterministic string key fed into `hashtext()`. Exposed for
 * tests so they can assert lock-key independence across tenants /
 * lockNames without scraping SQL strings.
 */
export function buildLockKey(tenantId: string, lockName: string): string {
  return `${LOCK_KEY_PREFIX}:${tenantId}:${lockName}`
}

type AdvisoryLockRow = { acquired: boolean }

export async function withTenantLock<T>(
  em: EntityManager,
  params: { tenantId: string; lockName: string },
  fn: (tem: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional(async (tem) => {
    const key = buildLockKey(params.tenantId, params.lockName)
    const rows = (await tem.execute(
      'SELECT pg_try_advisory_xact_lock(hashtext(?)::bigint) AS acquired',
      [key],
    )) as unknown as AdvisoryLockRow[] | AdvisoryLockRow | undefined
    const first: AdvisoryLockRow | undefined = Array.isArray(rows) ? rows[0] : rows
    if (!first?.acquired) {
      throw new TenantLockBusyError(params.tenantId, params.lockName)
    }
    return fn(tem)
  })
}
