import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqSubscriptionChangeLog } from '../data/entities'
import { SNAPSHOT_COSTS_KEY, stripSnapshotCosts } from '../services/costs/inventoryCostSnapshot'

/**
 * Rollback aid for the cost-plus carry-through (feature spec §Risks, "Rollback limits"): removes
 * `items[].costs` and `assets[].costs` from `before_snapshot` / `after_snapshot` of change-log rows, and
 * nothing else. Idempotent (a clean row is neither written nor counted) and read in keyset pages by id, so the
 * whole table is never loaded at once. Soft-deleted rows are scrubbed too: they hold the same confidential data.
 * Rows are updated with `nativeUpdate` so `updated_at` and versions of the immutable history are untouched.
 */

export type ScrubChangeLogCostsOptions = {
  /** Restrict to one tenant; omitted = every tenant. */
  tenantId?: string
  /** Count what would change, write nothing. */
  dryRun?: boolean
  /** Rows per page (default 200). */
  batchSize?: number
}

export type ScrubChangeLogCostsResult = {
  scanned: number
  /** Rows that held at least one cost key (rewritten, or would be rewritten on a dry run). */
  affected: number
  dryRun: boolean
}

function holdsCosts(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  return ['items', 'assets'].some((owners) => {
    const list = (snapshot as Record<string, unknown>)[owners]
    return Array.isArray(list) && list.some((entry) => !!entry && typeof entry === 'object' && SNAPSHOT_COSTS_KEY in (entry as object))
  })
}

export async function scrubChangeLogCosts(
  em: EntityManager,
  options: ScrubChangeLogCostsOptions = {},
): Promise<ScrubChangeLogCostsResult> {
  const dryRun = options.dryRun === true
  const limit = options.batchSize ?? 200
  const result: ScrubChangeLogCostsResult = { scanned: 0, affected: 0, dryRun }
  let lastId: string | null = null
  for (;;) {
    const where: Record<string, unknown> = {}
    if (options.tenantId) where.tenantId = options.tenantId
    if (lastId) where.id = { $gt: lastId }
    const page = await em.find(CpqSubscriptionChangeLog, where as never, { orderBy: { id: 'asc' } as never, limit })
    if (page.length === 0) break
    for (const row of page) {
      result.scanned++
      const patch: Record<string, unknown> = {}
      if (holdsCosts(row.beforeSnapshot)) patch.beforeSnapshot = stripSnapshotCosts(row.beforeSnapshot)
      if (holdsCosts(row.afterSnapshot)) patch.afterSnapshot = stripSnapshotCosts(row.afterSnapshot)
      if (Object.keys(patch).length === 0) continue
      result.affected++
      if (!dryRun) await em.nativeUpdate(CpqSubscriptionChangeLog, { id: row.id } as never, patch as never)
    }
    lastId = page[page.length - 1].id
    // Keep the identity map small: the next page is a different slice.
    em.clear()
    if (page.length < limit) break
  }
  return result
}
