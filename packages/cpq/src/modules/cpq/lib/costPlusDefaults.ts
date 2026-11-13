import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { COST_PLUS_TOGGLE } from '../data/costs'

/**
 * Register the global `cpq.cost_plus` toggle (default off, R14). Idempotent and
 * never overwrites: an existing identifier — including one an operator turned
 * on, disabled or soft-deleted — is left untouched (`onConflictAction: 'ignore'`).
 * Tenants switch it on through a per-tenant override.
 */
export async function seedCostPlusDefaults(em: EntityManager): Promise<void> {
  // POJO upserts skip entity property initializers, so timestamps must be explicit
  // (`updated_at` is NOT NULL and only has an onUpdate hook).
  const now = new Date()
  await em.upsert(FeatureToggle, { identifier: COST_PLUS_TOGGLE, name: 'CPQ cost-plus pricing',
    description: 'Cost-plus charges, cost catalog and quote margin.',
    type: 'boolean', defaultValue: false, category: 'CPQ', createdAt: now, updatedAt: now },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
}
