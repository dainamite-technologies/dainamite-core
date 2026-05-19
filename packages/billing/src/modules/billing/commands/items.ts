import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import {
  emitCrudSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BillingAccount, BillingItem } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import { findBySourceRef } from '../lib/idempotency'
import {
  billingItemCreateSchema,
  billingItemDeleteSchema,
  billingItemUpdateSchema,
  validateRateJson,
  type BillingItemCreateInput,
  type BillingItemDeleteInput,
  type BillingItemUpdateInput,
} from '../data/validators'

/**
 * BillingItem writes — create / update / soft-delete.
 *
 * Create is idempotent via `source_ref`: if the integrator POSTs the
 * same `(tenant_id, bill_account_id, source_ref)` twice, the second
 * call returns the existing item with `deduplicated: true`. The
 * underlying unique index is the correctness gate; this pre-check keeps
 * the happy path single-round-trip and the response body informative.
 */

const itemIndexer = { entityType: billingEntityIds.item } as const
const itemEvents = { module: 'billing', entity: 'item', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

async function assertAccountInScope(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; billAccountId: string },
): Promise<BillingAccount> {
  const account = await em.findOne(BillingAccount, {
    id: params.billAccountId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
  if (!account) {
    throw new CrudHttpError(404, { error: 'Billing account not found' })
  }
  return account
}

// ─── Create (idempotent) ─────────────────────────────────────────

const createItemCommand: CommandHandler<
  BillingItemCreateInput,
  { id: string; deduplicated: boolean }
> = {
  id: 'billing.items.create',

  async execute(rawInput, ctx) {
    const parsed = billingItemCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const account = await assertAccountInScope(em, parsed)

    // Idempotency: if `source_ref` provided and matches an existing
    // (non-deleted) row, return that row. The unique index is the
    // final correctness gate — this is the happy-path early return.
    if (parsed.sourceRef) {
      const existing = await findBySourceRef(em, BillingItem, {
        tenantId: parsed.tenantId,
        billAccountId: parsed.billAccountId,
        sourceRef: parsed.sourceRef,
      })
      if (existing) {
        return { id: existing.id, deduplicated: true }
      }
    }

    // Re-validate the rate_json shape against the resolved type to
    // future-proof against schema drift between the API surface and
    // the persistence layer.
    validateRateJson(parsed.type, parsed.rateJson)

    const now = new Date()
    const entity = em.create(BillingItem, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      billAccountId: account.id,
      type: parsed.type,
      billStartDate: parsed.billStartDate,
      billEndDate: parsed.billEndDate ?? null,
      description: parsed.description,
      rateJson: parsed.rateJson as Record<string, unknown>,
      uomCode: parsed.uomCode ?? null,
      subscriptionId: parsed.subscriptionId ?? null,
      subscriptionItemId: parsed.subscriptionItemId ?? null,
      sourceRef: parsed.sourceRef ?? null,
      // `currency_mismatch` is set by Phase 2 / connectors when the
      // posted value's currency differs from the account's. Stays
      // false on create (operator opts in to flagging).
      currencyMismatch: false,
      // `billed_to_date` is set by the Bill Run engine on the first
      // real-run that emits this item. Always null on create.
      billedToDate: null,
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
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: entity.id, deduplicated: false }
  },
}

// ─── Update ──────────────────────────────────────────────────────

const updateItemCommand: CommandHandler<BillingItemUpdateInput, { id: string }> = {
  id: 'billing.items.update',

  async execute(rawInput, ctx) {
    const parsed = billingItemUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const record = await em.findOne(BillingItem, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing item not found' })
    }

    if (parsed.billStartDate !== undefined) record.billStartDate = parsed.billStartDate
    if (parsed.billEndDate !== undefined) record.billEndDate = parsed.billEndDate
    if (parsed.description !== undefined) record.description = parsed.description
    if (parsed.rateJson !== undefined) {
      // Re-validate against the current (immutable) type before persist.
      validateRateJson(record.type as 'one_time' | 'recurring' | 'usage', parsed.rateJson)
      record.rateJson = parsed.rateJson as Record<string, unknown>
    }
    if (parsed.uomCode !== undefined) record.uomCode = parsed.uomCode
    if (parsed.subscriptionId !== undefined) record.subscriptionId = parsed.subscriptionId
    if (parsed.subscriptionItemId !== undefined) {
      record.subscriptionItemId = parsed.subscriptionItemId
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    record.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: record.id }
  },
}

// ─── Delete (soft) ───────────────────────────────────────────────

const deleteItemCommand: CommandHandler<BillingItemDeleteInput, { id: string }> = {
  id: 'billing.items.delete',

  async execute(rawInput, ctx) {
    const parsed = billingItemDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const id = requireId(parsed)

    const em = getEm(ctx)
    const record = await em.findOne(BillingItem, {
      id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing item not found' })
    }

    record.deletedAt = new Date()
    record.updatedAt = record.deletedAt
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      indexer: itemIndexer,
      events: itemEvents,
    })

    return { id: record.id }
  },
}

registerCommand(createItemCommand)
registerCommand(updateItemCommand)
registerCommand(deleteItemCommand)

export { createItemCommand, updateItemCommand, deleteItemCommand }
