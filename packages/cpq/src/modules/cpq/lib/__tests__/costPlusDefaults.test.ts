import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { seedCostPlusDefaults } from '../costPlusDefaults'
import { COST_PLUS_TOGGLE, COST_REQUEST_OVERDUE_TOGGLE, FX_MAX_DAYS_BACK_TOGGLE, FX_SOURCE_PRIORITY_TOGGLE } from '../../data/costs'
import { CpqCostService } from '../../services/costs/costService'
import { setup } from '../../setup'
import { features } from '../../acl'
import cliCommands from '../../cli'

/** In-memory upsert honouring `onConflictAction: 'ignore'` on `identifier`. */
function toggleStore() {
  const rows = new Map<string, Record<string, unknown>>()
  const upsert = jest.fn(async (_entity: unknown, data: Record<string, unknown>, options: { onConflictFields: string[]; onConflictAction: string }) => {
    const key = String(data[options.onConflictFields[0]])
    if (!rows.has(key)) rows.set(key, { ...data })
    else if (options.onConflictAction !== 'ignore') rows.set(key, { ...rows.get(key), ...data })
    return rows.get(key)
  })
  return { rows, em: { upsert } }
}

describe('seedCostPlusDefaults', () => {
  it('registers the cpq.cost_plus toggle off by default with explicit timestamps', async () => {
    const { rows, em } = toggleStore()
    await seedCostPlusDefaults(em as never)
    expect(em.upsert).toHaveBeenCalledWith(FeatureToggle,
      expect.objectContaining({ identifier: 'cpq.cost_plus', type: 'boolean', defaultValue: false, category: 'CPQ', createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
    expect(rows.get(COST_PLUS_TOGGLE)).toMatchObject({ defaultValue: false })
  })

  it('registers the numeric overdue toggle at 5 working days, never overwriting a tenant-tuned default', async () => {
    const { rows, em } = toggleStore()
    await seedCostPlusDefaults(em as never)
    expect(COST_REQUEST_OVERDUE_TOGGLE).toBe('cpq.cost_requests.overdue_working_days')
    expect(em.upsert).toHaveBeenCalledWith(FeatureToggle,
      expect.objectContaining({ identifier: 'cpq.cost_requests.overdue_working_days', type: 'number', defaultValue: 5, category: 'CPQ', createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
    rows.get(COST_REQUEST_OVERDUE_TOGGLE)!.defaultValue = 3
    await seedCostPlusDefaults(em as never)
    expect(rows.get(COST_REQUEST_OVERDUE_TOGGLE)).toMatchObject({ defaultValue: 3 })
    expect(rows.size).toBe(4)
  })

  it('registers the FX look-back (number 7) and source priority (json []) toggles, never overwriting tenant-tuned defaults', async () => {
    const { rows, em } = toggleStore()
    await seedCostPlusDefaults(em as never)
    expect(FX_MAX_DAYS_BACK_TOGGLE).toBe('cpq.cost_plus.fx_max_days_back')
    expect(FX_SOURCE_PRIORITY_TOGGLE).toBe('cpq.cost_plus.fx_source_priority')
    expect(em.upsert).toHaveBeenCalledWith(FeatureToggle,
      expect.objectContaining({ identifier: 'cpq.cost_plus.fx_max_days_back', type: 'number', defaultValue: 7, category: 'CPQ', createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
    expect(em.upsert).toHaveBeenCalledWith(FeatureToggle,
      expect.objectContaining({ identifier: 'cpq.cost_plus.fx_source_priority', type: 'json', defaultValue: [], category: 'CPQ', createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
    rows.get(FX_MAX_DAYS_BACK_TOGGLE)!.defaultValue = 14
    rows.get(FX_SOURCE_PRIORITY_TOGGLE)!.defaultValue = ['ecb']
    await seedCostPlusDefaults(em as never)
    await seedCostPlusDefaults(em as never)
    expect(rows.get(FX_MAX_DAYS_BACK_TOGGLE)).toMatchObject({ defaultValue: 14 })
    expect(rows.get(FX_SOURCE_PRIORITY_TOGGLE)).toMatchObject({ defaultValue: ['ecb'] })
    expect(rows.size).toBe(4)
  })

  it('is idempotent and never overwrites an operator-changed toggle', async () => {
    const { rows, em } = toggleStore()
    await seedCostPlusDefaults(em as never)
    rows.get(COST_PLUS_TOGGLE)!.defaultValue = true
    rows.get(COST_PLUS_TOGGLE)!.name = 'Renamed by operator'
    await seedCostPlusDefaults(em as never)
    await seedCostPlusDefaults(em as never)
    expect(rows.size).toBe(4)
    expect(rows.get(COST_PLUS_TOGGLE)).toMatchObject({ defaultValue: true, name: 'Renamed by operator' })
  })

  it('is seeded from setup.seedDefaults, with or without an organization scope', async () => {
    const { em } = toggleStore()
    await setup.seedDefaults?.({ em, tenantId: undefined, organizationId: undefined } as never)
    expect(em.upsert).toHaveBeenCalledWith(FeatureToggle, expect.objectContaining({ identifier: COST_PLUS_TOGGLE }), expect.anything())
  })

  it('is exposed as the seed-cost-plus CLI command', () => {
    expect(cliCommands.map((command) => command.command)).toContain('seed-cost-plus')
  })
})

describe('cost ACL features', () => {
  it('declares cpq.costs.view and cpq.costs.manage', () => {
    const ids = features.map((entry) => entry.id)
    expect(ids).toEqual(expect.arrayContaining(['cpq.costs.view', 'cpq.costs.manage']))
  })

  it('grants view to admin and employee, manage to admin only', () => {
    expect(setup.defaultRoleFeatures?.admin).toEqual(expect.arrayContaining(['cpq.costs.view', 'cpq.costs.manage']))
    expect(setup.defaultRoleFeatures?.employee).toContain('cpq.costs.view')
    expect(setup.defaultRoleFeatures?.employee).not.toContain('cpq.costs.manage')
  })
})

describe('CpqCostService.enabled', () => {
  it.each([
    [{ ok: true, value: true }, true],
    [{ ok: true, value: false }, false],
    [{ ok: false, error: 'missing' }, false],
  ])('maps toggle result %j to %s for the tenant', async (flag, expected) => {
    const getBoolConfig = jest.fn().mockResolvedValue(flag)
    const service = new CpqCostService({ em: {} as never, featureTogglesService: { getBoolConfig } })
    await expect(service.enabled('tenant-1')).resolves.toBe(expected)
    expect(getBoolConfig).toHaveBeenCalledWith('cpq.cost_plus', 'tenant-1')
  })
})
