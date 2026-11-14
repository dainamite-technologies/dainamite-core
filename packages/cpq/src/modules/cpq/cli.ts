import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedCpqDemo } from './lib/seeds/demo'
import { seedPriceAdjustmentDefaults } from './lib/priceAdjustmentDefaults'
import { seedCostPlusDefaults } from './lib/costPlusDefaults'
import { scrubChangeLogCosts } from './lib/scrubChangeLogCosts'

/**
 * `mercato cpq seed [--reset] [--tenant <id>] [--org <id>]`
 *
 * Loads a minimal, neutral CPQ test catalog (product + specification +
 * offering + charge) into a single tenant. With no `--tenant`/`--org` it
 * resolves the first (primary) organization created by `mercato init`.
 * `--reset` clears the seed's own rows first.
 *
 * For rich, vertical demo catalogs use `mercato demo_tenants seed --all`.
 */

function parseArgs(rest: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

async function resolveScope(
  em: EntityManager,
  args: Record<string, string | boolean>,
): Promise<{ tenantId: string; organizationId: string } | null> {
  const orgArg = typeof args.org === 'string' ? args.org : undefined
  const tenantArg = typeof args.tenant === 'string' ? args.tenant : undefined

  const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')

  if (orgArg) {
    const org = await em.findOne(Organization, { id: orgArg } as never)
    if (!org) return null
    return { organizationId: org.id, tenantId: tenantArg ?? org.tenant.id }
  }

  const orgs = await em.find(
    Organization,
    { isActive: true } as never,
    { orderBy: { createdAt: 'asc' } as never, limit: 5 },
  )
  if (orgs.length === 0) return null
  const org = orgs[0]
  if (orgs.length > 1) {
    console.warn(
      `[cpq seed] Multiple organizations found — defaulting to "${org.name}" (${org.id}). ` +
        `Pass --org <id> to target another.`,
    )
  }
  return { organizationId: org.id, tenantId: tenantArg ?? org.tenant.id }
}

const seed: ModuleCli = {
  command: 'seed',
  async run(rest) {
    const args = parseArgs(rest)
    const reset = Boolean(args.reset)

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const scope = await resolveScope(em, args)
    if (!scope) {
      console.error('[cpq seed] No organization found. Run "yarn initialize" first, or pass --org <id>.')
      return
    }

    const res = await seedCpqDemo(em, scope, { reset })
    console.log(
      `[cpq seed] tenant=${scope.tenantId} org=${scope.organizationId}${reset ? ' (reset)' : ''}\n` +
        `  ✓ products +${res.productsCreated}, specs +${res.specsCreated}, ` +
        `offerings +${res.offeringsCreated}, charges +${res.chargesCreated} (existing rows left untouched)\n` +
        `  → Backend · CPQ · Product Specifications / Product Offerings.`,
    )
  },
}

/**
 * `mercato cpq seed-price-adjustments [--tenant <id>] [--org <id>]`
 *
 * Upgrade step for tenants created before negotiated prices shipped: adds the
 * `cpq.manual_price_adjustments` toggle and the `cpq.price_adjustment_reason`
 * dictionary for every active organization (or one, with `--org` /
 * `--tenant`). Idempotent — existing labels and toggle values are kept.
 * Pair with `mercato auth sync-role-acls` for the `cpq.quotes.adjust_price` grant.
 */
const seedPriceAdjustments: ModuleCli = {
  command: 'seed-price-adjustments',
  async run(rest) {
    const args = parseArgs(rest)
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const scopes = await resolveAllScopes(em, args)
    if (scopes.length === 0) {
      console.error('[cpq seed-price-adjustments] No matching organization found.')
      return
    }
    let failed = 0
    for (const scope of scopes) {
      try {
        await seedPriceAdjustmentDefaults(em.fork(), scope)
        console.log(`[cpq seed-price-adjustments] tenant=${scope.tenantId} org=${scope.organizationId} ✓`)
      } catch (error) {
        failed++
        console.error(`[cpq seed-price-adjustments] tenant=${scope.tenantId} org=${scope.organizationId} failed`, error)
      }
    }
    if (failed) process.exitCode = 1
  },
}

/**
 * `mercato cpq seed-cost-plus`
 *
 * Upgrade step for installs created before cost-plus pricing shipped: registers
 * the global `cpq.cost_plus` feature toggle (default off). Idempotent — an
 * existing toggle and every per-tenant override are kept. Switch it on per
 * tenant in Feature Toggles; pair with `mercato auth sync-role-acls` for the
 * `cpq.costs.view` / `cpq.costs.manage` grants.
 */
const seedCostPlus: ModuleCli = {
  command: 'seed-cost-plus',
  async run() {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    try {
      await seedCostPlusDefaults(em.fork())
      console.log('[cpq seed-cost-plus] cpq.cost_plus toggle registered (existing values kept) ✓')
    } catch (error) {
      console.error('[cpq seed-cost-plus] failed', error)
      process.exitCode = 1
    }
  },
}

/**
 * `mercato cpq scrub-change-log-costs [--tenant <id>] [--dry-run]`
 *
 * Rollback aid for the cost carry-through: removes every `items[].costs` and
 * `assets[].costs` key from the `before_snapshot` / `after_snapshot` of
 * `cpq_subscription_change_logs` (all tenants, or one with `--tenant`).
 * Idempotent; `--dry-run` only counts. The cost history it removes is gone for
 * good. Rollback order: scrub, then code, then down-migration (MIGRATION.md).
 */
const scrubChangeLogCostsCommand: ModuleCli = {
  command: 'scrub-change-log-costs',
  async run(rest) {
    const args = parseArgs(rest)
    const dryRun = Boolean(args['dry-run'])
    const tenantId = typeof args.tenant === 'string' ? args.tenant : undefined
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    try {
      const res = await scrubChangeLogCosts(em.fork(), { tenantId, dryRun })
      console.log(
        `[cpq scrub-change-log-costs] ${tenantId ? `tenant=${tenantId}` : 'all tenants'}${dryRun ? ' (dry run, nothing written)' : ''}: ` +
          `scanned ${res.scanned} change-log rows, ${dryRun ? 'would scrub' : 'scrubbed'} ${res.affected}`,
      )
    } catch (error) {
      console.error('[cpq scrub-change-log-costs] failed', error)
      process.exitCode = 1
    }
  },
}

async function resolveAllScopes(
  em: EntityManager,
  args: Record<string, string | boolean>,
): Promise<Array<{ tenantId: string; organizationId: string }>> {
  const { Organization } = await import('@open-mercato/core/modules/directory/data/entities')
  const where: Record<string, unknown> = { isActive: true, deletedAt: null }
  if (typeof args.org === 'string') where.id = args.org
  if (typeof args.tenant === 'string') where.tenant = args.tenant
  const orgs = await em.find(Organization, where as never, { orderBy: { createdAt: 'asc' } as never })
  return orgs.map((org) => ({ organizationId: org.id, tenantId: org.tenant.id }))
}

export default [seed, seedPriceAdjustments, seedCostPlus, scrubChangeLogCostsCommand]
