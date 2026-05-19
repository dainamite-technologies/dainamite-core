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
import { BillingAccount } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import {
  billingAccountCreateSchema,
  billingAccountDeleteSchema,
  billingAccountUpdateSchema,
  type BillingAccountCreateInput,
  type BillingAccountDeleteInput,
  type BillingAccountUpdateInput,
} from '../data/validators'

/**
 * BillingAccount writes — create / update / soft-delete.
 *
 * Phase 1 keeps the command surface lean — no undo / snapshot / audit
 * log. Phase 4 (admin UI + posting flow) revisits to add operator-driven
 * undo. The patterns to add:
 *   - `prepare`: capture BEFORE snapshot for update / delete
 *   - `captureAfter`: capture AFTER snapshot
 *   - `buildLog`: emit a structured audit log entry
 *   - `undo`: restore from snapshots + reverse side effects
 * See `node_modules/@open-mercato/core/src/modules/customers/commands/people.ts`
 * for the canonical full-feature shape.
 */

const accountIndexer = { entityType: billingEntityIds.account } as const
const accountEvents = { module: 'billing', entity: 'account', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

// ─── Create ──────────────────────────────────────────────────────

const createAccountCommand: CommandHandler<BillingAccountCreateInput, { id: string }> = {
  id: 'billing.accounts.create',

  async execute(rawInput, ctx) {
    const parsed = billingAccountCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const now = new Date()
    const entity = em.create(BillingAccount, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      customerId: parsed.customerId,
      name: parsed.name,
      currencyCode: parsed.currencyCode,
      billCycle: parsed.billCycle,
      billCycleAnchor: parsed.billCycleAnchor,
      invoiceEmail: parsed.invoiceEmail,
      invoiceLanguage: parsed.invoiceLanguage,
      taxId: parsed.taxId ?? null,
      invoiceAddress: parsed.invoiceAddress as Record<string, unknown>,
      nextBillDate: parsed.nextBillDate,
      lastBillDate: parsed.lastBillDate ?? null,
      isActive: parsed.isActive ?? true,
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
      indexer: accountIndexer,
      events: accountEvents,
    })

    return { id: entity.id }
  },
}

// ─── Update ──────────────────────────────────────────────────────

const updateAccountCommand: CommandHandler<BillingAccountUpdateInput, { id: string }> = {
  id: 'billing.accounts.update',

  async execute(rawInput, ctx) {
    const parsed = billingAccountUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const record = await em.findOne(BillingAccount, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing account not found' })
    }

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.billCycle !== undefined) record.billCycle = parsed.billCycle
    if (parsed.billCycleAnchor !== undefined) record.billCycleAnchor = parsed.billCycleAnchor
    if (parsed.invoiceEmail !== undefined) record.invoiceEmail = parsed.invoiceEmail
    if (parsed.invoiceLanguage !== undefined) record.invoiceLanguage = parsed.invoiceLanguage
    if (parsed.taxId !== undefined) record.taxId = parsed.taxId
    if (parsed.invoiceAddress !== undefined) {
      record.invoiceAddress = parsed.invoiceAddress as Record<string, unknown>
    }
    if (parsed.nextBillDate !== undefined) record.nextBillDate = parsed.nextBillDate
    if (parsed.lastBillDate !== undefined) record.lastBillDate = parsed.lastBillDate
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
      indexer: accountIndexer,
      events: accountEvents,
    })

    return { id: record.id }
  },
}

// ─── Delete (soft) ───────────────────────────────────────────────

const deleteAccountCommand: CommandHandler<BillingAccountDeleteInput, { id: string }> = {
  id: 'billing.accounts.delete',

  async execute(rawInput, ctx) {
    const parsed = billingAccountDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const id = requireId(parsed)

    const em = getEm(ctx)
    const record = await em.findOne(BillingAccount, {
      id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Billing account not found' })
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
      indexer: accountIndexer,
      events: accountEvents,
    })

    return { id: record.id }
  },
}

registerCommand(createAccountCommand)
registerCommand(updateAccountCommand)
registerCommand(deleteAccountCommand)

export {
  createAccountCommand,
  updateAccountCommand,
  deleteAccountCommand,
}
