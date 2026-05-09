import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

/**
 * Public API for the CPQ multi-tenant use-case seeding system (XD-276).
 *
 * A use case is a self-contained, idempotent unit that knows how to seed one
 * tenant's worth of CPQ data (products, pricing tables, charges, attributes,
 * price rules, bundles, wizards, optional demo customers/quotes).
 *
 * Use cases live OUTSIDE the cpq module (in `src/modules/@app/demo_<x>/`) so
 * the cpq module remains free of customer-specific demo data when it is
 * extracted to `@dainamite/cpq` per SPEC-001.
 *
 * Registration is process-local module state — populated when each demo
 * module is imported by the framework's module bootstrap. The orchestrator
 * (`@app/demo_tenants`) walks this registry at init time.
 */

export type CpqUseCaseAdditionalUserSpec = {
  /** Email address for the additional user, e.g. `employee@gix.com`. */
  email: string
  /** Initial password (dev-only — overridable via env). */
  password: string
  /** Optional display name. */
  displayName?: string
  /** Roles assigned to this user. Default `['employee']`. */
  roles?: string[]
}

export type CpqUseCaseTenantSpec = {
  /** Stable slug used as a key in env overrides, e.g. `gix`, `puffin`. */
  slug: string
  /** Tenant display name, e.g. `GIX Network Services Tenant`. */
  tenantName: string
  /** Organization display name, e.g. `GIX`. Defaults to `tenantName` if omitted. */
  organizationName?: string
  /** Primary admin email. e.g. `admin@gix.com`. */
  adminEmail: string
  /** Initial admin password (dev-only — overridable via env). */
  adminPassword: string
  /** Optional display name for the admin user. */
  adminDisplayName?: string
  /** Roles to ensure on the tenant; default `['admin', 'employee']` (no superadmin). */
  roleNames?: string[]
  /** Roles assigned to the primary admin user. Default `['admin']`. */
  primaryUserRoles?: string[]
  /** Whether to also create the derived `employee@<domain>` user. Default `false`. */
  includeDerivedUsers?: boolean
  /**
   * Additional users to provision in this tenant alongside the admin.
   * Each entry is created idempotently with the specified roles. Use this
   * to seed e.g. `employee@gix.com` so a non-admin login is available.
   */
  additionalUsers?: CpqUseCaseAdditionalUserSpec[]
}

export type CpqUseCaseSeedContext = {
  em: EntityManager
  container: AwilixContainer
  tenantId: string
  organizationId: string
  /**
   * False when invoked under `mercato init --no-examples` — seeders MUST skip
   * any demo customer/quote/order creation. seedDefaults still runs.
   */
  withExamples: boolean
}

export type CpqUseCase = {
  /** Stable id used by CLI flags and env vars; e.g. `gix`, `puffin`. */
  id: string
  /** Tenant provisioning spec — passed to `ensureDemoTenant`. */
  tenant: CpqUseCaseTenantSpec
  /** Idempotent. Seeds the catalog: specs, offerings, attributes, charges, pricing tables, rules, bundles, wizards. */
  seedDefaults(ctx: CpqUseCaseSeedContext): Promise<void>
  /** Optional. Seeds demo customers, quotes, orders. Skipped when --no-examples or CPQ_DEMO_SKIP_EXAMPLES. */
  seedExamples?(ctx: CpqUseCaseSeedContext): Promise<void>
}

const registry = new Map<string, CpqUseCase>()

/**
 * Register a use case. Called from the demo module's `setup.ts` on import.
 *
 * Re-registration with the same id overwrites and emits a warning. This keeps
 * dev-server HMR working without throwing on every reload, while still
 * surfacing accidental duplicate ids in logs.
 */
export function registerCpqUseCase(useCase: CpqUseCase): void {
  if (!useCase || typeof useCase.id !== 'string' || useCase.id.length === 0) {
    throw new Error('registerCpqUseCase: useCase.id is required')
  }
  if (!useCase.tenant || typeof useCase.tenant.adminEmail !== 'string') {
    throw new Error(`registerCpqUseCase[${useCase.id}]: tenant.adminEmail is required`)
  }
  if (typeof useCase.seedDefaults !== 'function') {
    throw new Error(`registerCpqUseCase[${useCase.id}]: seedDefaults must be a function`)
  }
  if (registry.has(useCase.id)) {
    console.warn(`[cpq:seeds] Use case "${useCase.id}" re-registered — replacing prior registration.`)
  }
  registry.set(useCase.id, useCase)
}

/** Returns all registered use cases in registration order. */
export function listCpqUseCases(): CpqUseCase[] {
  return Array.from(registry.values())
}

/** Returns the use case with the given id, or undefined. */
export function getCpqUseCase(id: string): CpqUseCase | undefined {
  return registry.get(id)
}

/** Test-only helper to reset the registry between unit tests. */
export function clearCpqUseCases(): void {
  registry.clear()
}
