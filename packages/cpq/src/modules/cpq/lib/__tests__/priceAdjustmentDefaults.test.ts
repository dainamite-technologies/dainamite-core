import { seedPriceAdjustmentDefaults } from '../priceAdjustmentDefaults'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { DEFAULT_ADJUSTMENT_REASONS } from '../../data/price-adjustments'
import { setup } from '../../setup'
import { features } from '../../acl'
const scope = { tenantId: 'tenant', organizationId: 'org' }
it('seeds seven editable reasons idempotently without resetting a disabled rollout toggle or custom label', async () => {
  let dictionary: Record<string, unknown> | null = null
  const entries: Array<Record<string, unknown>> = []
  const flag = { identifier: 'cpq.manual_price_adjustments', defaultValue: false }
  const em = {
    upsert: jest.fn(async () => flag),
    findOne: jest.fn(async () => dictionary), find: jest.fn(async () => entries),
    create: jest.fn((entity: unknown, values: Record<string, unknown>) => {
      const row = { id: `id-${entries.length}`, ...values }
      if (entity === Dictionary) dictionary = row
      if (entity === DictionaryEntry) entries.push(row)
      return row
    }), persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
  }
  await seedPriceAdjustmentDefaults(em as never, scope)
  expect(entries).toHaveLength(7)
  expect(entries.map((entry) => entry.value)).toEqual(DEFAULT_ADJUSTMENT_REASONS.map((entry) => entry.value))
  expect(dictionary).toMatchObject({ managerVisibility: 'default', isSystem: false, ...scope })
  entries[0].label = 'Tenant custom label'
  await seedPriceAdjustmentDefaults(em as never, scope)
  expect(entries).toHaveLength(7)
  expect(entries[0].label).toBe('Tenant custom label')
  expect(flag.defaultValue).toBe(false)
  expect(em.upsert).toHaveBeenCalledWith(FeatureToggle, expect.objectContaining({ defaultValue: true }), { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
})
it('declares and grants adjustment permission to both sales roles', () => {
  expect(features.some((entry) => entry.id === 'cpq.quotes.adjust_price')).toBe(true)
  expect(setup.defaultRoleFeatures?.admin).toContain('cpq.quotes.adjust_price')
  expect(setup.defaultRoleFeatures?.employee).toContain('cpq.quotes.adjust_price')
})
