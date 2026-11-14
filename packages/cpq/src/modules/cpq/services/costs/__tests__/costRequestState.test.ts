import { cancelRequestPatch, isRequestOpen, openRequestPatch } from '../costRequestState'
import { REQUEST_HISTORY_CAP } from '../costSourcing'

const NOW = new Date('2026-03-02T10:00:00Z')
const row = { sourcingStatus: 'requested', costRequestId: 'r-1', requestSeq: 2, requestedAt: new Date('2026-03-01T09:00:00Z'), requestedByUserId: 'u1', requestSupplierId: 's1' }

it('isRequestOpen needs the requested status and a request id', () => {
  expect(isRequestOpen(row)).toBe(true)
  expect(isRequestOpen({ sourcingStatus: 'requested', costRequestId: null })).toBe(false)
  for (const status of ['not_requested', 'answered', 'declined', 'cancelled']) expect(isRequestOpen({ ...row, sourcingStatus: status })).toBe(false)
})

it('cancelRequestPatch closes into the history without amounts and keeps the request id and seq', () => {
  const patch = cancelRequestPatch({ ...row, requestHistory: [{ costRequestId: 'r-0' }] }, { reason: 'manual_value', now: NOW, closedByUserId: 'u2' })
  expect(patch).toMatchObject({ sourcingStatus: 'cancelled', cancelReason: 'manual_value', proposedAmount: null, proposedAnswer: null, lastAnswerHash: null })
  expect(patch).not.toHaveProperty('costRequestId')
  expect(patch).not.toHaveProperty('requestSeq')
  expect(patch.requestHistory).toEqual([{ costRequestId: 'r-0' }, {
    costRequestId: 'r-1', requestSeq: 2, requestedAt: '2026-03-01T09:00:00.000Z', requestedByUserId: 'u1', closedAt: NOW.toISOString(),
    closedByUserId: 'u2', outcome: 'cancelled', reason: 'manual_value', supplierId: 's1',
  }])
})

it('cancelRequestPatch drops the oldest history entries beyond the cap', () => {
  const history = Array.from({ length: REQUEST_HISTORY_CAP }, (_, index) => ({ costRequestId: `old-${index}` }))
  const out = cancelRequestPatch({ ...row, requestHistory: history }, { reason: 'quote_closed', now: NOW, closedByUserId: null }).requestHistory as Array<{ costRequestId: string }>
  expect(out).toHaveLength(REQUEST_HISTORY_CAP)
  expect(out[0].costRequestId).toBe('old-1')
  expect(out[out.length - 1].costRequestId).toBe('r-1')
})

it('openRequestPatch assigns a new id, seq + 1 (1 for the first) and clears the previous answer state', () => {
  const first = openRequestPatch({ requestSeq: null }, { now: NOW, requestedByUserId: 'u3' })
  expect(first).toMatchObject({ sourcingStatus: 'requested', requestSeq: 1, requestedAt: NOW, requestedByUserId: 'u3', requestSupplierId: null, requestSupplierName: null, cancelReason: null, proposedAmount: null, lastAnswerHash: null, answeredAt: null, declineReason: null })
  expect(first.costRequestId).toEqual(expect.any(String))
  const next = openRequestPatch({ requestSeq: 4 }, { now: NOW, requestedByUserId: null, supplierId: 's9', supplierName: 'N', newId: 'fixed' })
  expect(next).toMatchObject({ costRequestId: 'fixed', requestSeq: 5, requestedByUserId: null, requestSupplierId: 's9', requestSupplierName: 'N' })
  expect(openRequestPatch({ requestSeq: 4 }, { now: NOW, requestedByUserId: null }).costRequestId).not.toBe(first.costRequestId)
})
