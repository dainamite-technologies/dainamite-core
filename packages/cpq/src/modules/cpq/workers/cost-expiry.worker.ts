import { COST_EXPIRY_QUEUE } from '../lib/costExpirySchedule'
import type { CostExpiryRunInput, CostExpiryRunResult } from '../services/costs/costExpiryService'

/**
 * `cpq-cost-expiry` worker (index-costs spec, Architecture): runs the supplier cost expiry scan for one organization.
 *
 * - The tenant scope is the scheduler's trusted envelope (root `tenantId` / `organizationId`, applied last by
 *   `buildQueueTargetPayload`). Any other scope-shaped data in the payload (`scope`, nested `payload`) is ignored.
 * - Not `schedulerSafe`: only the module-registered row (`lib/costExpirySchedule.ts`) may target this queue.
 * - Idempotent by the ledger (unique cost line + `valid_until`), so retries and double dispatches never warn twice.
 * - Missing services degrade: no `cpqCostExpiryService` in the container or a missing envelope scope is logged and the
 *   job completes (retrying cannot fix either).
 */
export const metadata = { queue: COST_EXPIRY_QUEUE, id: 'cpq:cost-expiry', concurrency: 1 }

type Job = { id?: string; payload?: Record<string, unknown> | null }
type HandlerContext = { resolve: <T = unknown>(name: string) => T }
type ExpiryService = { run: (input: CostExpiryRunInput) => Promise<CostExpiryRunResult> }

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

export default async function handle(job: Job, ctx: HandlerContext): Promise<void> {
  const tenantId = text(job.payload?.tenantId)
  const organizationId = text(job.payload?.organizationId)
  if (!tenantId || !organizationId) {
    console.warn('[cpq cost-expiry] job has no tenant / organization in its envelope, skipped', { jobId: job.id })
    return
  }
  let service: ExpiryService
  try {
    service = ctx.resolve<ExpiryService>('cpqCostExpiryService')
  } catch (error) {
    console.warn('[cpq cost-expiry] cpqCostExpiryService is not available, skipped', error)
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  const result = await service.run({ scope: { tenantId, organizationId }, today })
  console.log(`[cpq cost-expiry] tenant=${tenantId} org=${organizationId} inserted=${result.inserted} reEmitted=${result.reEmitted}${result.disabled ? ' (cost-plus off)' : ''}`)
}
