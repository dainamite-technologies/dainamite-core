import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { cpqCostAnswerSchema, cpqCostCancelRequestSchema, cpqCostDeclineSchema, cpqCostRequestSchema } from '../data/cost-sourcing'
import { sourcingCommandContext } from '../lib/sourcingCommandContext'
import type { CostAnswerWriteResult, CostDeclineWriteResult, CostRequestWriteResult } from '../services/costs/costSourcingService'

const id = z.string().uuid()
const requestSchema = z.object({ quoteId: id, costId: id, request: cpqCostRequestSchema }).strict()
const answerSchema = z.object({ quoteId: id, costId: id, answer: cpqCostAnswerSchema }).strict()
const declineSchema = z.object({ quoteId: id, costId: id, decline: cpqCostDeclineSchema }).strict()
const cancelSchema = z.object({ quoteId: id, costId: id, cancel: cpqCostCancelRequestSchema }).strict()

/**
 * Log entry of a sourcing write (request, cancel, answer, decline, apply-answer). Like every cost write it is NOT undoable and NOT replayable (the action log is
 * readable outside `cpq.costs.view`): the snapshots carry ids, statuses, `requestSeq` and the reason only, never an
 * amount, supplier or note.
 */
async function buildLog(result: Pick<CostRequestWriteResult, 'audit'>) {
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
// Answer / decline need cost visibility AND management (Q13).
const COSTS_FEATURES = ['cpq.costs.view', 'cpq.costs.manage']

export const answerQuoteLineCostCommand: CommandHandler<z.infer<typeof answerSchema>, CostAnswerWriteResult> = {
  id: 'cpq.quote_line_cost.answer', isUndoable: false,
  async execute(input, ctx) {
    const parsed = answerSchema.parse(input)
    const { actor, scope, service } = await sourcingCommandContext(ctx, COSTS_FEATURES)
    return service.answer(parsed.quoteId, parsed.costId, parsed.answer, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
export const declineQuoteLineCostCommand: CommandHandler<z.infer<typeof declineSchema>, CostDeclineWriteResult> = {
  id: 'cpq.quote_line_cost.decline', isUndoable: false,
  async execute(input, ctx) {
    const parsed = declineSchema.parse(input)
    const { actor, scope, service } = await sourcingCommandContext(ctx, COSTS_FEATURES)
    return service.decline(parsed.quoteId, parsed.costId, parsed.decline, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
registerCommand(requestQuoteLineCostCommand)
registerCommand(cancelRequestQuoteLineCostCommand)
registerCommand(answerQuoteLineCostCommand)
registerCommand(declineQuoteLineCostCommand)
