const execute = jest.fn(), guards = jest.fn(), after = jest.fn(), enabled = jest.fn(), viewCosts = jest.fn(), readOrderCosts = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em: { tag: 'em' },
  container: { resolve: (name: string) => ({ commandBus: { execute }, cpqCostService: { enabled } } as Record<string, unknown>)[name] } }
jest.mock('../../../../../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))
jest.mock('../../../../../_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: (...args: unknown[]) => guards(...args),
  CPQ_ORDER_LINE_COST_RESOURCE_KIND: 'cpq.order_line_cost',
}))
jest.mock('../../../../../_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => viewCosts(...args) }))
jest.mock('../../../../../../services/costs/orderCostView', () => ({
  ...jest.requireActual('../../../../../../services/costs/orderCostView'),
  readOrderCosts: (...args: unknown[]) => readOrderCosts(...args),
}))
import { PATCH, metadata, openApi } from '../route'
import { QuotingError } from '../../../../../../services/cpqQuotingService'

const orderId = '11111111-1111-4111-8111-111111111111', orderLineCostId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ orderId, orderLineCostId }) }
const request = (payload?: unknown) => new Request('http://localhost/api/cpq/orders/x/costs/y', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) })
const fullCost = { id: orderLineCostId, costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', unitAmount: '270', totalAmount: '540', supplierName: 'Acme', note: 'secret', supplierQuoteRef: 'R' }

beforeEach(() => {
  jest.clearAllMocks()
  enabled.mockResolvedValue(true)
  viewCosts.mockResolvedValue(true)
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after })
  execute.mockResolvedValue({ result: { orderId, cost: fullCost, audit: {} }, logEntry: null })
  readOrderCosts.mockResolvedValue({ orderId, margin: { mrcMargin: 60 } })
})

it('declares the immutable features (orders.manage + costs.manage), never requireRoles, and documents the route with its errors', () => {
  expect(metadata.PATCH.requireFeatures).toEqual(['cpq.orders.manage', 'cpq.costs.manage'])
  expect(JSON.stringify(metadata)).not.toContain('requireRoles')
  expect(openApi.methods.PATCH).toBeDefined()
  const docs = JSON.stringify(openApi.methods.PATCH)
  for (const code of ['ORDER_ACTIVATED', 'ORDER_CANCELLED', 'CURRENCY_NO_RATE', 'VALIDITY_EVIDENCE_REQUIRED']) expect(docs).toContain(code)
})

it('dispatches the command with the path ids and the patch, runs the guards with resource kind cpq.order_line_cost, then after-success', async () => {
  const response = await PATCH(request({ unitAmount: 270, note: 'carrier mail' }), params)
  expect(response.status).toBe(200)
  expect(guards).toHaveBeenCalledWith(ctx, expect.anything(), expect.objectContaining({ resourceKind: 'cpq.order_line_cost', resourceId: orderLineCostId, operation: 'update' }))
  expect(execute).toHaveBeenCalledWith('cpq.order_line_cost.reconfirm', expect.objectContaining({ input: { orderId, orderLineCostId, patch: { unitAmount: 270, note: 'carrier mail' } } }))
  expect(after).toHaveBeenCalledTimes(1)
  expect(await response.json()).toEqual({ cost: fullCost, orderMargin: { mrcMargin: 60 } })
})

it('a guard may adjust the patch but never the path identifiers', async () => {
  guards.mockResolvedValue({ ok: true, runAfterSuccess: after, modifiedPayload: { note: 'by guard', orderId: 'x', orderLineCostId: 'y' } })
  await PATCH(request({ unitAmount: 270, note: 'n' }), params)
  expect(execute.mock.calls[0][1].input).toEqual({ orderId, orderLineCostId, patch: { unitAmount: 270, note: 'by guard' } })
})

it('I-4: without cpq.costs.view the response is status-only, with no value, supplier, note or margin (the margin is never even read)', async () => {
  viewCosts.mockResolvedValue(false)
  const body = await (await PATCH(request({ unitAmount: 270, note: 'n' }), params)).json()
  expect(body).toEqual({ cost: { id: orderLineCostId, costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed' } })
  const json = JSON.stringify(body)
  for (const leak of ['270', '540', 'Acme', 'secret', 'margin']) expect(json).not.toContain(leak)
  expect(readOrderCosts).not.toHaveBeenCalled()
})

it('toggle off: 404 before any guard or command', async () => {
  enabled.mockResolvedValue(false)
  expect((await PATCH(request({ note: 'x' }), params)).status).toBe(404)
  expect(guards).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('a guard rejection is returned as is and nothing is executed', async () => {
  const blocked = new Response(JSON.stringify({ error: 'blocked' }), { status: 422 })
  guards.mockResolvedValue({ ok: false, response: blocked })
  expect(await PATCH(request({ note: 'x' }), params)).toBe(blocked)
  expect(execute).not.toHaveBeenCalled()
})

it('maps the service refusals: 409 ORDER_ACTIVATED / ORDER_CANCELLED, 422 CURRENCY_NO_RATE with from / to, 404; validation errors are 400 and run no guard', async () => {
  const cases: Array<[QuotingError, number, Record<string, unknown>]> = [
    [new QuotingError(409, 'ORDER_ACTIVATED'), 409, { error: 'ORDER_ACTIVATED' }],
    [new QuotingError(409, 'ORDER_CANCELLED'), 409, { error: 'ORDER_CANCELLED' }],
    [new QuotingError(422, 'CURRENCY_NO_RATE', undefined, { from: 'USD', to: 'EUR' }), 422, { error: 'CURRENCY_NO_RATE', from: 'USD', to: 'EUR' }],
    [new QuotingError(404, 'Order line cost not found'), 404, { error: 'Order line cost not found' }],
  ]
  for (const [error, status, expected] of cases) {
    execute.mockRejectedValueOnce(error)
    const response = await PATCH(request({ note: 'x' }), params)
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject(expected)
  }
  guards.mockClear()
  expect((await PATCH(request({}), params)).status).toBe(400)
  expect((await PATCH(request({ costKey: 'x' }), params)).status).toBe(400)
  expect((await PATCH(request({ note: 'x' }), { params: Promise.resolve({ orderId: 'nope', orderLineCostId }) })).status).toBe(400)
  expect(guards).not.toHaveBeenCalled()
})
