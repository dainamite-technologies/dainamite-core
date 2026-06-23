import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingAccountBalance } from '../data/entities'
import { reconcileAccountBalance } from '../lib/balanceLedger'

export const metadata: WorkerMeta = {
  queue: 'billing-reconcile-prepaid-balances',
  id: 'billing:reconcile-prepaid-balances',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Reconciliation guard (SPEC-002 P5, optional).
 *
 * Periodically asserts the ledger invariant per prepaid account:
 *   `cachedBalance == SUM(transactions.amount) == latest.balance_after`.
 *
 * The atomic `UPDATE … RETURNING` + paired transaction insert keeps this true
 * by construction, so a healthy system always reconciles. This worker is a
 * cheap backstop against any future non-atomic write slipping in — it logs a
 * warning per drifted account (the operator-facing alert) and never mutates
 * the balance (a fix is a deliberate operator action, not an automatic one).
 */
const SCAN_LIMIT = 10_000

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const rows = await em.find(
    BillingAccountBalance,
    {} as never,
    { limit: SCAN_LIMIT, orderBy: { updatedAt: 'DESC' } },
  )

  let checked = 0
  let drifted = 0
  for (const row of rows) {
    const result = await reconcileAccountBalance(em.fork(), {
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      billAccountId: row.billAccountId,
    })
    checked += 1
    if (!result.reconciled) {
      drifted += 1
      console.warn('[billing/reconcile] balance drift detected', {
        billAccountId: row.billAccountId,
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        cachedBalance: result.cachedBalance,
        sumOfAmounts: result.sumOfAmounts,
        latestBalanceAfter: result.latestBalanceAfter,
      })
    }
  }

  if (rows.length === SCAN_LIMIT) {
    console.warn(
      `[billing/reconcile] scan hit the ${SCAN_LIMIT}-row cap — some accounts were not checked this run`,
    )
  }
  if (drifted > 0) {
    console.warn(`[billing/reconcile] ${drifted}/${checked} prepaid accounts drifted`)
  }
}
