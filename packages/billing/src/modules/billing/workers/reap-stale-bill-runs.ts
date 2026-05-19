import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BillRun } from '../data/entities'

export const metadata: WorkerMeta = {
  queue: 'billing-reap-stale-runs',
  id: 'billing:reap-stale-bill-runs',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Reaper for "zombie" Bill Runs left in `status='running'` after a crash.
 *
 * Background — the Bill Run engine acquires a per-tenant Postgres
 * transaction-scoped advisory lock (`pg_try_advisory_xact_lock`). When the
 * holding transaction ends (commit / rollback / process death) the lock is
 * released automatically — so there is no lock leak — but the `BillRun`
 * row's `status='running'` stays set forever, blocking restarts and
 * confusing the dashboard.
 *
 * Phase 0 ships this as the **registered worker shell** so the module's
 * worker auto-discovery includes it from day one. The active-advisory-lock
 * check (which is what distinguishes a real zombie from a healthy
 * long-running run) lands with the Bill Run engine itself in Phase 2.
 *
 * For now the heuristic is time-only: any `running` row older than 1 hour
 * is marked failed with an explanatory message. That is conservative —
 * real runs almost never take an hour even for 500k-account tenants
 * (see spec Performance Considerations).
 */
const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS)
  const stale = await em.find(BillRun, {
    status: 'running',
    startedAt: { $lt: threshold },
  } as any)
  if (stale.length === 0) return
  const now = new Date()
  for (const run of stale) {
    run.status = 'failed'
    run.finishedAt = now
    const summary = (run.summary ?? {}) as Record<string, unknown>
    summary.reaper_message =
      'Stale running run reaped after crash; advisory lock released'
    summary.reaped_at = now.toISOString()
    run.summary = summary
  }
  await em.flush()
}
