/**
 * Recalculate route contract.
 *
 * Route-level `requireFeatures` is enforced by the API dispatcher, so the
 * permission contract is pinned through the exported `metadata`; the handler
 * contract (body → guard → service call) is pinned with mocked collaborators.
 */

const recalculate = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()

jest.mock('../../../../context', () => ({
  resolveCpqRouteContext: jest.fn().mockResolvedValue({
    auth: { sub: 'user-1', tenantId: 't-1' },
    organizationId: 'org-1',
    tenantId: 't-1',
  }),
}))

jest.mock('../../../../resolveQuotingService', () => ({
  resolveQuotingService: () => ({ recalculate }),
}))

jest.mock('../../../../_helpers/quoteMutationGuard', () => ({
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { metadata, openApi, POST } from '../route'

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/cpq/quotes/cpq-1/recalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ quoteId: 'cpq-1' }) }

describe('POST /api/cpq/quotes/{quoteId}/recalculate', () => {
  beforeEach(() => {
    recalculate.mockReset()
    recalculate.mockResolvedValue({ id: 'cpq-1' })
    runAfterSuccess.mockReset()
    runCpqMutationGuards.mockReset()
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
  })

  it('requires an authenticated user with cpq.quotes.manage (view-only users get 403 from the dispatcher)', () => {
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.manage'] })
  })

  it('documents the route in openApi', () => {
    expect(openApi.methods?.POST?.errors).toEqual(expect.arrayContaining([expect.objectContaining({ status: 409 })]))
    expect(openApi.methods?.POST?.requestBody).toBeDefined()
  })

  it('runs the mutation guards before a saved recalculation and their after-success hooks after it', async () => {
    const res = await POST(postRequest({ save: true }), params)

    expect(res.status).toBe(200)
    expect(runCpqMutationGuards).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      expect.objectContaining({ resourceKind: 'cpq.quote', resourceId: 'cpq-1', operation: 'custom' }),
    )
    expect(recalculate).toHaveBeenCalledWith(
      'cpq-1',
      expect.objectContaining({ save: true }),
      { organizationId: 'org-1', tenantId: 't-1' },
    )
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('skips the guards for a dry run (save=false)', async () => {
    await POST(postRequest({ save: false }), params)

    expect(runCpqMutationGuards).not.toHaveBeenCalled()
    expect(recalculate).toHaveBeenCalled()
  })

  it('returns the guard response and does not recalculate when a guard blocks', async () => {
    runCpqMutationGuards.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Quote awaits approval' }, { status: 423 }),
    })

    const res = await POST(postRequest({ save: true }), params)

    expect(res.status).toBe(423)
    expect(recalculate).not.toHaveBeenCalled()
  })
})
