import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * CPQ module setup. After XD-276 the cpq module ships with NO customer
 * demo data — that lives in app-level demo modules (`src/modules/demo_<x>/`)
 * which register use-case bundles via `cpq/lib/seeds/api.ts`. This keeps
 * `@dainamite/cpq` clean of vertical-specific seeds when it extracts to a
 * standalone npm package per SPEC-001.
 *
 * What still lives here:
 *   - `defaultRoleFeatures` — required for any tenant that has cpq enabled
 *   - structural defaults (currently none beyond role features)
 *
 * What used to live here and moved out:
 *   - GIX product/pricing/charge/rule/bundle/wizard seed → `src/modules/demo_gix/`
 *   - Acme/Globex demo customers + quotes → `src/modules/demo_gix/seeds/examples.ts`
 *   - GIX wizard definition → `src/modules/demo_gix/seeds/wizards.ts`
 */
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'cpq.quotes.view',
      'cpq.quotes.manage',
      'cpq.pricing.view',
      'cpq.pricing.manage',
      'cpq.products.view',
      'cpq.products.manage',
      'cpq.specifications.view',
      'cpq.specifications.manage',
      'cpq.offerings.view',
      'cpq.offerings.manage',
      'cpq.wizards.view',
      'cpq.wizards.manage',
      'cpq.inventory.view',
      'cpq.inventory.manage',
      'cpq.orders.view',
      'cpq.orders.manage',
      // XD-250 ARC features — admins can drive every ARC flow.
      'cpq.arc.amend.manage',
      'cpq.arc.renew.manage',
      'cpq.arc.cancel.manage',
      'cpq.arc.changelog.view',
    ],
    employee: [
      'cpq.quotes.view',
      'cpq.quotes.manage',
      'cpq.pricing.view',
      'cpq.products.view',
      'cpq.specifications.view',
      'cpq.offerings.view',
      'cpq.wizards.view',
      'cpq.inventory.view',
      'cpq.orders.view',
      // XD-250 ARC: anyone with cpq.quotes.manage drives ARC quotes.
      'cpq.arc.amend.manage',
      'cpq.arc.renew.manage',
      'cpq.arc.cancel.manage',
      'cpq.arc.changelog.view',
    ],
  },
}

export default setup
