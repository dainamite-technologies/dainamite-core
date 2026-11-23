import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { appendCostIndexValueCommand, createCostIndexCommand, deleteCostIndexCommand, updateCostIndexCommand } from '../cost-indices'

const indexId = '11111111-1111-4111-8111-111111111111'
const actor = '33333333-3333-4333-8333-333333333333', tenantId = '44444444-4444-4444-8444-444444444444', organizationId = '55555555-5555-4555-8555-555555555555'
const scope = { tenantId, organizationId }
const view = { id: indexId, code: 'BRENT', name: 'Secret index name', unit: 'USD/bbl', currencyCode: 'USD', isActive: true, description: 'internal note' }

function setup() {
  const service = { create: jest.fn(), update: jest.fn(), softDelete: jest.fn(), get: jest.fn(), appendValue: jest.fn(), importValues: jest.fn() }
  service.create.mockResolvedValue(view)
  service.get.mockResolvedValue({ item: view })
  service.update.mockResolvedValue({ ...view, isActive: false })
  service.appendValue.mockResolvedValue({ id: 'v1', costIndexId: indexId, effectiveDate: '2026-11-10', value: '7777.770000', revision: 2, sourceNote: 'confidential feed' })
  service.importValues.mockResolvedValue({ batchId: 'batch-1', dryRun: false, results: [{ row: 1, indexCode: 'BRENT', effectiveDate: '2026-11-10', status: 'created', revision: 1 }] })
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const ctx = { auth: { sub: actor, tenantId }, selectedOrganizationId: organizationId,
    container: { resolve: (name: string) => name === 'rbacService' ? { userHasAllFeatures } : service } } as unknown as CommandRuntimeContext
  return { ctx, service, userHasAllFeatures }
}
const commands = [createCostIndexCommand, updateCostIndexCommand, deleteCostIndexCommand, appendCostIndexValueCommand]

it('uses the authenticated actor and scope and the immutable write feature IDs', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  await createCostIndexCommand.execute({ index: { code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD' } }, ctx)
  expect(service.create).toHaveBeenCalledWith({ code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD' }, scope)
  await updateCostIndexCommand.execute({ indexId, patch: { isActive: false } }, ctx)
  expect(service.update).toHaveBeenCalledWith(indexId, { isActive: false }, scope)
  await deleteCostIndexCommand.execute({ indexId }, ctx)
  expect(service.softDelete).toHaveBeenCalledWith(indexId, scope)
  await appendCostIndexValueCommand.execute({ indexId, value: { effectiveDate: '2026-11-10', value: 82.4 } }, ctx)
  expect(service.appendValue).toHaveBeenCalledWith(indexId, { effectiveDate: '2026-11-10', value: 82.4 }, scope, { userId: actor })
  await appendCostIndexValueCommand.execute({ import: { items: [{ indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4 }] } }, ctx)
  expect(service.importValues).toHaveBeenCalledWith([{ indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4 }], scope, { userId: actor })
  expect(userHasAllFeatures).toHaveBeenCalledWith(actor, ['cpq.pricing.manage', 'cpq.costs.view'], scope)
})

it('refuses missing permissions, a missing organization and a non-user caller before any service write', async () => {
  const { ctx, service, userHasAllFeatures } = setup()
  userHasAllFeatures.mockResolvedValue(false)
  await expect(createCostIndexCommand.execute({ index: { code: 'BRENT', name: 'B', unit: 'u', currencyCode: 'USD' } }, ctx)).rejects.toMatchObject({ status: 403 })
  userHasAllFeatures.mockResolvedValue(true)
  await expect(deleteCostIndexCommand.execute({ indexId }, { ...ctx, selectedOrganizationId: null })).rejects.toMatchObject({ status: 403 })
  const orphan = { ...ctx, auth: { sub: 'api_key:k', tenantId } } as unknown as CommandRuntimeContext
  await expect(deleteCostIndexCommand.execute({ indexId }, orphan)).rejects.toMatchObject({ status: 403 })
  expect(service.create).not.toHaveBeenCalled()
  expect(service.softDelete).not.toHaveBeenCalled()
})

it('rejects invalid input before reaching the service', async () => {
  const { ctx, service } = setup()
  await expect(appendCostIndexValueCommand.execute({ indexId, value: { effectiveDate: '2026-11-10', value: 0 } }, ctx)).rejects.toThrow()
  await expect(appendCostIndexValueCommand.execute({ indexId, value: { effectiveDate: '2026-11-10', value: 1 }, import: { items: [] } } as never, ctx)).rejects.toThrow()
  await expect(updateCostIndexCommand.execute({ indexId: 'nope', patch: {} }, ctx)).rejects.toThrow()
  expect(service.appendValue).not.toHaveBeenCalled()
})

it('is not undoable or replayable', () => {
  for (const command of commands) {
    expect(command.isUndoable).toBe(false)
    expect(command.undo).toBeUndefined()
    expect(command.redo).toBeUndefined()
  }
})

describe('log payloads carry no index value', () => {
  const leaks = ['7777', '82.4', 'confidential feed', 'Secret index name', 'internal note']

  it('value append: index id, date and revision only', async () => {
    const { ctx } = setup()
    const result = await appendCostIndexValueCommand.execute({ indexId, value: { effectiveDate: '2026-11-10', value: 7777.77, sourceNote: 'confidential feed' } }, ctx)
    const log = await appendCostIndexValueCommand.buildLog!({ input: {}, result, ctx, snapshots: {} } as never)
    expect(log).toMatchObject({ resourceKind: 'cpq.cost_index_value', resourceId: 'v1', replayable: false })
    expect(log!.snapshotAfter).toEqual({ rows: [{ indexId, effectiveDate: '2026-11-10', revision: 2, status: 'created' }] })
    const json = JSON.stringify(log)
    for (const leak of leaks) expect(json).not.toContain(leak)
  })

  it('import: batch id, index codes, dates and revisions only', async () => {
    const { ctx } = setup()
    const result = await appendCostIndexValueCommand.execute({ import: { items: [{ indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4 }] } }, ctx)
    const log = await appendCostIndexValueCommand.buildLog!({ input: {}, result, ctx, snapshots: {} } as never)
    expect(log!.snapshotAfter).toEqual({ batchId: 'batch-1', rows: [{ indexCode: 'BRENT', effectiveDate: '2026-11-10', revision: 1, status: 'created' }] })
    for (const leak of leaks) expect(JSON.stringify(log)).not.toContain(leak)
  })

  it('create / update / delete: id, code, currency and state only (no name, description)', async () => {
    const { ctx } = setup()
    for (const [command, input] of [
      [createCostIndexCommand, { index: { code: 'BRENT', name: 'Secret index name', unit: 'USD/bbl', currencyCode: 'USD', description: 'internal note' } }],
      [updateCostIndexCommand, { indexId, patch: { isActive: false } }],
      [deleteCostIndexCommand, { indexId }],
    ] as const) {
      const result = await (command.execute as (i: unknown, c: unknown) => Promise<unknown>)(input, ctx)
      const log = await (command.buildLog as (a: unknown) => Promise<{ replayable: boolean }>)({ input, result, ctx, snapshots: {} })
      expect(log.replayable).toBe(false)
      for (const leak of leaks) expect(JSON.stringify(log)).not.toContain(leak)
      expect(JSON.stringify(log)).toContain(indexId)
    }
  })
})
