import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandInterceptor,
  CommandInterceptorContext,
  CommandInterceptorUndoContext,
} from '@open-mercato/shared/lib/commands/command-interceptor'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration } from '../data/entities'

/**
 * Command interceptors for CPQ.
 *
 * `DELETE /api/cpq/quotes/{quoteId}` removes the sales quote through
 * `sales.quotes.delete` and then soft-deletes the CPQ configuration and its
 * lines with one shared `deletedAt`. Undoing that action from the audit log
 * runs the sales command's undo only, so the quote came back as a plain sales
 * quote. This `afterUndo` hook restores the CPQ side: the configuration of the
 * restored quote and the lines that were deleted in the same operation (same
 * `deletedAt`). Lines removed earlier on their own stay deleted.
 *
 * `afterExecute` covers every other path that runs `sales.quotes.delete`: a
 * redo from the audit log, or a delete started in the sales module. It
 * soft-deletes the live CPQ configuration of that quote and its live lines,
 * so no CPQ row is left pointing at a sales quote that no longer exists.
 *
 * Auto-discovered from `commands/interceptors.ts`; no DI registration.
 */

type UndoLogEntry = {
  tenantId?: string | null
  organizationId?: string | null
  resourceKind?: string | null
  resourceId?: string | null
}

/**
 * The deleted sales quote id. The command bus passes the action log's
 * `commandPayload` (`{ undo: { before } }`) as `undoContext.input`, not the
 * original command input, so the id comes from the log entry first.
 */
export function readDeletedSalesQuoteId(input: unknown, logEntry?: unknown): string | null {
  const log = (logEntry ?? {}) as UndoLogEntry
  if (log.resourceKind === 'sales.quote' && typeof log.resourceId === 'string' && log.resourceId) {
    return log.resourceId
  }
  if (!input || typeof input !== 'object') return null
  const record = input as {
    id?: unknown
    body?: { id?: unknown } | null
    undo?: { before?: { quote?: { id?: unknown } | null } | null } | null
  }
  const id = record.undo?.before?.quote?.id ?? record.body?.id ?? record.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function restoreCpqQuoteAfterSalesUndo(
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
): Promise<{ restoredConfigurationId: string; restoredLines: number } | null> {
  const salesQuoteId = readDeletedSalesQuoteId(undoContext.input, undoContext.logEntry)
  const log = (undoContext.logEntry ?? {}) as UndoLogEntry
  const tenantId = log.tenantId ?? context.auth?.tenantId ?? null
  const organizationId = log.organizationId ?? context.selectedOrganizationId ?? null
  if (!salesQuoteId || !tenantId || !organizationId) return null

  const em = (context.container.resolve('em') as EntityManager).fork()
  const scope = { tenantId, organizationId }
  // A live configuration means CPQ never deleted it (the quote was deleted
  // outside CPQ, or it was already restored): nothing to do.
  const live = await em.findOne(CpqQuoteConfiguration, { quoteId: salesQuoteId, ...scope, deletedAt: null })
  if (live) return null
  const config = await em.findOne(
    CpqQuoteConfiguration,
    { quoteId: salesQuoteId, ...scope, deletedAt: { $ne: null } },
    { orderBy: { deletedAt: 'desc' } },
  )
  if (!config?.deletedAt) return null

  const lines = await em.find(CpqQuoteLineConfiguration, {
    quoteConfigurationId: config.id,
    ...scope,
    deletedAt: config.deletedAt,
  })
  config.deletedAt = null
  for (const line of lines) line.deletedAt = null
  await em.flush()
  return { restoredConfigurationId: config.id, restoredLines: lines.length }
}

export async function softDeleteCpqQuoteAfterSalesDelete(
  input: unknown,
  context: CommandInterceptorContext,
): Promise<{ deletedConfigurationId: string; deletedLines: number } | null> {
  const salesQuoteId = readDeletedSalesQuoteId(input)
  const tenantId = context.auth?.tenantId ?? null
  if (!salesQuoteId || !tenantId) return null
  const em = (context.container.resolve('em') as EntityManager).fork()
  // Scoped by tenant only: a delete from the sales module may run with no
  // selected organization; the quote id itself is unique.
  const config = await em.findOne(CpqQuoteConfiguration, { quoteId: salesQuoteId, tenantId, deletedAt: null })
  if (!config) return null
  const lines = await em.find(CpqQuoteLineConfiguration, {
    quoteConfigurationId: config.id,
    tenantId,
    organizationId: config.organizationId,
    deletedAt: null,
  })
  const now = new Date()
  config.deletedAt = now
  for (const line of lines) line.deletedAt = now
  await em.flush()
  return { deletedConfigurationId: config.id, deletedLines: lines.length }
}

export const interceptors: CommandInterceptor[] = [
  {
    id: 'cpq.restore-quote-configuration-after-sales-undo',
    targetCommand: 'sales.quotes.delete',
    priority: 50,
    async afterExecute(input, _result, context) {
      await softDeleteCpqQuoteAfterSalesDelete(input, context)
    },
    async afterUndo(undoContext, context) {
      await restoreCpqQuoteAfterSalesUndo(undoContext, context)
    },
  },
]

export default interceptors
