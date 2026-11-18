import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { reconfirmOrderLineCostCommand } from '../order-line-costs'

const orderId = '11111111-1111-4111-8111-111111111111', orderLineCostId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'

function setup() {
  const service = { reconfirm: jest.fn(async () => ({ ok: true })) }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}

it('uses the authenticated actor and scope and the immutable feature IDs (orders.manage + costs.manage)', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await reconfirmOrderLineCostCommand.execute({ orderId, orderLineCostId, patch: { unitAmount: 270, note: 'x' } }, ctx)
  expect(service.reconfirm).toHaveBeenCalledWith(orderId, orderLineCostId, { unitAmount: 270, note: 'x' }, actor, { tenantId, organizationId })
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.orders.manage', 'cpq.costs.manage'], { tenantId, organizationId })
})

it('refuses missing permissions, a missing organization and a user-less API key before any write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  const input = { orderId, orderLineCostId, patch: { note: 'x' } }
  userHasAllFeatures.mockResolvedValue(false)
  await expect(reconfirmOrderLineCostCommand.execute(input, ctx)).rejects.toMatchObject({ status: 403 })
  userHasAllFeatures.mockResolvedValue(true)
  await expect(reconfirmOrderLineCostCommand.execute(input, { ...ctx, selectedOrganizationId: null })).rejects.toMatchObject({ status: 403 })
  await expect(reconfirmOrderLineCostCommand.execute(input, { ...ctx, auth: { sub: 'api_key:k', tenantId } } as unknown as CommandRuntimeContext)).rejects.toMatchObject({ status: 403 })
  expect(service.reconfirm).not.toHaveBeenCalled()
})

it('rejects invalid shapes (empty patch, unknown or immutable fields, bad ids) before reaching the service', async () => {
  const { ctx, service } = setup()
  await expect(reconfirmOrderLineCostCommand.execute({ orderId, orderLineCostId, patch: {} }, ctx)).rejects.toThrow()
  await expect(reconfirmOrderLineCostCommand.execute({ orderId, orderLineCostId, patch: { costKey: 'x' } } as never, ctx)).rejects.toThrow()
  await expect(reconfirmOrderLineCostCommand.execute({ orderId: 'nope', orderLineCostId, patch: { note: 'x' } }, ctx)).rejects.toThrow()
  expect(service.reconfirm).not.toHaveBeenCalled()
})

it('is not undoable and not replayable; its log carries ids, statuses, roles and the cost key only', async () => {
  expect(reconfirmOrderLineCostCommand.isUndoable).toBe(false)
  expect(reconfirmOrderLineCostCommand.undo).toBeUndefined()
  const audit = { id: orderLineCostId, orderLineId: 'ol-1', costKey: 'tail', role: 'price_basis', origin: 'carried', valueStatus: 'confirmed', valueOrigin: 'manual' }
  const result = { orderId, cost: { id: orderLineCostId, unitAmount: '7777.7700', supplierName: 'SecretSupplier', note: 'secret' }, audit: { before: { ...audit, valueOrigin: 'catalog' }, after: audit } }
  const log = await reconfirmOrderLineCostCommand.buildLog!({ input: { orderId, orderLineCostId, patch: { unitAmount: 1500, note: 'secret' } }, result, ctx: setup().ctx, snapshots: {} } as never)
  expect(log).toMatchObject({ resourceKind: 'cpq.order_line_cost', resourceId: orderLineCostId, replayable: false })
  const json = JSON.stringify(log)
  for (const leak of ['7777', 'SecretSupplier', 'secret', '1500']) expect(json).not.toContain(leak)
  expect(json).toContain('tail')
})
