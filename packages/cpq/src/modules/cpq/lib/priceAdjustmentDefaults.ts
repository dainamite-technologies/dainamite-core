import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { ADJUSTMENT_TOGGLE, REASON_DICTIONARY, DEFAULT_ADJUSTMENT_REASONS } from '../data/price-adjustments'
import type { TenantScope } from '../services/types'

/** Add missing defaults; never overwrite an operator's labels or disabled flags. */
export async function seedPriceAdjustmentDefaults(em: EntityManager, scope: TenantScope): Promise<void> {
  // Multiple tenants may initialize concurrently. Ignore an existing global
  // identifier (including disabled/deleted toggles), without resetting its value.
  await em.upsert(FeatureToggle, { identifier: ADJUSTMENT_TOGGLE, name: 'CPQ manual price adjustments',
    type: 'boolean', defaultValue: true, category: 'CPQ' },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
  let dictionary = await findOneWithDecryption(em, Dictionary, { ...scope, key: REASON_DICTIONARY }, undefined, scope)
  if (!dictionary) {
    dictionary = em.create(Dictionary, { ...scope, key: REASON_DICTIONARY, name: 'Price adjustment reasons',
      description: 'Reasons for negotiated prices on quotes.', managerVisibility: 'default', isSystem: false, isActive: true, createdAt: new Date(), updatedAt: new Date() })
    em.persist(dictionary)
    await em.flush()
  }
  if (dictionary.deletedAt) return
  const existing = await findWithDecryption(em, DictionaryEntry, { ...scope, dictionary: dictionary.id,
    normalizedValue: { $in: DEFAULT_ADJUSTMENT_REASONS.map((entry) => entry.value) } }, { limit: DEFAULT_ADJUSTMENT_REASONS.length }, scope)
  const values = new Set(existing.map((entry) => entry.normalizedValue))
  for (const [position, entry] of DEFAULT_ADJUSTMENT_REASONS.entries()) {
    if (!values.has(entry.value)) {
      em.persist(em.create(DictionaryEntry, { ...scope, dictionary, value: entry.value,
        normalizedValue: entry.value, label: entry.label, position }))
    }
  }
  await em.flush()
}
