import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  COST_INDEX_WRITE_FEATURES,
  cpqCostIndexCreateSchema,
  cpqCostIndexImportSchema,
  cpqCostIndexUpdateSchema,
  cpqCostIndexValueCreateSchema,
} from '../data/cost-indices'
import { costCommandIdentity } from '../lib/costCommandContext'
import type { CostIndexValueView, CostIndexView, CpqCostIndexService, ImportRowResult } from '../services/costs/costIndexService'

const id = z.string().uuid()
const createSchema = z.object({ index: cpqCostIndexCreateSchema }).strict()
const updateSchema = z.object({ indexId: id, patch: cpqCostIndexUpdateSchema }).strict()
const deleteSchema = z.object({ indexId: id }).strict()
// One command per value write: a single append, or one whole import call (never a dry run: that writes nothing).
const appendSchema = z.union([
  z.object({ indexId: id, value: cpqCostIndexValueCreateSchema }).strict(),
  z.object({ import: cpqCostIndexImportSchema.omit({ dryRun: true }) }).strict(),
])

/** What the action log may hold about an index: identity and state, never a value. */
type IndexAudit = { id: string; code: string; currencyCode: string; isActive: boolean }
type IndexWriteResult = { item: CostIndexView | null; audit: { before: IndexAudit | null; after: IndexAudit | null } }
/** Value appends log index id, date and revision only. */
type AppendAuditRow = { indexId?: string; indexCode?: string; effectiveDate: string; revision: number; status: 'created' | 'unchanged' }
export type IndexValueWriteResult = {
  value: CostIndexValueView | null
  batchId: string | null
  results: ImportRowResult[] | null
  audit: { before: null; after: { batchId?: string | null; rows: AppendAuditRow[] } }
}

const auditOf = (row: CostIndexView | null): IndexAudit | null => (row ? { id: row.id, code: row.code, currencyCode: row.currencyCode, isActive: row.isActive } : null)

async function indexContext(ctx: Parameters<typeof costCommandIdentity>[0]) {
  const identity = await costCommandIdentity(ctx, [...COST_INDEX_WRITE_FEATURES])
  return { ...identity, service: ctx.container.resolve<CpqCostIndexService>('cpqCostIndexService') }
}

/**
 * Index writes are NOT undoable and NOT replayable (append-only by design; the action log is readable outside
 * `cpq.costs.view`): `replayable: false` keeps the raw input (which carries the values) out of the stored command
 * payload, and the snapshots below carry ids, codes, dates and revisions only.
 */
async function buildLog(label: [string, string], resourceKind: string, result: { audit: { before: unknown; after: unknown } }, resourceId?: string) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label[0], label[1]),
    resourceKind, resourceId,
    snapshotBefore: result.audit.before, snapshotAfter: result.audit.after,
    replayable: false as const,
  }
}

export const createCostIndexCommand: CommandHandler<z.infer<typeof createSchema>, IndexWriteResult> = {
  id: 'cpq.cost_index.create', isUndoable: false,
  async execute(input, ctx) {
    const { index } = createSchema.parse(input)
    const { scope, service } = await indexContext(ctx)
    const item = await service.create(index, scope)
    return { item, audit: { before: null, after: auditOf(item) } }
  },
  buildLog: ({ result }) => buildLog(['cpq.costIndices.audit.create', 'Create cost index'], 'cpq.cost_index', result, result.item?.id),
}

export const updateCostIndexCommand: CommandHandler<z.infer<typeof updateSchema>, IndexWriteResult> = {
  id: 'cpq.cost_index.update', isUndoable: false,
  async execute(input, ctx) {
    const { indexId, patch } = updateSchema.parse(input)
    const { scope, service } = await indexContext(ctx)
    const before = (await service.get(indexId, scope)).item
    const item = await service.update(indexId, patch, scope)
    return { item, audit: { before: auditOf(before), after: auditOf(item) } }
  },
  buildLog: ({ result }) => buildLog(['cpq.costIndices.audit.update', 'Change cost index'], 'cpq.cost_index', result, result.item?.id),
}

export const deleteCostIndexCommand: CommandHandler<z.infer<typeof deleteSchema>, IndexWriteResult> = {
  id: 'cpq.cost_index.delete', isUndoable: false,
  async execute(input, ctx) {
    const { indexId } = deleteSchema.parse(input)
    const { scope, service } = await indexContext(ctx)
    const before = (await service.get(indexId, scope)).item
    await service.softDelete(indexId, scope)
    return { item: null, audit: { before: auditOf(before), after: null } }
  },
  buildLog: ({ result }) => buildLog(['cpq.costIndices.audit.delete', 'Delete cost index'], 'cpq.cost_index', result, result.audit.before?.id),
}

export const appendCostIndexValueCommand: CommandHandler<z.infer<typeof appendSchema>, IndexValueWriteResult> = {
  id: 'cpq.cost_index_value.append', isUndoable: false,
  async execute(input, ctx) {
    const parsed = appendSchema.parse(input)
    const { actor, scope, service } = await indexContext(ctx)
    if ('import' in parsed) {
      const run = await service.importValues(parsed.import.items, scope, { userId: actor })
      return {
        value: null, batchId: run.batchId, results: run.results,
        audit: { before: null, after: { batchId: run.batchId, rows: run.results.map((r) => ({ indexCode: r.indexCode, effectiveDate: r.effectiveDate, revision: r.revision, status: r.status })) } },
      }
    }
    const value = await service.appendValue(parsed.indexId, parsed.value, scope, { userId: actor })
    return {
      value, batchId: null, results: null,
      audit: { before: null, after: { rows: [{ indexId: value.costIndexId, effectiveDate: value.effectiveDate, revision: value.revision, status: 'created' }] } },
    }
  },
  buildLog: ({ result }) => buildLog(['cpq.costIndices.audit.append', 'Add cost index values'], 'cpq.cost_index_value', result, result.value?.id),
}

registerCommand(createCostIndexCommand)
registerCommand(updateCostIndexCommand)
registerCommand(deleteCostIndexCommand)
registerCommand(appendCostIndexValueCommand)
