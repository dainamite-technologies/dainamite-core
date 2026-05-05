import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { getEnabledUseCases, shouldSkipExamples } from './manifest'
import { seedUseCases } from './runner'

/**
 * Multi-tenant orchestrator (XD-276).
 *
 * Hooks into `mercato init`'s `seedExamples` lifecycle. When fired against
 * the primary tenant (e.g. ACME), it walks every CPQ use case registered by
 * the demo_<x> modules and provisions a separate tenant per use case with
 * its own admin user and CPQ data.
 *
 * Why the seedExamples slot:
 *   - It runs after every framework module's seedDefaults — so module-scoped
 *     dictionaries / units / encryption maps are already in place.
 *   - It is naturally gated by `--no-examples`, which is the right semantics
 *     for "the demo tenants are example data".
 *
 * Recursion guard:
 *   When we provision a new tenant, we replay every module's seedDefaults
 *   AND seedExamples for that scope (including our own module). The runner
 *   filters demo_tenants out of those replays, so the orchestrator only
 *   runs once per `mercato init` invocation.
 */
export const setup: ModuleSetupConfig = {
  async seedExamples({ em, container, tenantId }) {
    const useCases = getEnabledUseCases()
    if (useCases.length === 0) {
      console.log('[demo_tenants] no use cases enabled (CPQ_DEMO_USE_CASES is empty) — skipping.')
      return
    }

    const skipExamples = shouldSkipExamples()
    const withExamples = !skipExamples
    if (skipExamples) {
      console.log('[demo_tenants] withExamples=false (CPQ_DEMO_SKIP_EXAMPLES / OM_INIT_NO_EXAMPLES set).')
    }

    const modules = getModules()
    const processedTenantIds = new Set<string>([tenantId])

    console.log(
      `[demo_tenants] seeding ${useCases.length} use case(s): ${useCases.map((u) => u.id).join(', ')}`,
    )
    const outcomes = await seedUseCases(useCases, {
      em,
      container,
      modules,
      withExamples,
      processedTenantIds,
    })

    console.log('[demo_tenants] summary:')
    for (const out of outcomes) {
      console.log(
        `  - ${out.useCaseId}: tenant=${out.tenantId} ${out.created ? 'created' : 'reused'} in ${out.durationMs}ms`,
      )
    }
  },
}

export default setup
