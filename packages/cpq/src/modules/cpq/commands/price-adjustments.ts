import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { cpqPriceAdjustmentInputSchema, cpqPriceAdjustmentPatchSchema } from '../data/price-adjustments'
import { QuotingError } from '../services/cpqQuotingService'
import type { CpqAdjustmentService, AdjustmentWriteResult, AdjustmentSnapshot } from '../services/priceAdjustments/adjustmentService'

const id = z.string().uuid()
const createSchema = z.object({ quoteId: id, adjustment: cpqPriceAdjustmentInputSchema }).strict()
const updateSchema = z.object({ quoteId: id, adjustmentId: id, patch: cpqPriceAdjustmentPatchSchema }).strict()
const deleteSchema = z.object({ quoteId: id, adjustmentId: id, expectedRevision: z.number().int().min(0).optional() }).strict()
// Undo data is parsed independently of the original request and never trusted
// to supply actor/scope. Its target is checked again under the aggregate lock.
const snapshotSchema = z.object({
  id, quoteConfigurationId: id, quoteId: id, tenantId: id, organizationId: id,
  createdByUserId: id, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(), isActive: z.boolean(),
  level: z.enum(['charge', 'line']), quoteLineId: id, chargeCode: z.string().nullish(),
  chargeTypeFilter: z.enum(['nrc', 'mrc']).nullish(), adjustmentType: z.enum(['discount_percent', 'discount_absolute', 'price_override']),
  value: z.number(), currencyCode: z.string().nullish(), reasonCode: z.string(), reasonNote: z.string().nullish(),
})
const undoSchema = z.object({ quoteId: id, before: snapshotSchema.nullable(), after: snapshotSchema })

async function context(ctx: CommandRuntimeContext) {
  const actor = ctx.auth?.sub
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId
  if (!actor || !tenantId || !organizationId) throw new QuotingError(403, 'An authenticated tenant and organization are required')
  const scope = { tenantId, organizationId }
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  if (!(await rbac.userHasAllFeatures(actor, ['cpq.quotes.manage', 'cpq.quotes.adjust_price'], scope))) throw new QuotingError(403, 'Price adjustment permission required')
  return { actor, scope, service: ctx.container.resolve<CpqAdjustmentService>('cpqAdjustmentService') }
}

async function buildLog(quoteId: string, result: AdjustmentWriteResult) {
  const { translate } = await resolveTranslations()
  return { actionLabel: translate('cpq.priceAdjustments.audit.adjust', 'Adjust quote price'), resourceKind: 'cpq.quote_price_adjustment', resourceId: result.adjustment.id,
    tenantId: result.adjustment.tenantId, organizationId: result.adjustment.organizationId,
    snapshotBefore: result.before, snapshotAfter: result.adjustment,
    payload: { undo: { quoteId, before: result.before, after: result.adjustment } } }
}

async function undo({ logEntry, ctx }: Parameters<NonNullable<CommandHandler['undo']>>[0]) {
  const envelope = undoSchema.safeParse(extractUndoPayload<unknown>(logEntry))
  if (!envelope.success) throw new QuotingError(422, 'Invalid adjustment undo data')
  const { actor, scope, service } = await context(ctx)
  const { quoteId, before, after } = envelope.data
  await service.undo(quoteId, after.id, before as AdjustmentSnapshot | null, after as AdjustmentSnapshot, actor, scope)
}

export const createAdjustmentCommand: CommandHandler<z.infer<typeof createSchema>, AdjustmentWriteResult> = {
  id: 'cpq.quote_price_adjustment.create', isUndoable: true,
  async execute(input, ctx) {
    const parsed = createSchema.parse(input)
    const { actor, scope, service } = await context(ctx)
    return service.create(parsed.quoteId, parsed.adjustment, actor, scope)
  },
  buildLog: ({ input, result }) => buildLog(input.quoteId, result),
  undo,
}
export const updateAdjustmentCommand: CommandHandler<z.infer<typeof updateSchema>, AdjustmentWriteResult> = {
  id: 'cpq.quote_price_adjustment.update', isUndoable: true,
  async execute(input, ctx) {
    const parsed = updateSchema.parse(input)
    const { actor, scope, service } = await context(ctx)
    return service.update(parsed.quoteId, parsed.adjustmentId, parsed.patch, actor, scope)
  },
  buildLog: ({ input, result }) => buildLog(input.quoteId, result),
  undo,
}
export const deleteAdjustmentCommand: CommandHandler<z.infer<typeof deleteSchema>, AdjustmentWriteResult> = {
  id: 'cpq.quote_price_adjustment.delete', isUndoable: true,
  async execute(input, ctx) {
    const parsed = deleteSchema.parse(input)
    const { actor, scope, service } = await context(ctx)
    return service.remove(parsed.quoteId, parsed.adjustmentId, actor, scope, parsed.expectedRevision)
  },
  buildLog: ({ input, result }) => buildLog(input.quoteId, result),
  undo,
}
registerCommand(createAdjustmentCommand)
registerCommand(updateAdjustmentCommand)
registerCommand(deleteAdjustmentCommand)
