import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BillingItem, BillingItemStatusPeriod } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import {
  billingItemStatusPeriodBulkSchema,
  billingItemStatusPeriodCreateSchema,
  billingItemStatusPeriodDeleteSchema,
  billingItemStatusPeriodUpdateSchema,
  type BillingItemStatusPeriodBulkInput,
  type BillingItemStatusPeriodCreateInput,
  type BillingItemStatusPeriodDeleteInput,
  type BillingItemStatusPeriodUpdateInput,
} from '../data/validators'
import {
  STATUS_PERIOD_END_BEFORE_START,
  STATUS_PERIOD_OVERLAP,
  STATUS_PERIOD_READ_ONLY,
  defaultChargeBehavior,
  findOverlap,
  isStatusWriteAllowed,
} from '../lib/itemStatusPeriods'
import { toIsoDate, toUtcMidnight } from '../lib/dateOnly'

/**
 * Line status periods (line-period-and-status spec §4.3, contract C1) —
 * create / update / delete (undoable) and the account bulk action.
 *
 * Rules enforced here:
 *   - periods on one item never overlap (422 `billing.item.status_period_overlap`);
 *   - resume = update `toDate` on the open period;
 *   - D6: an item with a `subscriptionId` (a CPQ line) is read-only from the
 *     UI / REST (422 `billing.item.status_period_read_only`); the connector
 *     writes it through these commands with a system context (`auth: null`).
 *
 * The billing effect is applied by the Bill Run (`servicePeriods.ts`): days
 * already billed are credited (late pause) or re-charged (shortened pause) on
 * the next run — the engine-owned `applied_from` / `applied_to` guard it.
 */

const statusIndexer = { entityType: billingEntityIds.itemStatusPeriod } as const
const statusEvents = { module: 'billing', entity: 'item_status_period', persistent: true } as const

type StatusSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  billingItemId: string
  status: BillingItemStatusPeriod['status']
  fromDate: string
  toDate: string | null
  chargeBehavior: BillingItemStatusPeriod['chargeBehavior']
  reason: string | null
  deletedAt: string | null
}

type StatusUndoPayload = { before?: StatusSnapshot | null; after?: StatusSnapshot | null }

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

function snapshot(row: BillingItemStatusPeriod): StatusSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    billingItemId: row.billingItemId,
    status: row.status,
    fromDate: toIsoDate(row.fromDate),
    toDate: row.toDate ? toIsoDate(row.toDate) : null,
    chargeBehavior: row.chargeBehavior,
    reason: row.reason ?? null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  }
}

function identifiers(row: BillingItemStatusPeriod) {
  return { id: row.id, tenantId: row.tenantId, organizationId: row.organizationId }
}

async function loadItem(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  id: string,
): Promise<BillingItem> {
  const item = await em.findOne(BillingItem, { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null })
  if (!item) throw new CrudHttpError(404, { error: 'Billing item not found' })
  return item
}

function assertWritable(item: BillingItem, ctx: CommandRuntimeContext): void {
  if (!isStatusWriteAllowed(item, ctx.auth)) {
    throw new CrudHttpError(422, {
      error: 'The status of a CPQ line is changed on its subscription in CPQ',
      code: STATUS_PERIOD_READ_ONLY,
    })
  }
}

async function siblings(em: EntityManager, item: BillingItem): Promise<BillingItemStatusPeriod[]> {
  return (await em.find(BillingItemStatusPeriod, {
    tenantId: item.tenantId,
    organizationId: item.organizationId,
    billingItemId: item.id,
    deletedAt: null,
  } as never)) as BillingItemStatusPeriod[]
}

function assertNoOverlap(
  existing: readonly BillingItemStatusPeriod[],
  candidate: { fromDate: Date | string; toDate?: Date | string | null },
  excludeId?: string,
): void {
  const clash = findOverlap(existing, candidate, excludeId)
  if (clash) {
    throw new CrudHttpError(422, {
      error: `This status overlaps the ${clash.status} period from ${toIsoDate(clash.fromDate)}`,
      code: STATUS_PERIOD_OVERLAP,
      overlapsId: clash.id,
    })
  }
}

