import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerCpqUseCase } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { seedGixDefaults, seedGixExamples } from './seeds'

const ADMIN_EMAIL =
  (process.env.CPQ_DEMO_GIX_ADMIN_EMAIL && process.env.CPQ_DEMO_GIX_ADMIN_EMAIL.trim()) || 'admin@gix.com'
const ADMIN_PASSWORD =
  (process.env.CPQ_DEMO_GIX_ADMIN_PASSWORD && process.env.CPQ_DEMO_GIX_ADMIN_PASSWORD.trim()) || 'secret'
const EMPLOYEE_EMAIL =
  (process.env.CPQ_DEMO_GIX_EMPLOYEE_EMAIL && process.env.CPQ_DEMO_GIX_EMPLOYEE_EMAIL.trim()) || 'employee@gix.com'
const EMPLOYEE_PASSWORD =
  (process.env.CPQ_DEMO_GIX_EMPLOYEE_PASSWORD && process.env.CPQ_DEMO_GIX_EMPLOYEE_PASSWORD.trim()) || 'secret'
const PRICING_MANAGER_EMAIL =
  (process.env.CPQ_DEMO_GIX_PRICING_MANAGER_EMAIL && process.env.CPQ_DEMO_GIX_PRICING_MANAGER_EMAIL.trim()) ||
  'pricing@gix.com'
const PRICING_MANAGER_PASSWORD =
  (process.env.CPQ_DEMO_GIX_PRICING_MANAGER_PASSWORD && process.env.CPQ_DEMO_GIX_PRICING_MANAGER_PASSWORD.trim()) ||
  'secret'

// Register the GIX use case with the CPQ seed registry. The orchestrator
// (`demo_tenants`) walks `listCpqUseCases()` at init time and routes this
// bundle into the GIX tenant.
registerCpqUseCase({
  id: 'gix',
  tenant: {
    slug: 'gix',
    tenantName: 'GIX Network Services Tenant',
    organizationName: 'GIX',
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    adminDisplayName: 'GIX Admin',
    roleNames: ['admin', 'employee', 'pricing_manager'],
    primaryUserRoles: ['admin'],
    includeDerivedUsers: false,
    additionalUsers: [
      {
        email: EMPLOYEE_EMAIL,
        password: EMPLOYEE_PASSWORD,
        displayName: 'GIX Employee',
        roles: ['employee'],
      },
      // Cost-plus identity model (App Spec §2): the sales rep (employee@) sees costs and
      // margin read-only (cpq.costs.view); the pricing manager (pricing@) also edits and
      // confirms them (cpq.costs.manage). admin@ holds both as well.
      {
        email: PRICING_MANAGER_EMAIL,
        password: PRICING_MANAGER_PASSWORD,
        displayName: 'GIX Pricing Manager',
        // `employee` carries the standard backend features; `pricing_manager` adds cost management.
        roles: ['employee', 'pricing_manager'],
      },
    ],
  },
  seedDefaults: seedGixDefaults,
  seedExamples: seedGixExamples,
})

// The module itself is registration-only at the framework level. All actual
// seed work runs through the use-case bundle invoked by demo_tenants.
export const setup: ModuleSetupConfig = {
  // Picked up by `ensureCustomRoleAcls` for the `pricing_manager` role of the GIX tenant.
  defaultRoleFeatures: {
    pricing_manager: [
      'cpq.quotes.view',
      'cpq.quotes.manage',
      'cpq.pricing.view',
      'cpq.products.view',
      'cpq.specifications.view',
      'cpq.offerings.view',
      'cpq.inventory.view',
      'cpq.orders.view',
      'cpq.orders.manage',
      'cpq.costs.view',
      'cpq.costs.manage',
    ],
  },
}

export default setup
