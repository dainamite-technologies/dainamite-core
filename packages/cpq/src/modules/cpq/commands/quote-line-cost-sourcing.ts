import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { cpqCostCancelRequestSchema, cpqCostRequestSchema } from '../data/cost-sourcing'
import { sourcingCommandContext } from '../lib/sourcingCommandContext'
import type { CostRequestWriteResult } from '../services/costs/costSourcingService'

const id = z.string().uuid()
const requestSchema = z.object({ quoteId: id, costId: id, request: cpqCostRequestSchema }).strict()
const cancelSchema = z.object({ quoteId: id, costId: id, cancel: cpqCostCancelRequestSchema }).strict()

/**
 * Log entry of a sourcing write. Like every cost write it is NOT undoable and NOT replayable (the action log is
 * readable outside `cpq.costs.view`): the snapshots carry ids, statuses, `requestSeq` and the reason only, never an
 * amount, supplier or note.
 */
async function buildLog(result: CostRequestWriteResult) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate('cpq.costs.audit.sourcing', 'Change cost request'),
    resourceKind: 'cpq.quote_line_cost', resourceId: result.audit.after.id,
    snapshotBefore: result.audit.before, snapshotAfter: result.audit.after,
    replayable: false as const,
  }
}

export const requestQuoteLineCostCommand: CommandHandler<z.infer<typeof requestSchema>, CostRequestWriteResult> = {
  id: 'cpq.quote_line_cost.request', isUndoable: false,
  async execute(input, ctx) {
    const parsed = requestSchema.parse(input)
    const { actor, scope, service } = await sourcingCommandContext(ctx, ['cpq.quotes.manage'])
    return service.request(parsed.quoteId, parsed.costId, parsed.request, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
export const cancelRequestQuoteLineCostCommand: CommandHandler<z.infer<typeof cancelSchema>, CostRequestWriteResult> = {
  id: 'cpq.quote_line_cost.cancel_request', isUndoable: false,
  async execute(input, ctx) {
    const parsed = cancelSchema.parse(input)
    const { actor, scope, service } = await sourcingCommandContext(ctx, ['cpq.quotes.manage'])
    return service.cancelRequest(parsed.quoteId, parsed.costId, parsed.cancel, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
registerCommand(requestQuoteLineCostCommand)
registerCommand(cancelRequestQuoteLineCostCommand)