function assertRange(fromDate: Date | string, toDate: Date | string | null | undefined): void {
  if (toDate && toUtcMidnight(toDate).getTime() < toUtcMidnight(fromDate).getTime()) {
    throw new CrudHttpError(422, { error: 'toDate cannot be before fromDate', code: STATUS_PERIOD_END_BEFORE_START })
  }
}

function newRow(
  em: EntityManager,
  item: BillingItem,
  input: Pick<BillingItemStatusPeriodCreateInput, 'status' | 'fromDate' | 'toDate' | 'chargeBehavior' | 'reason'>,
  now: Date,
): BillingItemStatusPeriod {
  const row = em.create(BillingItemStatusPeriod, {
    id: randomUUID(),
    organizationId: item.organizationId,
    tenantId: item.tenantId,
    billingItemId: item.id,
    status: input.status,
    fromDate: toIsoDate(input.fromDate),
    toDate: input.toDate ? toIsoDate(input.toDate) : null,
    chargeBehavior: input.chargeBehavior ?? defaultChargeBehavior(input.status),
    reason: input.reason?.trim() ? input.reason.trim() : null,
    appliedFrom: null,
    appliedTo: null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(row)
  return row
}

async function emit(ctx: CommandRuntimeContext, action: 'created' | 'updated' | 'deleted', row: BillingItemStatusPeriod) {
  const base = { dataEngine: getDataEngine(ctx), entity: row, identifiers: identifiers(row), indexer: statusIndexer }
  // Literal actions per call so `__tests__/events.test.ts` can read the emitted ids.
  if (action === 'created') await emitCrudSideEffects({ ...base, action: 'created', events: statusEvents })
  else if (action === 'updated') await emitCrudSideEffects({ ...base, action: 'updated', events: statusEvents })
  else await emitCrudSideEffects({ ...base, action: 'deleted', events: statusEvents })
}

async function loadRow(em: EntityManager, id: string, scope: { tenantId: string; organizationId: string }, withDeleted = false) {
  return em.findOne(BillingItemStatusPeriod, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    ...(withDeleted ? {} : { deletedAt: null }),
  } as never)
}

/** Undo: put the row back to `snap` (applied* stay engine-owned). */
async function restore(ctx: CommandRuntimeContext, snap: StatusSnapshot): Promise<void> {
  const em = getEm(ctx)
  const row = await loadRow(em, snap.id, snap, true)
  if (!row) return
  row.status = snap.status
  row.fromDate = snap.fromDate
  row.toDate = snap.toDate
  row.chargeBehavior = snap.chargeBehavior
  row.reason = snap.reason
  row.deletedAt = snap.deletedAt ? new Date(snap.deletedAt) : null
  row.updatedAt = new Date()
  await em.flush()
  await emitCrudUndoSideEffects({
    dataEngine: getDataEngine(ctx),
    action: 'updated',
    entity: row,
    identifiers: identifiers(row),
    indexer: statusIndexer,
    events: statusEvents,
  })
}

// ─── Create ──────────────────────────────────────────────────────

const createStatusPeriodCommand: CommandHandler<BillingItemStatusPeriodCreateInput, { id: string }> = {
  id: 'billing.items.status_periods.create',
  isUndoable: true,

  async execute(rawInput, ctx) {
    const parsed = billingItemStatusPeriodCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = getEm(ctx)
    const item = await loadItem(em, parsed, parsed.billingItemId)
    assertWritable(item, ctx)
    assertRange(parsed.fromDate, parsed.toDate)
    assertNoOverlap(await siblings(em, item), parsed)
    const row = newRow(em, item, parsed, new Date())
    await em.flush()
    await emit(ctx, 'created', row)
    return { id: row.id }
  },

  async captureAfter(_input, result, ctx) {
    const row = await loadRow(getEm(ctx), result.id, { tenantId: _input.tenantId, organizationId: _input.organizationId })
    return row ? snapshot(row) : null
  },

  buildLog({ result, snapshots }) {
    const after = (snapshots.after as StatusSnapshot | undefined) ?? null
    return {
      actionLabel: 'Create line status period',
      resourceKind: 'billing.item_status_period',
      resourceId: result.id,
      parentResourceKind: 'billing.item',
      parentResourceId: after?.billingItemId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } satisfies StatusUndoPayload },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<StatusUndoPayload>(logEntry)?.after
    if (!after) return
    // Undo a create = soft-delete; the next Bill Run re-charges any applied days.
    await restore(ctx, { ...after, deletedAt: new Date().toISOString() })
  },
}

