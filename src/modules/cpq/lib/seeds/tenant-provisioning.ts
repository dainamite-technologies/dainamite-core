import { hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { CpqUseCaseAdditionalUserSpec, CpqUseCaseTenantSpec } from './api'

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

export type EnsureDemoTenantOptions = {
  /**
   * The full module list, used by `setupInitialTenant` to merge each module's
   * `defaultRoleFeatures` into the tenant's role ACLs. MUST be passed when
   * called from CLI bootstrap — otherwise the framework falls back to the
   * runtime registry which may be empty in CLI context, leaving the new
   * admin role with zero features (e.g. missing `dashboards.view`).
   */
  modules?: Module[]
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
 *   - After the admin tenant exists, every entry in `spec.additionalUsers`
 *     is provisioned idempotently in the new tenant scope.
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
  options: EnsureDemoTenantOptions = {},
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
    modules: options.modules,
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

  if (spec.additionalUsers && spec.additionalUsers.length > 0) {
    for (const userSpec of spec.additionalUsers) {
      await ensureAdditionalUser(em, {
        tenantId: result.tenantId,
        organizationId: result.organizationId,
        spec: userSpec,
      })
    }
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

async function ensureAdditionalUser(
  em: EntityManager,
  args: {
    tenantId: string
    organizationId: string
    spec: CpqUseCaseAdditionalUserSpec
  },
): Promise<void> {
  const { tenantId, organizationId, spec } = args
  const roles = spec.roles && spec.roles.length > 0 ? spec.roles : ['employee']

  const existing = await findOneWithDecryption(
    em,
    User,
    { email: spec.email },
    {},
    { tenantId: null, organizationId: null },
  )

  let user: User
  if (existing) {
    user = existing
    if (!user.tenantId) user.tenantId = tenantId
    if (!user.organizationId) user.organizationId = organizationId
    if (user.isConfirmed === false) user.isConfirmed = true
    em.persist(user)
    await em.flush()
  } else {
    const passwordHash = await hash(spec.password, 10)
    let emailValue: string = spec.email
    let emailHashValue: string = computeEmailHash(spec.email)
    if (isTenantDataEncryptionEnabled()) {
      try {
        const encryptionService = new TenantDataEncryptionService(em as any, { kms: createKmsService() })
        await encryptionService.invalidateMap('auth:user', tenantId, organizationId)
        const encrypted = await encryptionService.encryptEntityPayload(
          'auth:user',
          { email: spec.email },
          tenantId,
          organizationId,
        )
        emailValue = (encrypted as any).email ?? spec.email
        emailHashValue = (encrypted as any).emailHash ?? computeEmailHash(spec.email)
      } catch (err) {
        console.warn(`[cpq:tenant-provisioning] Failed to encrypt additional user payload, falling back to plaintext (${(err as Error).message})`)
      }
    }
    user = em.create(User, {
      email: emailValue,
      emailHash: emailHashValue,
      passwordHash,
      organizationId,
      tenantId,
      name: spec.displayName ?? undefined,
      isConfirmed: true,
      createdAt: new Date(),
    })
    em.persist(user)
    await em.flush()
  }

  for (const roleName of roles) {
    const role = await findOneWithDecryption(
      em,
      Role,
      { name: roleName, tenantId },
      {},
      { tenantId, organizationId: null },
    )
    if (!role) {
      console.warn(`[cpq:tenant-provisioning] Role "${roleName}" not found for tenant ${tenantId}; skipping link for ${spec.email}`)
      continue
    }
    const link = await findOneWithDecryption(
      em,
      UserRole,
      { user, role },
      {},
      { tenantId, organizationId: null },
    )
    if (!link) {
      em.persist(em.create(UserRole, { user, role, createdAt: new Date() }))
    }
  }
  await em.flush()
}
