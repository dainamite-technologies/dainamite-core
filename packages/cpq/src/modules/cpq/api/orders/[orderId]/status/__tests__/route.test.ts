const transitionOrderStatus = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()

jest.mock('../../../../context', () => ({
  // Auth / organization present in every case here → no context error.
  cpqContextError: jest.fn(() => null),
  resolveCpqRouteContext: jest.fn().mockResolvedValue({
    auth: { sub: '77777777-7777-4777-8777-777777777777', tenantId: 't-1' },
    organizationId: 'org-1',
    tenantId: 't-1',
    container: { resolve: (name: string) => (name === 'cpqOrderService' ? { transitionOrderStatus } : undefined) },
  }),
}))

jest.mock('../../../../_helpers/quoteMutationGuard', () => ({
  CPQ_ORDER_RESOURCE_KIND: 'cpq.order',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { POST } from '../route'

const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ orderId: ORDER_ID }) }

function postStatus(targetStatus: string): Request {
  return new Request(`http://localhost/api/cpq/orders/${ORDER_ID}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetStatus }),
  })
}

describe('POST /api/cpq/orders/{orderId}/status — mutation guards', () => {
  beforeEach(() => {
    transitionOrderStatus.mockReset()
    transitionOrderStatus.mockResolvedValue({ id: ORDER_ID })
    runAfterSuccess.mockReset()
    runCpqMutationGuards.mockReset()
  })

  it('a transition to active runs the guards as an activation (no bypass of /activate)', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    const res = await POST(postStatus('active'), params)
    expect(res.status).toBe(200)
    expect(runCpqMutationGuards).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      resourceKind: 'cpq.order',
      resourceId: ORDER_ID,
      operation: 'update',
      mutationPayload: { action: 'activate', orderId: ORDER_ID, targetStatus: 'active' },
    })
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('a blocking guard stops a transition to active', async () => {
    const body = { error: 'Activating earlier is blocked.', code: 'some_addon.activation_blocked' }
    runCpqMutationGuards.mockResolvedValue({ ok: false, response: Response.json(body, { status: 422 }) })
    const res = await POST(postStatus('active'), params)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual(body)
    expect(transitionOrderStatus).not.toHaveBeenCalled()
  })

  it('other transitions run the guards with the transition action', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    await POST(postStatus('cancelled'), params)
    expect(runCpqMutationGuards.mock.calls[0][2]).toMatchObject({
      mutationPayload: { action: 'transition', targetStatus: 'cancelled' },
    })
  })
})
