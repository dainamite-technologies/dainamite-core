/**
 * Recalculate route contract.
 *
 * Route-level `requireFeatures` is enforced by the API dispatcher, so the
 * permission contract is pinned through the exported `metadata`; the handler
 * contract (body → service call) is pinned with a mocked route context.
 */

const recalculate = jest.fn()

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

import { metadata, POST } from '../route'

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/cpq/quotes/cpq-1/recalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/cpq/quotes/{quoteId}/recalculate', () => {
  beforeEach(() => {
    recalculate.mockReset()
    recalculate.mockResolvedValue({ id: 'cpq-1' })
  })

  it('requires an authenticated user with cpq.quotes.view', () => {
    expect(metadata.POST).toEqual({ requireAuth: true, requireFeatures: ['cpq.quotes.view'] })
  })

  it('passes the save flag and tenant scope to the quoting service', async () => {
    const res = await POST(postRequest({ save: true }), { params: Promise.resolve({ quoteId: 'cpq-1' }) })

    expect(res.status).toBe(200)
    expect(recalculate).toHaveBeenCalledWith(
      'cpq-1',
      expect.objectContaining({ save: true }),
      { organizationId: 'org-1', tenantId: 't-1' },
    )
  })
})
