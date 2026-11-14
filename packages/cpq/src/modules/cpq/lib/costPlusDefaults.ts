import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { COST_PLUS_TOGGLE, COST_REQUEST_OVERDUE_DEFAULT_DAYS, COST_REQUEST_OVERDUE_TOGGLE } from '../data/costs'

/**
 * Register the global `cpq.cost_plus` toggle (default off, R14) and the numeric `cpq.cost_requests.overdue_working_days` toggle (default 5). Idempotent and
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
  // Numeric toggle (sourcing Q10), read with `featureTogglesService.getNumberConfig`; tenants override per tenant.
  await em.upsert(FeatureToggle, { identifier: COST_REQUEST_OVERDUE_TOGGLE, name: 'CPQ cost request overdue threshold',
    description: 'Working days (Mon-Fri) before an open supplier cost request is overdue.',
    type: 'number', defaultValue: COST_REQUEST_OVERDUE_DEFAULT_DAYS, category: 'CPQ', createdAt: now, updatedAt: now },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
}
