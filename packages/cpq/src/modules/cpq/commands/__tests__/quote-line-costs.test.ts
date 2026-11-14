import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createQuoteLineCostCommand, updateQuoteLineCostCommand, deleteQuoteLineCostCommand } from '../quote-line-costs'

const quoteId = '11111111-1111-4111-8111-111111111111', costId = '22222222-2222-4222-8222-222222222222', lineId = '66666666-6666-4666-8666-666666666666'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'
const cost = { quoteLineId: lineId, name: 'Special build', role: 'margin_only' as const, costType: 'nrc' as const, source: 'fixed' as const, costModel: 'flat' as const, unitAmount: 1500 }

function setup() {
  const service = { createCost: jest.fn(), updateCost: jest.fn(), deleteCost: jest.fn() }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}

it('uses the authenticated actor and scope and the immutable cost feature IDs', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await createQuoteLineCostCommand.execute({ quoteId, cost }, ctx)
  expect(service.createCost).toHaveBeenCalledWith(quoteId, cost, actor, { tenantId, organizationId })
  await updateQuoteLineCostCommand.execute({ quoteId, costId, patch: { note: 'x' } }, ctx)
  expect(service.updateCost).toHaveBeenCalledWith(quoteId, costId, { note: 'x' }, actor, { tenantId, organizationId })
  await deleteQuoteLineCostCommand.execute({ quoteId, costId, expectedRevision: 2 }, ctx)
  expect(service.deleteCost).toHaveBeenCalledWith(quoteId, costId, actor, { tenantId, organizationId }, 2)
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.quotes.manage', 'cpq.costs.manage'], { tenantId, organizationId })
})

it('refuses missing permissions and a missing organization before any service write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost }, ctx)).rejects.toMatchObject({ status: 403 })
  userHasAllFeatures.mockResolvedValue(true)
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost }, { ...ctx, selectedOrganizationId: null })).rejects.toMatchObject({ status: 403 })
  const orphan = { ...ctx, auth: { sub: 'api_key:k', tenantId } } as unknown as CommandRuntimeContext
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost }, orphan)).rejects.toMatchObject({ status: 403 })
  expect(service.createCost).not.toHaveBeenCalled()
})

it('is not undoable and its log carries ids, statuses, roles and the cost key only', async () => {
  for (const command of [createQuoteLineCostCommand, updateQuoteLineCostCommand, deleteQuoteLineCostCommand]) {
    expect(command.isUndoable).toBe(false)
    expect(command.undo).toBeUndefined()
  }
  const result = {
    cost: { id: costId, unitAmount: '7777.7700', supplierName: 'SecretSupplier', note: 'secret' },
    margin: { contractMargin: 4321 }, pricingRevision: 5,
    audit: {
      before: null,
      after: { id: costId, quoteLineId: lineId, costKey: 'manual:ab12cd34', role: 'margin_only', origin: 'manual', valueStatus: 'confirmed', valueOrigin: 'manual' },
    },
  }
  const log = await createQuoteLineCostCommand.buildLog!({ input: { quoteId, cost }, result, ctx: setup().ctx, snapshots: {} } as never)
  expect(log).toMatchObject({ resourceKind: 'cpq.quote_line_cost', resourceId: costId, replayable: false })
  const json = JSON.stringify(log)
  for (const leak of ['7777', 'SecretSupplier', 'secret', '4321', '1500', 'Special build']) expect(json).not.toContain(leak)
  expect(json).toContain('manual:ab12cd34')
})

it('rejects invalid input shapes before reaching the service', async () => {
  const { ctx, service } = setup()
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost: { ...cost, source: 'table' } } as never, ctx)).rejects.toThrow()
  expect(service.createCost).not.toHaveBeenCalled()
})
