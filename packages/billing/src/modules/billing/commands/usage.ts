import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BillingAccount, BillingAccountUsage } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import { findBySourceRef } from '../lib/idempotency'
import {
  billingUsageCreateSchema,
  type BillingUsageCreateInput,
} from '../data/validators'
import {
  consumePrepaidUsage,
  type PrepaidConsumeResult,
} from '../lib/prepaidConsume'
import { emitBillingEvent, type BillingEventId } from '../events'

/**
 * Usage ingest — append-only.
 *
 * Usage records are immutable once persisted. The Bill Run engine
 * (Phase 2) writes `rated_in_bill_run_id` on them but the data itself
 * never changes. There is therefore no update or delete command — if
 * an external system mis-aggregates and needs to "correct" a record,
 * they POST a compensating record (negative quantity is not allowed
 * by the validator; the connector posts a `one_time` Billing Item
 * credit instead, which is the spec's discount/refund model).
 *
 * Create is idempotent via `source_ref` — same shape as items.
 */

const usageIndexer = { entityType: billingEntityIds.usage } as const
const usageEvents = { module: 'billing', entity: 'usage', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

export type CreateUsageResult = {
  id: string
  deduplicated: boolean
  // Prepaid-only extras (SPEC-002) — present only for prepaid accounts.
  ratedAmount?: string
  currencyCode?: string
  balance?: string
  balanceStatus?: PrepaidConsumeResult['balanceStatus']
  creditStatus?: PrepaidConsumeResult['creditStatus']
  tierBreakdown?: PrepaidConsumeResult['tierBreakdown']
  warning?: string | null
}

const createUsageCommand: CommandHandler<BillingUsageCreateInput, CreateUsageResult> = {
  id: 'billing.usage.create',

  async execute(rawInput, ctx) {
    const parsed = billingUsageCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const account = await em.findOne(BillingAccount, {
      id: parsed.billAccountId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!account) {
      throw new CrudHttpError(404, { error: 'Billing account not found' })
    }

    // ─── Prepaid: rate + atomic debit + balance, all in one tx ────
    if (account.billingMode === 'prepaid') {
      return executePrepaidConsume(ctx, em, account, parsed)
    }

    if (parsed.sourceRef) {
      const existing = await findBySourceRef(em, BillingAccountUsage, {
        tenantId: parsed.tenantId,
        billAccountId: parsed.billAccountId,
        sourceRef: parsed.sourceRef,
      })
      if (existing) {
        return { id: existing.id, deduplicated: true }
      }
    }

    const now = new Date()
    const entity = em.create(BillingAccountUsage, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      billAccountId: parsed.billAccountId,
      uomCode: parsed.uomCode,
      // numeric(18,4) — MikroORM stores numeric columns as string in app
      // code. JSON arrives as number; coerce here so the persisted shape
      // matches what later reads expect.
      quantity: parsed.quantity.toFixed(4),
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      lineDescription: parsed.lineDescription ?? null,
      sourceRef: parsed.sourceRef ?? null,
      ratedInBillRunId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(entity)
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'created',
      entity,
      identifiers: {
        id: entity.id,
        tenantId: entity.tenantId,
        organizationId: entity.organizationId,
      },
      indexer: usageIndexer,
      events: usageEvents,
    })

    return { id: entity.id, deduplicated: false }
  },
}

/**
 * Prepaid consume: rate + atomic debit + balance + transaction in one DB
 * transaction, then index + emit domain events AFTER the commit.
 */
async function executePrepaidConsume(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  account: BillingAccount,
  parsed: BillingUsageCreateInput,
): Promise<CreateUsageResult> {
  const input = {
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    billAccountId: parsed.billAccountId,
    uomCode: parsed.uomCode,
    quantity: parsed.quantity,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    lineDescription: parsed.lineDescription ?? null,
    sourceRef: parsed.sourceRef ?? null,
  }

  let outcome
  try {
    outcome = await em.transactional(async (tem) =>
      consumePrepaidUsage(tem as EntityManager, account, input),
    )
  } catch (err) {
    // Concurrency: a simultaneous upload with the same sourceRef won the
    // unique-constraint race and committed first, so our tx rolled back (no
    // double-debit). Retry once on a fresh em — the dedup pre-check now finds
    // the winner's record and returns its balance_after (idempotent 200).
    if (parsed.sourceRef && err instanceof UniqueConstraintViolationException) {
      outcome = await em.fork().transactional(async (tem) =>
        consumePrepaidUsage(tem as EntityManager, account, input),
      )
    } else {
      throw err
    }
  }

  // Index the new usage record (parity with the postpaid path) — only when a
  // fresh record was actually written (a dedup hit re-reads the prior one).
  if (!outcome.result.deduplicated) {
    const usage = await em.findOne(BillingAccountUsage, {
      id: outcome.result.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (usage) {
      await emitCrudSideEffects({
        dataEngine: getDataEngine(ctx),
        action: 'created',
        entity: usage,
        identifiers: {
          id: usage.id,
          tenantId: usage.tenantId,
          organizationId: usage.organizationId,
        },
        indexer: usageIndexer,
        events: usageEvents,
      })
    }
  }

  // Domain events fire AFTER the DB commit (consistent with the post command).
  // `billing.usage.rated` fires on EVERY upload — emit it ephemerally (a live
  // signal, excluded from triggers) so the high-throughput consume path does
  // not write a queue row per call. The meaningful crossing events
  // (low/exhausted/credit) stay persistent so async consumers never miss them.
  for (const ev of outcome.events) {
    const persistent = ev.id !== 'billing.usage.rated'
    await emitBillingEvent(ev.id as BillingEventId, ev.payload, { persistent })
  }

  const r = outcome.result
  return {
    id: r.id,
    deduplicated: r.deduplicated,
    ratedAmount: r.ratedAmount,
    currencyCode: r.currencyCode,
    balance: r.balance,
    balanceStatus: r.balanceStatus,
    creditStatus: r.creditStatus,
    tierBreakdown: r.tierBreakdown,
    warning: r.warning,
  }
}

registerCommand(createUsageCommand)

export { createUsageCommand }