// ─── Update (resume = set toDate) ────────────────────────────────

const updateStatusPeriodCommand: CommandHandler<BillingItemStatusPeriodUpdateInput, { id: string }> = {
  id: 'billing.items.status_periods.update',
  isUndoable: true,

  async prepare(rawInput, ctx) {
    const parsed = billingItemStatusPeriodUpdateSchema.parse(rawInput)
    const row = await loadRow(getEm(ctx), parsed.id, parsed)
    return row ? { before: snapshot(row) } : null
  },

  async execute(rawInput, ctx) {
    const parsed = billingItemStatusPeriodUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = getEm(ctx)
    const row = await loadRow(em, parsed.id, parsed)
    if (!row) throw new CrudHttpError(404, { error: 'Status period not found' })
    const item = await loadItem(em, parsed, row.billingItemId)
    assertWritable(item, ctx)
    const others = await siblings(em, item)
    // Reads done — mutate.
    const fromDate = parsed.fromDate ?? row.fromDate
    const toDate = parsed.toDate !== undefined ? parsed.toDate : (row.toDate ?? null)
    assertRange(fromDate, toDate)
    assertNoOverlap(others, { fromDate, toDate }, row.id)
    row.fromDate = toIsoDate(fromDate)
    row.toDate = toDate ? toIsoDate(toDate) : null
    if (parsed.chargeBehavior !== undefined) row.chargeBehavior = parsed.chargeBehavior
    if (parsed.reason !== undefined) row.reason = parsed.reason?.trim() ? parsed.reason.trim() : null
    row.updatedAt = new Date()
    await em.flush()
    await emit(ctx, 'updated', row)
    return { id: row.id }
  },

  async captureAfter(input, result, ctx) {
    const row = await loadRow(getEm(ctx), result.id, input)
    return row ? snapshot(row) : null
  },

  buildLog({ result, snapshots }) {
    const before = (snapshots.before as StatusSnapshot | undefined) ?? null
    const after = (snapshots.after as StatusSnapshot | undefined) ?? null
    return {
      actionLabel: 'Update line status period',
      resourceKind: 'billing.item_status_period',
      resourceId: result.id,
      parentResourceKind: 'billing.item',
      parentResourceId: after?.billingItemId ?? before?.billingItemId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } satisfies StatusUndoPayload },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<StatusUndoPayload>(logEntry)?.before
    if (before) await restore(ctx, before)
  },
}

// ─── Delete (soft) ───────────────────────────────────────────────

