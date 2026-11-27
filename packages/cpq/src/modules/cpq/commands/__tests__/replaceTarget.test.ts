import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { replaceTargetCommand } from '../price-adjustments'

const quoteId = '11111111-1111-4111-8111-111111111111', rowId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'
const target = { level: 'line' as const, quoteLineId: quoteId, chargeTypeFilter: 'mrc' as const }
const body = { target, phases: [{ months: 1, adjustmentType: 'price_override' as const, value: 0, name: 'Free trial' }], then: null, currencyCode: 'USD', reasonCode: 'promotion' }
// Every column of the row, as `adjustmentSnapshot` writes it (lesson 2026-11-27: the undo schema must keep them all).
const snapshot = { id: rowId, level: 'line', quoteLineId: quoteId, chargeTypeFilter: 'mrc', adjustmentType: 'price_override', value: 0, currencyCode: 'USD',
  reasonCode: 'promotion', windowKind: 'relative', fromMonth: 1, toMonth: 1, phaseName: 'Free trial', quoteConfigurationId: quoteId, quoteId, tenantId, organizationId,
  createdByUserId: actor, createdAt: '2026-11-27T00:00:00.000Z', updatedAt: '2026-11-27T00:00:00.000Z', deletedAt: null, isActive: true }

function setup() {
  const targets = { replaceTarget: jest.fn(), undoTarget: jest.fn() }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const resolve = jest.fn((name: string) => name === 'rbacService' ? { userHasAllFeatures } : name === 'cpqTargetPriceService' ? targets : {})
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId, container: { resolve } } as unknown as CommandRuntimeContext
  return { ctx, targets, userHasAllFeatures }
}

it('is one undoable command that replaces the target with the authenticated actor and scope', async () => {
  const { ctx, targets, userHasAllFeatures } = setup()
  expect(replaceTargetCommand).toMatchObject({ id: 'cpq.quote_price_adjustment.replace_target', isUndoable: true })
  await replaceTargetCommand.execute({ quoteId, body }, ctx)
  expect(targets.replaceTarget).toHaveBeenCalledWith(quoteId, body, actor, { tenantId, organizationId })
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.quotes.manage', 'cpq.quotes.adjust_price'], { tenantId, organizationId })
})

it('refuses without permission before the service runs', async () => {
  const { ctx, targets, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(replaceTargetCommand.execute({ quoteId, body }, ctx)).rejects.toMatchObject({ status: 403 })
  expect(targets.replaceTarget).not.toHaveBeenCalled()
})

it('logs before / after of the target and undoes with every snapshot column intact', async () => {
  const { ctx, targets } = setup()
  const log = await replaceTargetCommand.buildLog!({ input: { quoteId, body }, result: { quoteId, target, before: [], after: [snapshot], quote: { id: quoteId } } } as never)
  expect(log).toMatchObject({ resourceKind: 'cpq.quote_price_adjustment', resourceId: rowId, tenantId, organizationId,
    payload: { undo: { quoteId, target, before: [], after: [snapshot] } } })
  await replaceTargetCommand.undo!({ input: { quoteId, body }, ctx, logEntry: { commandPayload: { undo: { quoteId, target, before: [], after: [snapshot] } } } } as never)
  expect(targets.undoTarget).toHaveBeenCalledWith(quoteId, target, [], [snapshot], actor, { tenantId, organizationId })
})

it('rejects malformed undo data', async () => {
  const { ctx, targets } = setup()
  await expect(replaceTargetCommand.undo!({ input: { quoteId, body }, ctx, logEntry: { commandPayload: { undo: { quoteId, before: [], after: [] } } } } as never)).rejects.toMatchObject({ status: 422 })
  expect(targets.undoTarget).not.toHaveBeenCalled()
})
