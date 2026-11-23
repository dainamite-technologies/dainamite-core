import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { cpqQuoteMarkupOverrideClearSchema, cpqQuoteMarkupOverrideSetSchema } from '../data/quote-costs'
import { costCommandContext } from '../lib/costCommandContext'
import type { MarkupOverrideWriteResult } from '../services/costs/quoteCostService'

const id = z.string().uuid()
const setSchema = z.object({ quoteId: id, override: cpqQuoteMarkupOverrideSetSchema }).strict()
const clearSchema = z.object({ quoteId: id, override: cpqQuoteMarkupOverrideClearSchema }).strict()

/** Not undoable / not replayable; ids and the charge code only (never the markup or the note). See quote-line-costs. */
async function buildLog(result: MarkupOverrideWriteResult) {
  const { translate } = await resolveTranslations()
  const subject = result.audit.after ?? result.audit.before
  return {
    actionLabel: translate('cpq.costs.audit.markup', 'Change quote markup'),
    resourceKind: 'cpq.quote_markup_override', resourceId: subject?.id ?? undefined,
    snapshotBefore: result.audit.before, snapshotAfter: result.audit.after,
    replayable: false as const,
  }
}

export const setMarkupOverrideCommand: CommandHandler<z.infer<typeof setSchema>, MarkupOverrideWriteResult> = {
  id: 'cpq.quote_markup_override.set', isUndoable: false,
  async execute(input, ctx) {
    const parsed = setSchema.parse(input)
    const { actor, scope, service } = await costCommandContext(ctx)
    return service.setMarkupOverride(parsed.quoteId, parsed.override, actor, scope)
  },
  buildLog: ({ result }) => buildLog(result),
}
export const clearMarkupOverrideCommand: CommandHandler<z.infer<typeof clearSchema>, MarkupOverrideWriteResult> = {
  id: 'cpq.quote_markup_override.clear', isUndoable: false,
  async execute(input, ctx) {
    const parsed = clearSchema.parse(input)
    const { actor, scope, service } = await costCommandContext(ctx)
    const { quoteLineId, chargeCode, expectedRevision } = parsed.override
    return service.clearMarkupOverride(parsed.quoteId, quoteLineId, chargeCode, actor, scope, expectedRevision)
  },
  buildLog: ({ result }) => buildLog(result),
}
registerCommand(setMarkupOverrideCommand)
registerCommand(clearMarkupOverrideCommand)