const deleteStatusPeriodCommand: CommandHandler<BillingItemStatusPeriodDeleteInput, { id: string }> = {
  id: 'billing.items.status_periods.delete',
  isUndoable: true,

  async prepare(rawInput, ctx) {
    const parsed = billingItemStatusPeriodDeleteSchema.parse(rawInput)
    const row = await loadRow(getEm(ctx), parsed.id, parsed)
    return row ? { before: snapshot(row) } : null
  },

  async execute(rawInput, ctx) {
    const parsed = billingItemStatusPeriodDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = getEm(ctx)
    const row = await loadRow(em, parsed.id, parsed)
    if (!row) throw new CrudHttpError(404, { error: 'Status period not found' })
    const item = await loadItem(em, parsed, row.billingItemId)
    assertWritable(item, ctx)
    row.deletedAt = new Date()
    row.updatedAt = row.deletedAt
    await em.flush()
    await emit(ctx, 'deleted', row)
    return { id: row.id }
  },

  buildLog({ result, snapshots }) {
    const before = (snapshots.before as StatusSnapshot | undefined) ?? null
    return {
      actionLabel: 'Delete line status period',
      resourceKind: 'billing.item_status_period',
      resourceId: result.id,
      parentResourceKind: 'billing.item',
      parentResourceId: before?.billingItemId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
      payload: { undo: { before } satisfies StatusUndoPayload },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<StatusUndoPayload>(logEntry)?.before
    if (before) await restore(ctx, before)
  },
}

// ─── Bulk: every line of an account ──────────────────────────────

export type BulkStatusResult = {
  created: Array<{ id: string; billingItemId: string }>
  skipped: Array<{ billingItemId: string; reason: 'read_only' | 'overlap' | 'ended' }>
}

/**
 * Pause / suspend / grace every live line of an account from `fromDate`
 * (e.g. suspending a customer for non-payment). Lines that cannot take it
 * are reported, not failed: CPQ lines from the UI (D6), lines with an
 * overlapping status, lines that ended before `fromDate`. Usage lines take
 * the status too (shown on the Items tab) but their billing is unaffected.
 */
const bulkStatusPeriodCommand: CommandHandler<BillingItemStatusPeriodBulkInput, BulkStatusResult> = {
  id: 'billing.items.status_periods.bulk_create',
  isUndoable: true,

  async execute(rawInput, ctx) {
    const parsed = billingItemStatusPeriodBulkSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = getEm(ctx)
    const items = (await em.find(BillingItem, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      billAccountId: parsed.billAccountId,
      isActive: true,
      deletedAt: null,
    } as never)) as BillingItem[]
    const existing = items.length
      ? ((await em.find(BillingItemStatusPeriod, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          billingItemId: { $in: items.map((i) => i.id) },
          deletedAt: null,
        } as never)) as BillingItemStatusPeriod[])
      : []
    const fromMs = toUtcMidnight(parsed.fromDate).getTime()
    const result: BulkStatusResult = { created: [], skipped: [] }
    const rows: BillingItemStatusPeriod[] = []
    const now = new Date()
    for (const item of items) {
      if (item.type === 'one_time') continue
      if (item.billEndDate && toUtcMidnight(item.billEndDate).getTime() < fromMs) {
        result.skipped.push({ billingItemId: item.id, reason: 'ended' })
        continue
      }
      if (!isStatusWriteAllowed(item, ctx.auth)) {
        result.skipped.push({ billingItemId: item.id, reason: 'read_only' })
        continue
      }
      if (findOverlap(existing.filter((r) => r.billingItemId === item.id), parsed)) {
        result.skipped.push({ billingItemId: item.id, reason: 'overlap' })
        continue
      }
      const row = newRow(em, item, parsed, now)
      rows.push(row)
      result.created.push({ id: row.id, billingItemId: item.id })
    }
    if (rows.length > 0) await em.flush()
    for (const row of rows) await emit(ctx, 'created', row)
    return result
  },

  buildLog({ input, result }) {
    return {
      actionLabel: 'Set line status on account',
      resourceKind: 'billing.account',
      resourceId: input.billAccountId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { undo: { createdIds: result.created.map((c) => c.id) } },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<{ createdIds?: string[] }>(logEntry)
    const ids = payload?.createdIds ?? []
    if (ids.length === 0) return
    const em = getEm(ctx)
    const rows = (await em.find(BillingItemStatusPeriod, {
      id: { $in: ids },
      ...(logEntry.tenantId ? { tenantId: logEntry.tenantId } : {}),
      ...(logEntry.organizationId ? { organizationId: logEntry.organizationId } : {}),
      deletedAt: null,
    } as never)) as BillingItemStatusPeriod[]
    const now = new Date()
    for (const row of rows) {
      row.deletedAt = now
      row.updatedAt = now
    }
    await em.flush()
    for (const row of rows) {
      await emitCrudUndoSideEffects({
        dataEngine: getDataEngine(ctx),
        action: 'deleted',
        entity: row,
        identifiers: identifiers(row),
        indexer: statusIndexer,
        events: statusEvents,
      })
    }
  },
}

registerCommand(createStatusPeriodCommand)
registerCommand(updateStatusPeriodCommand)
registerCommand(deleteStatusPeriodCommand)
registerCommand(bulkStatusPeriodCommand)

export { createStatusPeriodCommand, updateStatusPeriodCommand, deleteStatusPeriodCommand, bulkStatusPeriodCommand }
