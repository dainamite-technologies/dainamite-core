import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createAdjustmentCommand, updateAdjustmentCommand, deleteAdjustmentCommand } from '../price-adjustments'
const quoteId = '11111111-1111-4111-8111-111111111111', adjustmentId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'
const adjustment = { level: 'charge' as const, quoteLineId: quoteId, chargeCode: 'fee', adjustmentType: 'price_override' as const, value: 80, currencyCode: 'USD', reasonCode: 'competitive_match' }
function setup() {
  const service = { create: jest.fn(), update: jest.fn(), remove: jest.fn(), undo: jest.fn() }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}
it('uses authenticated actor/scope and immutable feature IDs for create/update/delete', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await createAdjustmentCommand.execute({ quoteId, adjustment }, ctx)
  expect(service.create).toHaveBeenCalledWith(quoteId, adjustment, actor, { tenantId, organizationId })
  await updateAdjustmentCommand.execute({ quoteId, adjustmentId, patch: { value: 70 } }, ctx)
  expect(service.update).toHaveBeenCalledWith(quoteId, adjustmentId, { value: 70 }, actor, { tenantId, organizationId })
  await deleteAdjustmentCommand.execute({ quoteId, adjustmentId, expectedRevision: 2 }, ctx)
  expect(service.remove).toHaveBeenCalledWith(quoteId, adjustmentId, actor, { tenantId, organizationId }, 2)
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.quotes.manage', 'cpq.quotes.adjust_price'], { tenantId, organizationId })
})
it('refuses missing permissions and missing selected organization before a service write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(createAdjustmentCommand.execute({ quoteId, adjustment }, ctx)).rejects.toMatchObject({ status: 403 })
  userHasAllFeatures.mockResolvedValue(true)
  await expect(createAdjustmentCommand.execute({ quoteId, adjustment }, { ...ctx, selectedOrganizationId: null })).rejects.toMatchObject({ status: 403 })
  expect(service.create).not.toHaveBeenCalled()
})
it('reads undo data from the command bus redo envelope and rechecks authorization', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  const after = { id: adjustmentId, ...adjustment, quoteConfigurationId: quoteId, quoteId, tenantId, organizationId,
    createdByUserId: actor, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z', deletedAt: null, isActive: true }
  await createAdjustmentCommand.undo!({ input: { quoteId, adjustment }, ctx, logEntry: { commandPayload: { value: { undo: { quoteId, before: null, after } } } } })
  expect(service.undo).toHaveBeenCalledWith(quoteId, adjustmentId, null, after, actor, { tenantId, organizationId })
  userHasAllFeatures.mockResolvedValue(false)
  await expect(createAdjustmentCommand.undo!({ input: { quoteId, adjustment }, ctx, logEntry: { commandPayload: { undo: { quoteId, before: null, after } } } })).rejects.toMatchObject({ status: 403 })
})
it('rejects malformed undo data instead of silently succeeding', async () => {
  const { ctx, service } = setup()
  await expect(deleteAdjustmentCommand.undo!({ input: { quoteId, adjustmentId }, ctx, logEntry: { commandPayload: {} } })).rejects.toMatchObject({ status: 422 })
  expect(service.undo).not.toHaveBeenCalled()
})
it('authorizes an API key by its subject but records its owning user; refuses keys without a user', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  const keyCtx = { ...ctx, auth: { sub: 'api_key:k1', userId: actor, tenantId } } as unknown as CommandRuntimeContext
  await createAdjustmentCommand.execute({ quoteId, adjustment }, keyCtx)
  expect(userHasAllFeatures).toHaveBeenCalledWith('api_key:k1', ['cpq.quotes.manage', 'cpq.quotes.adjust_price'], { tenantId, organizationId })
  expect(service.create).toHaveBeenCalledWith(quoteId, adjustment, actor, { tenantId, organizationId })
  const orphanKey = { ...ctx, auth: { sub: 'api_key:k2', tenantId } } as unknown as CommandRuntimeContext
  await expect(createAdjustmentCommand.execute({ quoteId, adjustment }, orphanKey)).rejects.toMatchObject({ status: 403 })
  expect(service.create).toHaveBeenCalledTimes(1)
})
