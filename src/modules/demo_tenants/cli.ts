import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCliModules } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findDemoTenant } from '@dainamite/cpq/modules/cpq/lib/seeds/tenant-provisioning'
import { getCpqUseCase, listCpqUseCases } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { seedUseCase, seedUseCases } from './runner'
import { shouldSkipExamples } from './manifest'

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

const list: ModuleCli = {
  command: 'list',
  async run() {
    // Force module registration side-effects to run before reading the registry.
    getCliModules()
    const useCases = listCpqUseCases()
    if (useCases.length === 0) {
      console.log('No CPQ use cases registered. Make sure your demo_<x> modules are enabled in src/modules.ts.')
      return
    }
    console.log(`Registered CPQ use cases (${useCases.length}):`)
    for (const u of useCases) {
      console.log(
        `  - ${u.id.padEnd(12)} tenant=${u.tenant.tenantName.padEnd(40)} admin=${u.tenant.adminEmail}`,
      )
    }
  },
}

const seed: ModuleCli = {
  command: 'seed',
  async run(rest) {
    const args = parseArgs(rest)
    const seedAll = Boolean(args.all)
    const requestedId = typeof args['use-case'] === 'string' ? args['use-case'] : undefined
    const reset = Boolean(args.reset)

    if (!seedAll && !requestedId) {
      console.error(
        'Usage: mercato demo-tenants seed (--all | --use-case <id>) [--reset]',
      )
      return
    }

    const cliModules = getCliModules()
    const allUseCases = listCpqUseCases()
    if (allUseCases.length === 0) {
      console.error('No CPQ use cases registered.')
      return
    }

    let target = seedAll ? allUseCases : []
    if (requestedId) {
      const match = getCpqUseCase(requestedId)
      if (!match) {
        console.error(`Unknown use case "${requestedId}". Run "mercato demo-tenants list" to see registered ids.`)
        return
      }
      target = [match]
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    if (reset) {
      for (const uc of target) {
        const existing = await findDemoTenant(em, uc.tenant)
        if (!existing) {
          console.log(`[demo-tenants] reset: use case "${uc.id}" not yet provisioned, nothing to reset.`)
          continue
        }
        await deleteCpqRowsForTenant(em, existing.tenantId, existing.organizationId)
        console.log(`[demo-tenants] reset: cleared CPQ rows for use case "${uc.id}" tenant ${existing.tenantId}`)
      }
    }

    const withExamples = !shouldSkipExamples()
    const processedTenantIds = new Set<string>()
    const outcomes = seedAll
      ? await seedUseCases(target, { em, container, modules: cliModules, withExamples, processedTenantIds })
      : [
          await seedUseCase(target[0], {
            em,
            container,
            modules: cliModules,
            withExamples,
            processedTenantIds,
          }),
        ]

    for (const out of outcomes) {
      console.log(
        `  ✓ ${out.useCaseId}: tenant=${out.tenantId} ${out.created ? 'created' : 'reused'} in ${out.durationMs}ms`,
      )
    }
  },
}

const env: ModuleCli = {
  command: 'env',
  async run(rest) {
    const args = parseArgs(rest)
    const requestedId = typeof args['use-case'] === 'string' ? args['use-case'] : undefined
    if (!requestedId) {
      console.error('Usage: mercato demo-tenants env --use-case <id>')
      return
    }
    const useCase = getCpqUseCase(requestedId)
    if (!useCase) {
      console.error(`Unknown use case "${requestedId}".`)
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    const found = await findDemoTenant(em, useCase.tenant)
    if (!found) {
      console.error(`Use case "${requestedId}" not yet provisioned. Run "mercato demo-tenants seed --use-case ${requestedId}" first.`)
      return
    }
    // Standard envs that the public calculator (XD-275) reads.
    console.log(`# Paste into .env.local for the ${requestedId} demo`)
    console.log(`CPQ_PUBLIC_CALCULATOR_TENANT_ID=${found.tenantId}`)
    console.log(`CPQ_PUBLIC_CALCULATOR_ORG_ID=${found.organizationId}`)
  },
}

/**
 * Delete CPQ-owned rows for a single tenant in dependency order. Never
 * touches Tenant, Organization, User, or non-CPQ tables.
 */
async function deleteCpqRowsForTenant(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  const conn = em.getConnection()
  // Order matters: leaves first, roots last.
  const tables = [
    'cpq_offering_components',
    'cpq_bundle_slots',
    'cpq_product_charges',
    'cpq_pricing_table_entries',
    'cpq_pricing_tables',
    'cpq_product_attributes',
    'cpq_price_rules',
    'cpq_product_offerings',
    'cpq_product_specifications',
    'cpq_wizard_definitions',
    // Quote-side rows are the demo example data created by seedExamples.
    'cpq_quote_line_configurations',
    'cpq_quote_configurations',
  ]
  for (const table of tables) {
    try {
      await conn.execute(
        `DELETE FROM ${table} WHERE tenant_id = ? AND organization_id = ?`,
        [tenantId, organizationId],
      )
    } catch (err) {
      console.warn(`[demo-tenants] reset: failed to clear ${table}: ${(err as Error).message}`)
    }
  }
}

export default [list, seed, env]
