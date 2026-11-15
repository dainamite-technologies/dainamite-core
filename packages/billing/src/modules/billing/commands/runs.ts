import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingRun, BillingRunOutcome } from '../data/entities'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  billingRunDeleteSchema,
  billingRunPostDraftsSchema,
  type BillingRunPostDraftsInput,
  billingRunRetryFailedSchema,
  billingRunTriggerSchema,
  type BillingRunDeleteInput,
  type BillingRunRetryFailedInput,
  type BillingRunTriggerInput,
} from '../data/validators'
import { emitBillingEvent } from '../events'
import { runBillRun } from '../lib/billRunEngine'
import { deleteTestRunArtifacts } from '../lib/testRunCleanup'
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
    const parentRun = await em.findOne(BillingRun, {
      id: parsed.billRunId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!parentRun) {
      throw new CrudHttpError(404, { error: 'Parent Bill Run not found' })
    }
    const failedOutcomes = await em.find(BillingRunOutcome, {
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

// ─── Delete (Spec F, F-D1) ───────────────────────────────────────
//
// Test and dry runs are scratch data: deleting one removes its test
// invoices (with lines and draft-edit audit rows), its outcomes and the run
// row, in one transaction. Real runs are the audit trail and are refused.
// Retry children keep existing; their parent link is cleared. Not undoable,
// like the test-invoice wipe.

type DeleteRunResult = { ok: true; invoicesRemoved: number }

export function runMode(run: Pick<BillingRun, 'dryRun' | 'testMode'>): 'real' | 'test' | 'dry' {
  if (run.dryRun) return 'dry'
  if (run.testMode) return 'test'
  return 'real'
}

const deleteRunCommand: CommandHandler<BillingRunDeleteInput, DeleteRunResult> = {
  id: 'billing.runs.delete',

  async execute(rawInput, ctx) {
    const parsed = billingRunDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const outcome = await em.transactional(async (tem) => {
      const run = await tem.findOne(BillingRun, {
        id: parsed.billRunId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      })
      // 404 for another organization's run too (no existence leak).
      if (!run) throw new CrudHttpError(404, { error: 'Bill Run not found', code: 'billing.run.not_found' })
      const mode = runMode(run)
      if (mode === 'real') {
        throw new CrudHttpError(422, {
          error: 'Real Bill Runs cannot be deleted',
          code: 'billing.run.delete_real_forbidden',
        })
      }
      if (run.status === 'running') {
        throw new CrudHttpError(409, { error: 'The Bill Run is still running', code: 'billing.run.running' })
      }
      const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
      const invoicesRemoved = await deleteTestRunArtifacts(tem as EntityManager, { ...scope, billRunId: run.id })
      await tem.execute(
        'UPDATE billing_runs SET parent_run_id = NULL WHERE tenant_id = ? AND organization_id = ? AND parent_run_id = ?',
        [scope.tenantId, scope.organizationId, run.id],
      )
      await tem.execute(
        'DELETE FROM billing_run_outcomes WHERE tenant_id = ? AND organization_id = ? AND bill_run_id = ?',
        [scope.tenantId, scope.organizationId, run.id],
      )
      await tem.execute('DELETE FROM billing_runs WHERE tenant_id = ? AND organization_id = ? AND id = ?', [
        scope.tenantId,
        scope.organizationId,
        run.id,
      ])
      return { mode, invoicesRemoved }
    })

    // After commit: subscribers never see a phantom delete.
    await emitBillingEvent(
      'billing.run.deleted',
      {
        billRunId: parsed.billRunId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        mode: outcome.mode,
        invoicesRemoved: outcome.invoicesRemoved,
      },
      { persistent: true },
    )
    return { ok: true, invoicesRemoved: outcome.invoicesRemoved }
  },
}

// ─── Post the run's drafts ──────────────────────────────────────
//
// Posts the draft invoices a REAL run wrote, in bounded batches (ascending
// id, keyset cursor) so a run with thousands of invoices never becomes one
// long request. Each invoice goes through `billing.invoices.post` on its own
// — numbering, frozen PDF, due date, credit auto-apply, auto-send and events
// stay exactly as for a single post — so one failure never undoes the
// others. A seller-settings failure would fail every invoice, so the batch
// stops at the first one and says so.

export const POST_DRAFTS_DEFAULT_LIMIT = 25

type PostDraftsFailure = { invoiceId: string; number: string; error: string; code: string | null }

export type PostDraftsResult = {
  posted: number
  failed: PostDraftsFailure[]
  /** Last invoice id handled — pass back as `afterInvoiceId`. Null when nothing was processed. */
  nextCursor: string | null
  /** Drafts of the run after the cursor that are still to process. */
  remaining: number
  /** Set when the batch stopped early (e.g. `billing.settings.incomplete`). */
  stoppedReason: string | null
}

const DRAFTS_AFTER_SQL = `SELECT id, number FROM billing_invoices
  WHERE tenant_id = ? AND organization_id = ? AND bill_run_id = ?
    AND status = 'draft' AND test_run = false AND document_type = 'invoice' AND deleted_at IS NULL
    AND (?::uuid IS NULL OR id > ?::uuid)
  ORDER BY id
  LIMIT ?`

const DRAFTS_REMAINING_SQL = `SELECT COUNT(*)::int AS remaining FROM billing_invoices
  WHERE tenant_id = ? AND organization_id = ? AND bill_run_id = ?
    AND status = 'draft' AND test_run = false AND document_type = 'invoice' AND deleted_at IS NULL
    AND (?::uuid IS NULL OR id > ?::uuid)`

const postDraftsCommand: CommandHandler<BillingRunPostDraftsInput, PostDraftsResult> = {
  id: 'billing.runs.post_drafts',

  async execute(rawInput, ctx) {
    const parsed = billingRunPostDraftsSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const run = await em.findOne(BillingRun, {
      id: parsed.billRunId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!run) throw new CrudHttpError(404, { error: 'Bill Run not found', code: 'billing.run.not_found' })
    if (runMode(run) !== 'real') {
      throw new CrudHttpError(422, { error: 'Only real Bill Runs have invoices to post', code: 'billing.run.not_real' })
    }
    if (run.status === 'running') {
      throw new CrudHttpError(409, { error: 'The Bill Run is still running', code: 'billing.run.running' })
    }

    const scope = [parsed.tenantId, parsed.organizationId, run.id] as const
    const cursor = parsed.afterInvoiceId ?? null
    const limit = parsed.limit ?? POST_DRAFTS_DEFAULT_LIMIT
    const drafts = (await em.execute(DRAFTS_AFTER_SQL, [...scope, cursor, cursor, limit])) as unknown as Array<{
      id: string
      number: string
    }>

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const failed: PostDraftsFailure[] = []
    let posted = 0
    let nextCursor: string | null = null
    let stoppedReason: string | null = null
    for (const draft of drafts ?? []) {
      nextCursor = draft.id
      try {
        await commandBus.execute('billing.invoices.post', {
          input: { tenantId: parsed.tenantId, organizationId: parsed.organizationId, invoiceId: draft.id },
          ctx,
        })
        posted += 1
      } catch (err) {
        const body = isCrudHttpError(err) ? (err.body as { error?: string; code?: string }) : null
        const code = body?.code ?? null
        failed.push({
          invoiceId: draft.id,
          number: draft.number,
          error: body?.error ?? (err instanceof Error ? err.message : String(err)),
          code,
        })
        if (code === 'billing.settings.incomplete') {
          // Every other draft would fail the same way — stop. The returned
          // cursor stays where this call started; drafts posted in this call
          // are no longer drafts, so a retry after fixing the settings picks
          // up exactly the ones still pending.
          stoppedReason = code
          break
        }
      }
    }

    const remainingRows = (await em.execute(DRAFTS_REMAINING_SQL, [
      ...scope,
      stoppedReason ? cursor : nextCursor,
      stoppedReason ? cursor : nextCursor,
    ])) as unknown as Array<{ remaining: number }>
    return {
      posted,
      failed,
      nextCursor: stoppedReason ? cursor : nextCursor,
      remaining: Number(remainingRows?.[0]?.remaining ?? 0),
      stoppedReason,
    }
  },
}

registerCommand(triggerRunCommand)
registerCommand(retryFailedCommand)
registerCommand(deleteRunCommand)
registerCommand(postDraftsCommand)

export { triggerRunCommand, retryFailedCommand, deleteRunCommand, postDraftsCommand }
