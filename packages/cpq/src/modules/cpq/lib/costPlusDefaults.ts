import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  COST_EXPIRY_LEAD_DAYS_DEFAULT, COST_EXPIRY_LEAD_DAYS_TOGGLE, COST_PLUS_TOGGLE, COST_REQUEST_OVERDUE_DEFAULT_DAYS, COST_REQUEST_OVERDUE_TOGGLE, FX_MAX_DAYS_BACK_DEFAULT, FX_MAX_DAYS_BACK_TOGGLE,
  FX_SOURCE_PRIORITY_TOGGLE,
} from '../data/costs'

/**
 * Register the global `cpq.cost_plus` toggle (default off, R14), the numeric `cpq.cost_requests.overdue_working_days` toggle (default 5)
 * and the FX settings `cpq.cost_plus.fx_max_days_back` (number 7) / `cpq.cost_plus.fx_source_priority` (json `[]`) and `cpq.cost_expiry_lead_days` (number 14). Idempotent and
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
  // Supplier cost expiry warnings (index-costs spec Q4), read by services/costs/costExpiryService.ts; tenants override per tenant.
  await em.upsert(FeatureToggle, { identifier: COST_EXPIRY_LEAD_DAYS_TOGGLE, name: 'CPQ cost expiry warning lead days',
    description: 'Days before a confirmed supplier cost expires that cost managers are warned.',
    type: 'number', defaultValue: COST_EXPIRY_LEAD_DAYS_DEFAULT, category: 'CPQ', createdAt: now, updatedAt: now },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
  // FX settings (FX Q1 / Q2), read by services/costs/fxSettings.ts; tenants override per tenant.
  await em.upsert(FeatureToggle, { identifier: FX_MAX_DAYS_BACK_TOGGLE, name: 'CPQ cost-plus FX look-back days',
    description: 'Days the exchange-rate lookup goes back from today when no rate exists for the date (0-30).',
    type: 'number', defaultValue: FX_MAX_DAYS_BACK_DEFAULT, category: 'CPQ', createdAt: now, updatedAt: now },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
  await em.upsert(FeatureToggle, { identifier: FX_SOURCE_PRIORITY_TOGGLE, name: 'CPQ cost-plus FX source priority',
    description: 'Ordered exchange-rate source names; the first listed source that has a rate is used.',
    type: 'json', defaultValue: [], category: 'CPQ', createdAt: now, updatedAt: now },
    { onConflictFields: ['identifier'], onConflictAction: 'ignore' })
}
