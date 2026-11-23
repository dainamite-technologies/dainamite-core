import { randomUUID } from 'node:crypto'
import { appendRequestHistory, buildHistoryEntry, type CancelReason } from './costSourcing'

/**
 * Row-level transitions of a cost request (feature spec §Proposed Solution 1 and 4, §Data Model). Pure: they build
 * the column patch, the caller applies it (`Object.assign`) inside its quote transaction. A request is a STATE of
 * the cost line: the current request lives in the line's columns, closed ones go to `request_history`.
 */

export type RequestRowState = {
  sourcingStatus: string
  costRequestId: string | null
  requestSeq: number | null
  requestedAt: Date | string | null
  requestedByUserId: string | null
  requestSupplierId?: string | null
  supplierId?: string | null
  supplierQuoteRef?: string | null
  declineReason?: string | null
  requestHistory?: ReadonlyArray<Record<string, unknown>> | null
}

export const isRequestOpen = (row: Pick<RequestRowState, 'sourcingStatus' | 'costRequestId'>): boolean =>
  row.sourcingStatus === 'requested' && !!row.costRequestId

/** Closes the open request as `cancelled`: history entry appended, proposal and idempotency key cleared, the request id kept. */
export function cancelRequestPatch(row: RequestRowState, input: { reason: CancelReason; now: Date; closedByUserId: string | null }): Record<string, unknown> {
  const entry = buildHistoryEntry({ cost: row, outcome: 'cancelled', closedAt: input.now, closedByUserId: input.closedByUserId, reason: input.reason })
  return {
    sourcingStatus: 'cancelled',
    cancelReason: input.reason,
    proposedAmount: null,
    proposedAnswer: null,
    lastAnswerHash: null,
    ...(entry ? { requestHistory: appendRequestHistory(row.requestHistory as Array<Record<string, unknown>> | undefined, entry as unknown as Record<string, unknown>) } : {}),
  }
}

/** Opens a new request: `request_seq + 1`, a fresh id, stale answer / proposal / cancel state cleared. The row must not hold an open one. */
export function openRequestPatch(
  row: Pick<RequestRowState, 'requestSeq'>,
  input: { now: Date; requestedByUserId: string | null; supplierId?: string | null; supplierName?: string | null; newId?: string },
): Record<string, unknown> {
  return {
    sourcingStatus: 'requested',
    costRequestId: input.newId ?? randomUUID(),
    requestSeq: (row.requestSeq ?? 0) + 1,
    requestedAt: input.now,
    requestedByUserId: input.requestedByUserId,
    requestSupplierId: input.supplierId ?? null,
    requestSupplierName: input.supplierName ?? null,
    answeredAt: null,
    answeredByUserId: null,
    declineReason: null,
    proposedAmount: null,
    proposedAnswer: null,
    lastAnswerHash: null,
    cancelReason: null,
  }
}
