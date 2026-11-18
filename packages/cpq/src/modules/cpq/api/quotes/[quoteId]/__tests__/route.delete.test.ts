// The quote DELETE route runs the registered mutation guards first, then deletes the sales quote through
// `sales.quotes.delete` and soft-deletes the CPQ rows (crossModuleCommandRoutes.test.ts covers that flow). This file
// pins the guard contract and the cost-plus part: open supplier cost requests are cancelled (`quote_closed`).
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost } from '../../../../data/entities'

const execute = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()
const em = { findOne: jest.fn(), find: jest.fn(), flush: jest.fn() }
const ctx = {
  auth: { sub: '77777777-7777-4777-8777-777777777777', tenantId: 't-1' }, organizationId: 'org-1', tenantId: 't-1',
  organizationScope: null, em,
  container: { resolve: (name: string) => (name === 'commandBus' ? { execute } : {}) },
}

jest.mock('../../../context', () => ({
  cpqContextError: jest.requireActual('../../../context').cpqContextError,
  resolveCpqRouteContext: jest.fn(async () => ctx),
}))
jest.mock('../../../_helpers/quoteMutationGuard', () => ({
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))
const publish = jest.fn()
jest.mock('../../../../services/costs/sourcingPublisher', () => ({ createSourcingPublisher: () => publish }))

import { DELETE, openApi } from '../route'

const params = { params: Promise.resolve({ quoteId: 'cpq-1' }) }
const del = () => DELETE(new Request('http://localhost/api/cpq/quotes/cpq-1', { method: 'DELETE' }), params)

let config: Record<string, unknown>
let openRequest: Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  config = { id: 'cpq-1', quoteId: 'sq-1', organizationId: 'org-1', tenantId: 't-1', cpqStatus: 'draft', deletedAt: null }
  openRequest = {
    id: 'cost-1', quoteConfigurationId: 'cpq-1', quoteLineId: 'L1', costKey: 'transport', costRequestId: 'req-1', requestSeq: 1,
    sourcingStatus: 'requested', organizationId: 'org-1', tenantId: 't-1',
  }
  em.findOne.mockImplementation(async (entity: unknown) => {
    if (entity === CpqQuoteConfiguration) return config.deletedAt ? null : config
    if (entity === SalesQuote) return { id: 'sq-1' }
    return null
  })
  em.find.mockImplementation(async (entity: unknown) => {
    if (entity === CpqQuoteLineConfiguration) return [{ id: 'lc1', deletedAt: null }]
    if (entity === CpqQuoteLineCost) return [openRequest]
    return []
  })
  execute.mockResolvedValue({ result: { quoteId: 'sq-1' }, logEntry: null })
  runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
})

describe('DELETE /api/cpq/quotes/{quoteId}', () => {
  it('runs the guards, deletes, cancels open cost requests, publishes after the flush and answers { ok: true }', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(runCpqMutationGuards).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      resourceKind: 'cpq.quote', resourceId: 'cpq-1', operation: 'delete', mutationPayload: { action: 'delete' },
    })
    expect(execute).toHaveBeenCalledWith('sales.quotes.delete', expect.objectContaining({ input: { body: { id: 'sq-1' } } }))
    expect(openRequest.sourcingStatus).not.toBe('requested')
    expect(config.deletedAt).toBeInstanceOf(Date)
    expect(publish).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'request_cancelled', costRequestId: 'req-1', reason: 'quote_closed' })],
      { id: 'cpq-1', tenantId: 't-1', organizationId: 'org-1' },
    )
    expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0])
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('returns the guard response and writes nothing when a mutation guard blocks', async () => {
    const blocked = new Response(JSON.stringify({ error: 'blocked' }), { status: 422 })
    runCpqMutationGuards.mockResolvedValue({ ok: false, response: blocked })
    const res = await del()
    expect(res.status).toBe(422)
    expect(execute).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['accepted', 'rejected', 'cancelled'])('answers 409 for a quote in %s status without running afterSuccess', async (status) => {
    config.cpqStatus = status
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain(status)
    expect(execute).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('exports openApi for GET, PATCH and DELETE, and requires the manage feature', async () => {
    expect(Object.keys(openApi.methods)).toEqual(expect.arrayContaining(['GET', 'PATCH', 'DELETE']))
    const { metadata } = await import('../route')
    expect(metadata.DELETE.requireFeatures).toEqual(['cpq.quotes.manage'])
  })
})
