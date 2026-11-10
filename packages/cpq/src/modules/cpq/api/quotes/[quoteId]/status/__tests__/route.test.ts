const transitionStatus = jest.fn()
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
  resolveQuotingService: () => ({ transitionStatus }),
}))

jest.mock('../../../../_helpers/quoteMutationGuard', () => ({
  CPQ_QUOTE_RESOURCE_KIND: 'cpq.quote',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { POST } from '../route'

function postStatus(targetStatus: string): Request {
  return new Request('http://localhost/api/cpq/quotes/cpq-1/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetStatus }),
  })
}

const params = { params: Promise.resolve({ quoteId: 'cpq-1' }) }

describe('POST /api/cpq/quotes/{quoteId}/status — mutation guards', () => {
  beforeEach(() => {
    transitionStatus.mockReset()
    transitionStatus.mockResolvedValue({ id: 'cpq-1', cpqStatus: 'with_customer' })
    runAfterSuccess.mockReset()
    runCpqMutationGuards.mockReset()
  })

  it('transitions when the guards pass and then runs their after-success hooks', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })

    const res = await POST(postStatus('with_customer'), params)

    expect(res.status).toBe(200)
    expect(runCpqMutationGuards).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Request),
      {
        resourceKind: 'cpq.quote',
        resourceId: 'cpq-1',
        operation: 'custom',
        mutationPayload: { action: 'transition_status', targetStatus: 'with_customer' },
      },
    )
    expect(transitionStatus).toHaveBeenCalledWith('cpq-1', 'with_customer', { organizationId: 'org-1', tenantId: 't-1' }, 'user-1')
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('returns the guard response and leaves the status unchanged when a project guard blocks', async () => {
    runCpqMutationGuards.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Discount above 15% needs approval' }, { status: 422 }),
    })

    const res = await POST(postStatus('with_customer'), params)

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'Discount above 15% needs approval' })
    expect(transitionStatus).not.toHaveBeenCalled()
  })
})
