import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { features as billingAclFeatures } from './acl'
import { getBillingSettings } from './lib/billingSettings'

/**
 * Billing module setup — per-tenant defaults at module installation.
 *
 * Idempotency contract:
 *   - All seed helpers below check for an existing row before inserting.
 *   - Safe to re-run on every `mercato init` and on `auth sync-role-acls`.
 *
 * What this file seeds (Spec 0 — no core `configs` / `dictionaries` /
 * `sales` rows any more):
 *   - one `billing_settings` row per organization with the defaults
 *     (prepaid defaults + number masks). `getBillingSettings` also creates
 *     it lazily, so this is only a warm-up.
 *
 * Default role-feature grants:
 *   - `admin` gets every `billing.*` feature.
 *   - `billing_admin` is the day-to-day finance operator.
 *   - `billing_finance_user` is read + dry-run (no posting / no real trigger).
 *   - `billing_usage_writer` is the narrow scope for external system API keys.
 */

// Derived from `acl.ts` so a new feature added there automatically lands
// in every role that should get "everything billing" — no parallel list
// to keep in sync.
const ALL_BILLING_FEATURES = billingAclFeatures.map((f) => f.id)

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    // Org admins get every billing feature — `billing.*` wildcard is matched
    // by the shared feature matcher (`hasFeature` is wildcard-aware).
    admin: ['billing.*'],

    // Day-to-day finance operator persona.
    billing_admin: [...ALL_BILLING_FEATURES],

    // Read-only + dry-run preview — auditor / finance-watcher persona.
    billing_finance_user: [
      'billing.account.view',
      'billing.item.view',
      'billing.usage.view',
      'billing.run.view',
      'billing.run.dry_run',
      'billing.invoice.view',
      // Prepaid read-only (SPEC-002): balances, transactions, top-ups,
      // statements, credit status — no adjust / no top-up initiation.
      'billing.balance.view',
      'billing.credit.view',
      'billing.topup.view',
      'billing.statement.view',
      'billing.settings.view',
      'billing.payment.view',
    ],

    // Narrow scope for external usage-ingestion API keys.
    billing_usage_writer: ['billing.usage.ingest'],
  },

  /**
   * Reference data: the organization's billing settings row (Spec 0).
   * Always runs during `mercato init`. Idempotent (race-safe upsert).
   */
  async seedDefaults({ em, tenantId, organizationId }) {
    await getBillingSettings(em as EntityManager, { tenantId, organizationId })
  },
}

export default setup
