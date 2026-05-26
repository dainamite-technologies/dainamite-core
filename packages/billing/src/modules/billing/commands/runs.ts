import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillRun, BillRunOutcome } from '../data/entities'
import {
  billingRunRetryFailedSchema,
  billingRunTriggerSchema,
  type BillingRunRetryFailedInput,
  type BillingRunTriggerInput,
} from '../data/validators'
import { runBillRun } from '../lib/billRunEngine'
import { TenantLockBusyError } from '../lib/tenantLock'

/**
 * Bill Run trigger commands.
 *
 * Both commands wrap `runBillRun(...)` from `lib/billRunEngine`. The
 * lock-busy condition (concurrent run on the same tenant) is mapped to
 * HTTP 409 here so the API surface returns the canonical Conflict
 * response without each route knowing the lock primitive's
 * implementation.
 *
 * `triggeredBy` is intentionally NOT exposed on the input schema —
 * client-driven triggers are always `'manual'`. The scheduler worker
 * (Phase 4) injects `'schedule'` directly through a separate
 * orchestrator path, not through this command.
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getContainer(ctx: CommandRuntimeContext): AwilixContainer {
  return ctx.container as AwilixContainer
}

function asLockBusyError(err: unknown): err is TenantLockBusyError {
  return err instanceof TenantLockBusyError
}

// ─── Trigger ─────────────────────────────────────────────────────

type TriggerResult = {
  billRunId: string
  status: string
  outcomesCount: number
}

const triggerRunCommand: CommandHandler<BillingRunTriggerInput, TriggerResult> = {
  id: 'billing.runs.trigger',

  async execute(rawInput, ctx) {
    const parsed = billingRunTriggerSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const asOfDate = parsed.asOfDate ?? new Date()

    try {
      const { billRun, outcomes } = await runBillRun(em, getContainer(ctx), {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        asOfDate,
        triggeredBy: 'manual',
        mode: parsed.mode,
        scopedAccountIds: parsed.scopedAccountIds,
        catchUp: parsed.catchUp,
      })
      return {
        billRunId: billRun.id,
        status: billRun.status,
        outcomesCount: outcomes.length,
      }
    } catch (err) {
      if (asLockBusyError(err)) {
        // The route metadata maps `CrudHttpError(409)` to the canonical
        // 409 Conflict response. The error body carries the
        // `error_lock_busy` discriminator so clients can distinguish
        // "lock busy" from other 409 conditions.
        throw new CrudHttpError(409, {
          error: 'Another Bill Run is already in progress for this tenant',
          code: 'billing.run.lock_busy',
          tenantId: err.tenantId,
          lockName: err.lockName,
        })
      }
      throw err
    }
  },
}

// ─── Retry failed ────────────────────────────────────────────────

const retryFailedCommand: CommandHandler<BillingRunRetryFailedInput, TriggerResult> = {
  id: 'billing.runs.retry_failed',

  async execute(rawInput, ctx) {
    const parsed = billingRunRetryFailedSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const parentRun = await em.findOne(BillRun, {
      id: parsed.billRunId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!parentRun) {
      throw new CrudHttpError(404, { error: 'Parent Bill Run not found' })
    }
    const failedOutcomes = await em.find(BillRunOutcome, {
      billRunId: parentRun.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      status: 'failed',
    })
    if (failedOutcomes.length === 0) {
      throw new CrudHttpError(409, {
        error: 'Parent run has no failed outcomes to retry',
        code: 'billing.run.nothing_to_retry',
      })
    }
    const scopedAccountIds = Array.from(new Set(failedOutcomes.map((o) => o.billAccountId)))

    try {
      const { billRun, outcomes } = await runBillRun(em, getContainer(ctx), {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        asOfDate: parentRun.asOfDate,
        triggeredBy: 'manual',
        mode: parsed.mode,
        scopedAccountIds,
        parentRunId: parentRun.id,
        catchUp: parentRun.catchUp,
      })
      return {
        billRunId: billRun.id,
        status: billRun.status,
        outcomesCount: outcomes.length,
      }
    } catch (err) {
      if (asLockBusyError(err)) {
        throw new CrudHttpError(409, {
          error: 'Another Bill Run is already in progress for this tenant',
          code: 'billing.run.lock_busy',
          tenantId: err.tenantId,
          lockName: err.lockName,
        })
      }
      throw err
    }
  },
}

registerCommand(triggerRunCommand)
registerCommand(retryFailedCommand)

export { triggerRunCommand, retryFailedCommand }
