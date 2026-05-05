import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { CpqUseCaseTenantSpec } from './api'

/**
 * Outcome of `ensureDemoTenant`. `created` is true iff this call provisioned
 * a new tenant; false if an existing tenant was reused (idempotent re-runs).
 */
export type EnsuredTenant = {
  tenantId: string
  organizationId: string
  adminUserId: string
  created: boolean
}

/**
 * Idempotent tenant provisioning for demo/use-case seeds (XD-276).
 *
 * Wraps `setupInitialTenant` from `@open-mercato/core/auth` so each demo
 * tenant is bootstrapped through the same code path the framework uses for
 * the primary tenant.
 *
 * Behavior:
 *   - If a user with `spec.adminEmail` already exists, return that tenant —
 *     no-op idempotent path. Re-running `yarn initialize` is safe.
 *   - Otherwise create Tenant, Organization, default Roles, primary admin
 *     user (and optionally a derived employee user), assign roles, and
 *     run all module `onTenantCreated` hooks.
 *
 * Demo tenants intentionally do NOT include the `superadmin` role — the
 * only superadmin in the system is the one created by `mercato init` for
 * the primary (ACME) tenant. Cross-tenant visibility for the primary
 * superadmin is the framework default and is preserved.
 *
 * Password policy is bypassed implicitly: this helper calls
 * `setupInitialTenant` directly (not via the `mercato auth setup` CLI
 * command), and the policy check lives only in the CLI wrapper.
 */
export async function ensureDemoTenant(
  em: EntityManager,
  _container: AwilixContainer,
  spec: CpqUseCaseTenantSpec,
): Promise<EnsuredTenant> {
  const orgName = spec.organizationName ?? spec.tenantName
  const roleNames = spec.roleNames ?? ['admin', 'employee']
  const primaryUserRoles = spec.primaryUserRoles ?? ['admin']
  const includeDerivedUsers = spec.includeDerivedUsers ?? false

  const result = await setupInitialTenant(em, {
    orgName,
    roleNames,
    primaryUser: {
      email: spec.adminEmail,
      password: spec.adminPassword,
      displayName: spec.adminDisplayName,
      confirm: true,
    },
    primaryUserRoles,
    includeSuperadminRole: false,
    includeDerivedUsers,
    failIfUserExists: false,
  })

  const primarySnapshot = result.users.find(
    (entry) => entry.user.email?.toLowerCase() === spec.adminEmail.toLowerCase(),
  )
  let adminUserId = primarySnapshot?.user.id ? String(primarySnapshot.user.id) : null

  if (!adminUserId) {
    const fallback = await findOneWithDecryption(
      em,
      User,
      { email: spec.adminEmail },
      {},
      { tenantId: result.tenantId, organizationId: result.organizationId },
    )
    adminUserId = fallback ? String(fallback.id) : null
  }

  if (!adminUserId) {
    throw new Error(`ensureDemoTenant: failed to resolve admin user id for ${spec.adminEmail}`)
  }

  return {
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    adminUserId,
    created: !result.reusedExistingUser,
  }
}

/**
 * Look up a previously-provisioned demo tenant by admin email without
 * creating anything. Returns null if not found.
 *
 * Useful for CLI commands that operate on existing tenants (e.g. `seed
 * --use-case puffin` re-running on an already-initialized DB).
 */
export async function findDemoTenant(
  em: EntityManager,
  spec: CpqUseCaseTenantSpec,
): Promise<EnsuredTenant | null> {
  const user = await findOneWithDecryption(
    em,
    User,
    { email: spec.adminEmail },
    {},
    { tenantId: null, organizationId: null },
  )
  if (!user || !user.tenantId || !user.organizationId) return null

  return {
    tenantId: String(user.tenantId),
    organizationId: String(user.organizationId),
    adminUserId: String(user.id),
    created: false,
  }
}
