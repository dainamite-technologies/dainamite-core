import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { orderSetupSaveCommandSchema, type OrderSetupSaveCommandInput } from '../data/validators'
import type {
  CpqBillingOrderSetupService,
  OrderSetupSnapshot,
} from '../services/orderSetupService'

export const ORDER_SETUP_SAVE_COMMAND_ID = 'cpq_billing_connector.order_setup.save'
export const ORDER_SETUP_RESOURCE_KIND = 'cpq_billing_connector.order_setup'

export type OrderSetupSaveResult = {
  before: OrderSetupSnapshot | null
  after: OrderSetupSnapshot
}

const snapshotSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    accountMode: z.enum(['existing', 'new']),
    billingAccountId: z.string().nullable(),
    accountOverrides: z.record(z.string(), z.unknown()),
    defaultBillStartDate: z.string().nullable(),
    lineBillStarts: z.record(z.string(), z.string()),
  })
  .passthrough()

const undoSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  before: snapshotSchema.nullable(),
  after: snapshotSchema,
})

function service(ctx: CommandRuntimeContext): CpqBillingOrderSetupService {
  return ctx.container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
}

/**
 * `cpq_billing_connector.order_setup.save` — upsert the billing setup of one
 * CPQ order. Undo puts the previous setup back (or removes the row the save
 * created); it is refused once activation applied the setup.
 */
export const saveOrderSetupCommand: CommandHandler<OrderSetupSaveCommandInput, OrderSetupSaveResult> = {
  id: ORDER_SETUP_SAVE_COMMAND_ID,
  isUndoable: true,

  async execute(rawInput, ctx) {
    const input = orderSetupSaveCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    return service(ctx).save(scope, input.orderId, input.body)
  },

  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cpq_billing_connector.audit.orderSetupSave', 'Save order billing setup'),
      resourceKind: ORDER_SETUP_RESOURCE_KIND,
      resourceId: result.after.id,
      parentResourceKind: 'cpq.order',
      parentResourceId: input.orderId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        undo: {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          before: result.before,
          after: result.after,
        },
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const parsed = undoSchema.safeParse(extractUndoPayload<unknown>(logEntry))
    if (!parsed.success) throw new Error('Invalid order billing setup undo data')
    const { tenantId, organizationId, before, after } = parsed.data
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)
    await service(ctx).restore(
      { tenantId, organizationId },
      before as OrderSetupSnapshot | null,
      after as OrderSetupSnapshot,
    )
  },
}

registerCommand(saveOrderSetupCommand)
