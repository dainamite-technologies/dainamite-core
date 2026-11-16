const activateOrder = jest.fn()
const runCpqMutationGuards = jest.fn()
const runAfterSuccess = jest.fn()

jest.mock('../../../../context', () => ({
  resolveCpqRouteContext: jest.fn().mockResolvedValue({
    auth: { sub: '77777777-7777-4777-8777-777777777777', tenantId: 't-1' },
    organizationId: 'org-1',
    tenantId: 't-1',
    container: { resolve: (name: string) => (name === 'cpqOrderService' ? { activateOrder } : undefined) },
  }),
}))

jest.mock('../../../../_helpers/quoteMutationGuard', () => ({
  CPQ_ORDER_RESOURCE_KIND: 'cpq.order',
  runCpqMutationGuards: (...args: unknown[]) => runCpqMutationGuards(...args),
}))

import { POST, openApi } from '../route'

const ORDER_ID = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ orderId: ORDER_ID }) }

function postActivate(): Request {
  return new Request(`http://localhost/api/cpq/orders/${ORDER_ID}/activate`, { method: 'POST' })
}

describe('POST /api/cpq/orders/{orderId}/activate — mutation guards', () => {
  beforeEach(() => {
    activateOrder.mockReset()
    activateOrder.mockResolvedValue({ id: ORDER_ID, cpqStatus: 'active' })
    runAfterSuccess.mockReset()
    runCpqMutationGuards.mockReset()
  })

  it('runs the guards with the activate action, activates, then runs the after-success hooks', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })

    const res = await POST(postActivate(), params)

    expect(res.status).toBe(200)
    expect(runCpqMutationGuards).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      resourceKind: 'cpq.order',
      resourceId: ORDER_ID,
      operation: 'update',
      mutationPayload: { action: 'activate', orderId: ORDER_ID },
    })
    expect(activateOrder).toHaveBeenCalledWith(ORDER_ID, { organizationId: 'org-1', tenantId: 't-1' })
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(runCpqMutationGuards.mock.invocationCallOrder[0]).toBeLessThan(activateOrder.mock.invocationCallOrder[0])
  })

  it('passes a blocking guard’s status and body through and does not activate', async () => {
    const body = {
      error: 'Activating earlier is blocked.',
      code: 'some_addon.activation_blocked',
      earliestActivationDate: '2026-11-20',
    }
    runCpqMutationGuards.mockResolvedValue({ ok: false, response: Response.json(body, { status: 422 }) })

    const res = await POST(postActivate(), params)

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual(body)
    expect(activateOrder).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('does not run after-success hooks when the activation fails', async () => {
    runCpqMutationGuards.mockResolvedValue({ ok: true, runAfterSuccess })
    activateOrder.mockRejectedValue(Object.assign(new Error('Cannot activate'), { name: 'OrderError', status: 409 }))

    const res = await POST(postActivate(), params)

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('documents the guard 422 in openApi', () => {
    const errors = openApi.methods?.POST?.errors ?? []
    expect(errors.map((e) => e.status)).toEqual(expect.arrayContaining([404, 409, 422]))
  })
})
