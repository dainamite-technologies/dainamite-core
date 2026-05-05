import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerCpqUseCase } from '../cpq/lib/seeds/api'
import { seedGixDefaults, seedGixExamples } from './seeds'

const ADMIN_EMAIL =
  (process.env.CPQ_DEMO_GIX_ADMIN_EMAIL && process.env.CPQ_DEMO_GIX_ADMIN_EMAIL.trim()) || 'admin@gix.com'
const ADMIN_PASSWORD =
  (process.env.CPQ_DEMO_GIX_ADMIN_PASSWORD && process.env.CPQ_DEMO_GIX_ADMIN_PASSWORD.trim()) || 'secret'

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
    roleNames: ['admin', 'employee'],
    primaryUserRoles: ['admin'],
    includeDerivedUsers: false,
  },
  seedDefaults: seedGixDefaults,
  seedExamples: seedGixExamples,
})

// The module itself is registration-only at the framework level. All actual
// seed work runs through the use-case bundle invoked by demo_tenants.
export const setup: ModuleSetupConfig = {}

export default setup
