import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerCpqUseCase } from '../cpq/lib/seeds/api'
import { seedPuffinDefaults, seedPuffinExamples } from './seeds'
import { registerPuffinStepTypes } from './workflows/steps'

// Register the CPQ wizard step types contributed by demo_puffin (e.g. the
// `context_select` step used by the puffin-sales-led-quote wizard). The
// registry is process-local; the matching client-side registration lives in
// `widgets/components.ts`, loaded by the generated component overrides bundle.
registerPuffinStepTypes()

/**
 * Public calculator feature flag — XD-275 phase 5 will read this when it
 * lands the `/api/cpq/public/*` routes. We declare the default here so the
 * flag's "owning module" is unambiguous; the actual route registration and
 * RBAC plumbing lives in XD-275.
 */
export const DEFAULT_PUBLIC_CALCULATOR_FEATURE = 'cpq.public.calculator'

const ADMIN_EMAIL =
  (process.env.CPQ_DEMO_PUFFIN_ADMIN_EMAIL && process.env.CPQ_DEMO_PUFFIN_ADMIN_EMAIL.trim()) || 'admin@puffin.com'
const ADMIN_PASSWORD =
  (process.env.CPQ_DEMO_PUFFIN_ADMIN_PASSWORD && process.env.CPQ_DEMO_PUFFIN_ADMIN_PASSWORD.trim()) || 'secret'
const EMPLOYEE_EMAIL =
  (process.env.CPQ_DEMO_PUFFIN_EMPLOYEE_EMAIL && process.env.CPQ_DEMO_PUFFIN_EMPLOYEE_EMAIL.trim()) || 'employee@puffin.com'
const EMPLOYEE_PASSWORD =
  (process.env.CPQ_DEMO_PUFFIN_EMPLOYEE_PASSWORD && process.env.CPQ_DEMO_PUFFIN_EMPLOYEE_PASSWORD.trim()) || 'secret'

registerCpqUseCase({
  id: 'puffin',
  tenant: {
    slug: 'puffin',
    tenantName: 'Puffin Cloud Tenant',
    organizationName: 'Puffin Cloud',
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    adminDisplayName: 'Puffin Cloud Admin',
    roleNames: ['admin', 'employee'],
    primaryUserRoles: ['admin'],
    includeDerivedUsers: false,
    additionalUsers: [
      {
        email: EMPLOYEE_EMAIL,
        password: EMPLOYEE_PASSWORD,
        displayName: 'Puffin Cloud Employee',
        roles: ['employee'],
      },
    ],
  },
  seedDefaults: seedPuffinDefaults,
  seedExamples: seedPuffinExamples,
})

export const setup: ModuleSetupConfig = {}

export default setup
