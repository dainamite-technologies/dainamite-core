// Supplier-sourcing step 9 (MODIFIED from the step-1 characterization): the quote DELETE route no longer writes
// itself; it runs the mutation guards and hands the write to `cpqQuotingService.deleteQuote` (aggregate lock, terminal
// refusal, soft-delete and request cancellation live there, see cpqQuotingService.test.ts).
const deleteQuote = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()

jest.mock('../../../context', () => ({
  resolveCpqRouteContext: jest.fn(async () => ({
    auth: { sub: '77777777-7777-4777-8777-777777777777', tenantId: 't-1' }, organizationId: 'org-1', tenantId: 't-1',
  })),
}))
jest.mock('../../../resolveQuotingService', () => ({ resolveQuotingService: () => ({ deleteQuote }) }))
jest.mock('../../../_helpers/quoteMutationGuard', () => ({
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { DELETE, openApi } from '../route'
import { QuotingError } from '../../../../services/cpqQuotingService'

const params = { params: Promise.resolve({ quoteId: 'cpq-1' }) }
const del = () => DELETE(new Request('http://localhost/api/cpq/quotes/cpq-1', { method: 'DELETE' }), params)

beforeEach(() => {
  deleteQuote.mockReset().mockResolvedValue({ ok: true })
  runAfterSuccess.mockReset()
  runCpqMutationGuards.mockReset().mockResolvedValue({ ok: true, runAfterSuccess })
})

describe('DELETE /api/cpq/quotes/{quoteId}', () => {
  it('runs the guards, deletes through the service in the caller scope and answers { ok: true }', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(runCpqMutationGuards).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      resourceKind: 'cpq.quote', resourceId: 'cpq-1', operation: 'delete', mutationPayload: { action: 'delete' },
    })
    expect(deleteQuote).toHaveBeenCalledWith('cpq-1', { organizationId: 'org-1', tenantId: 't-1' }, '77777777-7777-4777-8777-777777777777')
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it.each(['accepted', 'rejected', 'cancelled'])('keeps the 409 for a quote in %s status', async (status) => {
    deleteQuote.mockRejectedValue(new QuotingError(409, `Cannot delete a quote in '${status}' status`))
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain(status)
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown quote', async () => {
    deleteQuote.mockRejectedValue(new QuotingError(404, 'Quote not found'))
    expect((await del()).status).toBe(404)
  })

  it('returns the guard response and writes nothing when a mutation guard blocks', async () => {
    const blocked = new Response(JSON.stringify({ error: 'blocked' }), { status: 422 })
    runCpqMutationGuards.mockResolvedValue({ ok: false, response: blocked })
    const res = await del()
    expect(res.status).toBe(422)
    expect(deleteQuote).not.toHaveBeenCalled()
  })

  it('exports openApi for GET, PATCH and DELETE, and requires the manage feature', async () => {
    expect(Object.keys(openApi.methods)).toEqual(expect.arrayContaining(['GET', 'PATCH', 'DELETE']))
    const { metadata } = await import('../route')
    expect(metadata.DELETE.requireFeatures).toEqual(['cpq.quotes.manage'])
  })
})
