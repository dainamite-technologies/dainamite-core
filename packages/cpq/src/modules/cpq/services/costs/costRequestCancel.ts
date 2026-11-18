import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteLineCost } from '../../data/entities'
import type { TenantScope } from '../types'
import { cancelRequestPatch, isRequestOpen } from './costRequestState'
import type { CancelReason } from './costSourcing'
import { sourcingCostRef, type SourcingSignal } from './sourcingSignals'

export type CancelOpenRequestsOptions = {
  actorUserId?: string | null
  costIds?: string[]
  quoteLineIds?: string[]
  /** Receives the `request_cancelled` signals (published after commit by the owning write). */
  signals?: SourcingSignal[]
}

/**
 * Closes the open requests among already loaded cost rows as `cancelled (reason)`: history appended, proposal and
 * idempotency key cleared, one amount-free `request_cancelled` signal each. Synchronous: no query, no flush (safe
 * inside a `withAtomicFlush` mutate phase). Rows that are not open are skipped.
 */
export function cancelRowRequests(
  rows: Iterable<Pick<CpqQuoteLineCost, 'id' | 'sourcingStatus' | 'costRequestId'> & Record<string, unknown>>,
  reason: CancelReason, options: Pick<CancelOpenRequestsOptions, 'actorUserId' | 'signals'> = {},
): SourcingSignal[] {
  const now = new Date()
  const cancelled: SourcingSignal[] = []
  for (const row of rows) {
    if (!isRequestOpen(row)) continue
    const cost = row as unknown as CpqQuoteLineCost
    Object.assign(cost, cancelRequestPatch(cost, { reason, now, closedByUserId: options.actorUserId ?? null }))
    cancelled.push({ ...sourcingCostRef(cost), kind: 'request_cancelled', costRequestId: cost.costRequestId as string, requestSeq: cost.requestSeq ?? 1, reason })
  }
  options.signals?.push(...cancelled)
  return cancelled
}

/**
 * The single cancellation helper of every cause that runs inside a quote write (also exposed as
 * `CpqCostSourcingService.cancelOpenRequests`): finds the open requests of the quote (optionally of given cost lines
 * or quote lines) and cancels them. Does NOT flush and does not check the cost-plus toggle: stored state is always
 * cleaned (spec §Edge Cases, toggle off). Call it BEFORE the caller's own scalar mutations, so no query runs between
 * a change and its flush.
 */
export async function cancelOpenRequests(
  em: EntityManager, quote: { id: string }, scope: TenantScope, reason: CancelReason, options: CancelOpenRequestsOptions = {},
): Promise<SourcingSignal[]> {
  const rows = await em.find(CpqQuoteLineCost, {
    organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null, quoteConfigurationId: quote.id, sourcingStatus: 'requested',
    ...(options.costIds ? { id: { $in: options.costIds } } : {}),
    ...(options.quoteLineIds ? { quoteLineId: { $in: options.quoteLineIds } } : {}),
  })
  return cancelRowRequests(rows as never, reason, options)
}
