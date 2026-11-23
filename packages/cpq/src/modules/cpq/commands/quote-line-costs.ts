import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { cpqQuoteLineCostCreateSchema, cpqQuoteLineCostUpdateSchema } from '../data/quote-costs'
import { costCommandContext } from '../lib/costCommandContext'
import type { QuoteCostWriteResult } from '../services/costs/quoteCostService'

const id = z.string().uuid()
const createSchema = z.object({ quoteId: id, cost: cpqQuoteLineCostCreateSchema }).strict()
const updateSchema = z.object({ quoteId: id, costId: id, patch: cpqQuoteLineCostUpdateSchema }).strict()
const deleteSchema = z.object({ quoteId: id, costId: id, expectedRevision: z.number().int().min(0).optional() }).strict()

/**
 * Log entry of a cost write. Cost writes are NOT undoable and NOT replayable:
 * an undo / redo payload would have to hold amounts, suppliers and notes, and the
 * action log is readable outside `cpq.costs.view`. The snapshots carry ids,
 * statuses, roles and the cost key only; `replayable: false` keeps the raw
 * input out of the stored command payload.
 */
async function buildLog(result: QuoteCostWriteResult) {
  const { translate } = await resolveTranslations()
  const subject = result.audit.after ?? result.audit.before
  return {
    actionLabel: translate('cpq.costs.audit.change', 'Change quote cost'),
    resourceKind: 'cpq.quote_line_cost', resourceId: subject?.id ?? undefined,
    snapshotBefore: result.audit.before, snapshotAfter: result.audit.after,
    replayable: false as const,
  }
}

export const createQuoteLineCostCommand: CommandHandler<z.infer<typeof createSchema>, QuoteCostWriteResult> = {
  id: 'cpq.quote_line_cost.create', isUndoable: false,
  async execute(input, ctx) {
    const parsed = createSchema.parse(input)
    const { actor, scope, service } = await costCommandContext(ctx)
    return service.createCost(parsed.quoteId, parsed.cost, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
export const updateQuoteLineCostCommand: CommandHandler<z.infer<typeof updateSchema>, QuoteCostWriteResult> = {
  id: 'cpq.quote_line_cost.update', isUndoable: false,
  async execute(input, ctx) {
    const parsed = updateSchema.parse(input)
    const { actor, scope, service } = await costCommandContext(ctx)
    return service.updateCost(parsed.quoteId, parsed.costId, parsed.patch, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
export const deleteQuoteLineCostCommand: CommandHandler<z.infer<typeof deleteSchema>, QuoteCostWriteResult> = {
  id: 'cpq.quote_line_cost.delete', isUndoable: false,
  async execute(input, ctx) {
    const parsed = deleteSchema.parse(input)
    const { actor, scope, service } = await costCommandContext(ctx)
    return service.deleteCost(parsed.quoteId, parsed.costId, actor, scope, parsed.expectedRevision)
  },
  buildLog: ({ result }) => buildLog(result),
}
registerCommand(createQuoteLineCostCommand)
registerCommand(updateQuoteLineCostCommand)
registerCommand(deleteQuoteLineCostCommand)
