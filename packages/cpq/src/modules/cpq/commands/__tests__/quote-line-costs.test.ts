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

// Supplier sourcing step 9: the manual value write command stays a thin pass-through; the cancellation of an open
// request (manual_value) happens in the service's write (quoteCostService.test.ts), never through the command input or log.
it('a manual value write forwards exactly the value patch and carries no sourcing fields in the command schema or the log', async () => {
  const { ctx, service } = setup()
  const patch = { unitAmount: 280, valueStatus: 'confirmed' as const, note: 'phone quote' }
  await updateQuoteLineCostCommand.execute({ quoteId, costId, patch }, ctx)
  expect(service.updateCost).toHaveBeenCalledWith(quoteId, costId, patch, actor, { tenantId, organizationId })
  // the patch schema is strict: sourcing columns are not writable through the value command today
  await expect(updateQuoteLineCostCommand.execute({ quoteId, costId, patch: { sourcingStatus: 'cancelled' } } as never, ctx)).rejects.toThrow()
  expect(service.updateCost).toHaveBeenCalledTimes(1)
  const result = { cost: { id: costId }, margin: null, pricingRevision: 1, audit: { before: null, after: { id: costId, quoteLineId: lineId, costKey: 'manual:ab12cd34', role: 'margin_only', origin: 'manual', valueStatus: 'confirmed', valueOrigin: 'manual' } } }
  const log = await updateQuoteLineCostCommand.buildLog!({ input: { quoteId, costId, patch }, result, ctx, snapshots: {} } as never)
  expect(JSON.stringify(log)).not.toMatch(/sourcing|costRequest|proposed/i)
})

// FX step 7: a rate is never accepted from the client (anti-corruption, App Spec 1.4.9) and never lands in the action log.
it('refuses an fx rate in the create / update body and keeps the rate out of the log', async () => {
  const { ctx, service } = setup()
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost: { ...cost, currencyCode: 'USD', fxRate: '0.5' } } as never, ctx)).rejects.toThrow()
  await expect(updateQuoteLineCostCommand.execute({ quoteId, costId, patch: { currencyCode: 'USD', fxRateSource: 'x' } } as never, ctx)).rejects.toThrow()
  expect(service.createCost).not.toHaveBeenCalled()
  expect(service.updateCost).not.toHaveBeenCalled()
  const result = {
    cost: { id: costId, currencyCode: 'USD', fxRate: '0.77777777', fxRateSource: 'SentinelFX' }, margin: null, pricingRevision: 1,
    audit: { before: null, after: { id: costId, quoteLineId: lineId, costKey: 'manual:ab12cd34', role: 'margin_only', origin: 'manual', valueStatus: 'confirmed', valueOrigin: 'manual' } },
  }
  const log = await createQuoteLineCostCommand.buildLog!({ input: { quoteId, cost: { ...cost, currencyCode: 'USD' } }, result, ctx, snapshots: {} } as never)
  expect(JSON.stringify(log)).not.toMatch(/0\.7777|SentinelFX|fxRate|USD/)
})

// ARC costs step 1 (characterization): the cost-lock matrix itself is pinned in costLock.test.ts and
// quoteCostService.test.ts ("cost lock matrix"). The commands add nothing to it and must let the service's refusal
// through untouched, with no log entry produced for a refused write.
it('lets a COST_LOCKED refusal from the service through unchanged on create, update and delete', async () => {
  const { ctx, service } = setup()
  const locked = Object.assign(new Error('COST_LOCKED'), { status: 409 })
  service.createCost.mockRejectedValue(locked)
  service.updateCost.mockRejectedValue(locked)
  service.deleteCost.mockRejectedValue(locked)
  await expect(createQuoteLineCostCommand.execute({ quoteId, cost: { ...cost, role: 'price_basis' } }, ctx)).rejects.toBe(locked)
  await expect(updateQuoteLineCostCommand.execute({ quoteId, costId, patch: { unitAmount: 5 } }, ctx)).rejects.toBe(locked)
  await expect(deleteQuoteLineCostCommand.execute({ quoteId, costId }, ctx)).rejects.toBe(locked)
})

// ARC costs step 7 (MODIFIED "Manual costs, cost confirmation and markup override"): the command forwards a carried-value
// overwrite (value + note + evidence) untouched, the service decides lock and NOTE_REQUIRED, and the strict patch schema
// still accepts no origin / carry fields: `carried` is server-side only.
it('forwards a carried-value overwrite with its note and evidence, and lets NOTE_REQUIRED through unchanged', async () => {
  const { ctx, service } = setup()
  const patch = { unitAmount: 240, supplierQuoteRef: 'CX-2207', note: 'renegotiated with Carrier X' }
  await updateQuoteLineCostCommand.execute({ quoteId, costId, patch }, ctx)
  expect(service.updateCost).toHaveBeenCalledWith(quoteId, costId, patch, actor, { tenantId, organizationId })
  const refusal = Object.assign(new Error('NOTE_REQUIRED'), { status: 422 })
  service.updateCost.mockRejectedValue(refusal)
  await expect(updateQuoteLineCostCommand.execute({ quoteId, costId, patch: { unitAmount: 240 } }, ctx)).rejects.toBe(refusal)
  for (const forbidden of [{ origin: 'carried' }, { valueOrigin: 'carried' }, { carriedFromItemCostId: costId }, { renegotiationDue: true }]) {
    await expect(updateQuoteLineCostCommand.execute({ quoteId, costId, patch: forbidden } as never, ctx)).rejects.toThrow()
  }
  expect(service.updateCost).toHaveBeenCalledTimes(2)
})
