import crypto from 'node:crypto'

/**
 * Daily supplier cost expiry schedule (index-costs spec Q1 / Q5): one module-registered `SchedulerService` row per
 * organization, targeting the `cpq-cost-expiry` queue (worker `workers/cost-expiry.worker.ts`).
 *
 * `scheduler` is an optional peer, reached through the container with a structural type: when `schedulerService` is not
 * registered nothing is registered (the `run-cost-expiry` CLI still works).
 */

export const COST_EXPIRY_QUEUE = 'cpq-cost-expiry'
export const COST_EXPIRY_CRON = '0 6 * * *'

/** The slice of the scheduler's `ScheduleRegistration` this module uses. Deliberately has NO `isEnabled` key. */
export type CostExpiryScheduleRegistration = {
  id: string
  name: string
  description: string
  scopeType: 'organization'
  organizationId: string
  tenantId: string
  scheduleType: 'cron'
  scheduleValue: string
  timezone: 'UTC'
  targetType: 'queue'
  targetQueue: typeof COST_EXPIRY_QUEUE
  sourceType: 'module'
  sourceModule: 'cpq'
}

type SchedulerServiceLike = { register: (registration: CostExpiryScheduleRegistration) => Promise<void> }
type ContainerLike = { hasRegistration?: (name: string) => boolean; resolve: <T = unknown>(name: string) => T }

export type CostExpiryScope = { tenantId: string; organizationId: string }

/** Deterministic UUID (v5-shaped) of a string, so a re-seed upserts the same row. */
export function stableUuid(input: string): string {
  const bytes = crypto.createHash('sha256').update(input).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function costExpiryScheduleId(scope: CostExpiryScope): string {
  return stableUuid(`cpq:cost-expiry:${scope.tenantId}:${scope.organizationId}`)
}

/**
 * The registration object. `isEnabled` is omitted on purpose: `SchedulerService.register` keeps the stored value on update
 * and defaults to enabled on create, so a schedule an admin disabled stays disabled after re-seeding.
 */
export function buildCostExpiryRegistration(scope: CostExpiryScope): CostExpiryScheduleRegistration {
  return {
    id: costExpiryScheduleId(scope),
    name: 'CPQ supplier cost expiry warnings',
    description: 'Warns cost managers daily about confirmed supplier costs on open quotes that are about to expire.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'cron',
    scheduleValue: COST_EXPIRY_CRON,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: COST_EXPIRY_QUEUE,
    sourceType: 'module',
    sourceModule: 'cpq',
  }
}

/** Upserts the organization's schedule. Returns `false` when the scheduler module is not registered (nothing done). */
export async function registerCostExpirySchedule(container: ContainerLike, scope: CostExpiryScope): Promise<boolean> {
  if (typeof container.hasRegistration !== 'function' || !container.hasRegistration('schedulerService')) return false
  const scheduler = container.resolve<SchedulerServiceLike>('schedulerService')
  await scheduler.register(buildCostExpiryRegistration(scope))
  return true
}
