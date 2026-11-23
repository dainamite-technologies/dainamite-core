import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { setMarkupOverrideCommand, clearMarkupOverrideCommand } from '../markup-overrides'

const quoteId = '11111111-1111-4111-8111-111111111111', rowId = '22222222-2222-4222-8222-222222222222', lineId = '66666666-6666-4666-8666-666666666666'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'
const override = { quoteLineId: lineId, chargeCode: 'tail', markupRule: 'markup_percent' as const, markupValue: 30, note: 'n' }

function setup() {
  const service = { setMarkupOverride: jest.fn(), clearMarkupOverride: jest.fn() }
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}

it('uses the authenticated actor and scope and the immutable cost feature IDs', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await setMarkupOverrideCommand.execute({ quoteId, override }, ctx)
  expect(service.setMarkupOverride).toHaveBeenCalledWith(quoteId, override, actor, { tenantId, organizationId })
  await clearMarkupOverrideCommand.execute({ quoteId, override: { quoteLineId: lineId, chargeCode: 'tail', expectedRevision: 3 } }, ctx)
  expect(service.clearMarkupOverride).toHaveBeenCalledWith(quoteId, lineId, 'tail', actor, { tenantId, organizationId }, 3)
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.quotes.manage', 'cpq.costs.manage'], { tenantId, organizationId })
})

it('refuses missing permissions before any service write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(setMarkupOverrideCommand.execute({ quoteId, override }, ctx)).rejects.toMatchObject({ status: 403 })
  expect(service.setMarkupOverride).not.toHaveBeenCalled()
})

it('is not undoable or replayable; its log carries ids and the charge code only', async () => {
  for (const command of [setMarkupOverrideCommand, clearMarkupOverrideCommand]) {
    expect(command.isUndoable).toBe(false)
    expect(command.undo).toBeUndefined()
  }
  const log = await setMarkupOverrideCommand.buildLog!({ input: {}, result: {
    override: { markupValue: '31.0000', note: 'confidential' }, margin: { contractMargin: 4321 }, pricingRevision: 1,
    audit: { before: null, after: { id: rowId, quoteLineId: lineId, chargeCode: 'tail' } },
  }, ctx: setup().ctx, snapshots: {} } as never)
  expect(log).toMatchObject({ resourceKind: 'cpq.quote_markup_override', resourceId: rowId, replayable: false })
  expect(JSON.stringify(log)).not.toMatch(/31\.0000|confidential|4321/)
})

it('rejects a target margin of 100 before reaching the service', async () => {
  const { ctx, service } = setup()
  await expect(setMarkupOverrideCommand.execute({ quoteId, override: { ...override, markupRule: 'target_margin_percent', markupValue: 100 } } as never, ctx)).rejects.toThrow()
  expect(service.setMarkupOverride).not.toHaveBeenCalled()
})
