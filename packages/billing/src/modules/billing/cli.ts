import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedBillingDemo } from './lib/seeds/demo'

/**
 * `mercato billing seed [--reset] [--tenant <id>] [--org <id>]`
 *
 * Loads self-contained billing test data (demo accounts + recurring/usage
 * items + an unrated usage record) into a single tenant. With no `--tenant`/
 * `--org`, it resolves the first (primary) organization created by
 * `mercato init`. `--reset` clears the seed's own rows first.
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
      `[billing seed] Multiple organizations found — defaulting to "${org.name}" (${org.id}). ` +
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
      console.error(
        '[billing seed] No organization found. Run "yarn initialize" first, or pass --org <id>.',
      )
      return
    }

    const res = await seedBillingDemo(em, scope, { reset })
    console.log(
      `[billing seed] tenant=${scope.tenantId} org=${scope.organizationId}${reset ? ' (reset)' : ''}\n` +
        `  ✓ accounts +${res.accountsCreated}, items +${res.itemsCreated}, usage +${res.usageCreated} ` +
        `(existing rows left untouched)\n` +
        `  → Bill Runs · New run · As-of = today · Real → invoice for the previous month.`,
    )
  },
}

export default [seed]
