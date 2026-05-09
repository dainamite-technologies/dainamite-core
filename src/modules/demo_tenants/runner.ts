import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { Module } from '@open-mercato/shared/modules/registry'
import { ensureCustomRoleAcls } from '@open-mercato/core/modules/auth/lib/setup-app'
import { ensureDemoTenant } from '@dainamite/cpq/modules/cpq/lib/seeds/tenant-provisioning'
import type { CpqUseCase } from '@dainamite/cpq/modules/cpq/lib/seeds/api'

export type RunnerOptions = {
  em: EntityManager
  container: AwilixContainer
  /**
   * The full set of registered modules. Required so we can replay each
   * module's `seedDefaults` and `seedExamples` against the new tenant scope
   * — the same loop `mercato init` runs for the primary tenant.
   */
  modules: Module[]
  /** When false, skip per-use-case `seedExamples` AND skip module-level seedExamples for the new tenant. */
  withExamples: boolean
  /**
   * Tenants we have already processed in this run. Prevents the orchestrator
   * from re-entering itself when it loops module `seedExamples` for the
   * newly created tenant (our own `seedExamples` lives in that module list).
   *
   * Mutated by reference. Callers seed it with the primary tenant id.
   */
  processedTenantIds: Set<string>
}

export type SeedUseCaseOutcome = {
  useCaseId: string
  tenantId: string
  organizationId: string
  created: boolean
  durationMs: number
}

/**
 * Provision the use case's tenant and seed its CPQ data.
 *
 * Idempotent: re-running on an already-initialised DB is a fast no-op.
 *
 * Steps for each use case (mirrors `mercato init`'s flow for the primary tenant):
 *   1. ensureDemoTenant — Tenant + Organization + admin user + roles + KMS DEK
 *      (delegates to setupInitialTenant, which itself runs each module's
 *       onTenantCreated hook).
 *   2. for every registered module: setup.seedDefaults({ scope: new tenant }).
 *   3. ensureCustomRoleAcls — picks up custom roles created in step 2.
 *   4. useCase.seedDefaults — products, pricing, charges, rules, bundles, wizards.
 *   5. (if withExamples) for every registered module: setup.seedExamples({ scope }).
 *      Skipped for the orchestrator's own module to avoid recursion.
 *   6. (if withExamples and useCase has it) useCase.seedExamples.
 */
export async function seedUseCase(
  useCase: CpqUseCase,
  options: RunnerOptions,
): Promise<SeedUseCaseOutcome> {
  const startedAt = Date.now()
  const ensured = await ensureDemoTenant(options.em, options.container, useCase.tenant, {
    modules: options.modules,
  })
  const scope = { tenantId: ensured.tenantId, organizationId: ensured.organizationId }

  console.log(
    `  [demo_tenants] use-case "${useCase.id}" → tenant ${ensured.tenantId} (${ensured.created ? 'created' : 'reused'}), admin=${useCase.tenant.adminEmail}`,
  )
  options.processedTenantIds.add(ensured.tenantId)

  // Replay framework module seedDefaults for the new tenant.
  for (const mod of options.modules) {
    if (mod.id === 'demo_tenants') continue // never re-enter ourselves
    if (mod.setup?.seedDefaults) {
      await mod.setup.seedDefaults({ ...scope, em: options.em, container: options.container })
    }
  }

  // Pick up any custom roles seeded by app modules in step 2.
  await ensureCustomRoleAcls(options.em, ensured.tenantId, options.modules)

  // Use-case-specific catalog seed.
  await useCase.seedDefaults({ ...scope, em: options.em, container: options.container, withExamples: options.withExamples })

  if (options.withExamples) {
    // Replay module-level seedExamples for this tenant. Skip our own module
    // to avoid the recursion that would otherwise re-seed every other tenant.
    for (const mod of options.modules) {
      if (mod.id === 'demo_tenants') continue
      if (mod.setup?.seedExamples) {
        await mod.setup.seedExamples({ ...scope, em: options.em, container: options.container })
      }
    }
    if (useCase.seedExamples) {
      await useCase.seedExamples({ ...scope, em: options.em, container: options.container, withExamples: true })
    }
  }

  return {
    useCaseId: useCase.id,
    tenantId: ensured.tenantId,
    organizationId: ensured.organizationId,
    created: ensured.created,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * Walk a list of use cases sequentially, seeding each into its own tenant.
 * Returns one outcome per use case.
 */
export async function seedUseCases(
  useCases: CpqUseCase[],
  options: RunnerOptions,
): Promise<SeedUseCaseOutcome[]> {
  const outcomes: SeedUseCaseOutcome[] = []
  for (const useCase of useCases) {
    outcomes.push(await seedUseCase(useCase, options))
  }
  return outcomes
}
