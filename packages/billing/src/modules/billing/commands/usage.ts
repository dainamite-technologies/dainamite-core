import type { EntityManager } from '@mikro-orm/postgresql'
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

const createUsageCommand: CommandHandler<
  BillingUsageCreateInput,
  { id: string; deduplicated: boolean }
> = {
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

registerCommand(createUsageCommand)

export { createUsageCommand }
