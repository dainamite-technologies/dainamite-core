/**
 * cpqInventoryService throws plain `{ status, error }` objects (404 not found,
 * 409 invalid transition). The inventory routes must pass that status through
 * instead of collapsing it into a 500.
 */
const service: Record<string, jest.Mock> = {}
const ctx = {
  auth: { sub: 'user', tenantId: 'tenant' },
  tenantId: 'tenant',
  organizationId: 'org',
  container: { resolve: () => service },
}
jest.mock('../context', () => ({ resolveCpqRouteContext: jest.fn(async () => ctx) }))

import { GET as getSubscriptions, DELETE as deleteSubscription } from '../inventory/subscriptions/route'
import { GET as getAssets } from '../inventory/assets/route'
import { DELETE as deleteSubscriptionItem } from '../inventory/subscription-items/route'
import { POST as transitionSubscription } from '../inventory/subscriptions/status/route'
import { POST as transitionAsset } from '../inventory/assets/status/route'

const ID = '11111111-1111-4111-8111-111111111111'
const get = (path: string) => new Request(`http://localhost/api/cpq/inventory/${path}`)
const json = (path: string, method: string, body: unknown) =>
  new Request(`http://localhost/api/cpq/inventory/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  for (const key of Object.keys(service)) delete service[key]
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

it.each([
  ['subscription GET ?id=', 'getSubscription', () => getSubscriptions(get(`subscriptions?id=${ID}`))],
  ['asset GET ?id=', 'getAsset', () => getAssets(get(`assets?id=${ID}`))],
  ['subscription DELETE', 'deleteSubscription', () => deleteSubscription(json('subscriptions', 'DELETE', { id: ID }))],
  ['subscription item DELETE', 'deleteSubscriptionItem', () => deleteSubscriptionItem(json('subscription-items', 'DELETE', { id: ID }))],
])('%s returns 404 when the service reports not found', async (_label, method, call) => {
  service[method] = jest.fn().mockRejectedValue({ status: 404, error: 'Not found' })
  const response = await call()
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})

it.each([
  ['subscription', 'transitionSubscriptionStatus', transitionSubscription, 'subscriptions/status'],
  ['asset', 'transitionAssetStatus', transitionAsset, 'assets/status'],
])('%s status transition keeps 409 and now returns 404', async (_label, method, handler, path) => {
  service[method] = jest.fn().mockRejectedValue({ status: 409, error: 'Invalid transition' })
  expect((await handler(json(path, 'POST', { id: ID, targetStatus: 'active' }))).status).toBe(409)
  service[method] = jest.fn().mockRejectedValue({ status: 404, error: 'Not found' })
  expect((await handler(json(path, 'POST', { id: ID, targetStatus: 'active' }))).status).toBe(404)
})

it('still returns a generic 500 for unexpected errors', async () => {
  service.getSubscription = jest.fn().mockRejectedValue(new Error('db down'))
  const response = await getSubscriptions(get(`subscriptions?id=${ID}`))
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Internal error' })
})
