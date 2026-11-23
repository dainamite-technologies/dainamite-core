const activateOrder = jest.fn(), transitionOrderStatus = jest.fn()
const ctx = { auth: { sub: 'user', tenantId: 'tenant' }, tenantId: 'tenant', organizationId: 'org',
  container: { resolve: (name: string) => ({ cpqOrderService: { activateOrder, transitionOrderStatus } } as Record<string, unknown>)[name] } }
jest.mock('../context', () => ({ cpqContextError: jest.requireActual('../context').cpqContextError, resolveCpqRouteContext: jest.fn(async () => ctx) }))
import { POST as activate, openApi } from '../orders/[orderId]/activate/route'
import { POST as transition } from '../orders/[orderId]/status/route'
import { OrderError } from '../../services/cpqOrderService'

const orderId = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ orderId }) }
const lines = [{ quoteLineId: 'ql-1', subscriptionItemId: 'item-1', costKeys: ['tail'] }]
const staleCosts = () => new OrderError(409, 'COST_SOURCE_CHANGED', { lines })

beforeEach(() => jest.clearAllMocks())

it('activate answers 409 COST_SOURCE_CHANGED with the stale lines in the body', async () => {
  activateOrder.mockRejectedValue(staleCosts())
  const res = await activate(new Request('http://localhost/x', { method: 'POST' }), params)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'COST_SOURCE_CHANGED', lines })
})

it('the status route activating the order answers the same body', async () => {
  transitionOrderStatus.mockRejectedValue(staleCosts())
  const res = await transition(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ targetStatus: 'active' }), headers: { 'Content-Type': 'application/json' } }), params)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'COST_SOURCE_CHANGED', lines })
})

it('an error without details keeps its plain body, and the activate openApi names the new refusal', async () => {
  activateOrder.mockRejectedValue(new OrderError(409, "Cannot activate order in 'active' status"))
  const res = await activate(new Request('http://localhost/x', { method: 'POST' }), params)
  expect(await res.json()).toEqual({ error: "Cannot activate order in 'active' status" })
  expect(JSON.stringify(openApi.methods.POST)).toContain('COST_SOURCE_CHANGED')
})
