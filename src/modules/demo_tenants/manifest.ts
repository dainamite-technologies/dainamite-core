import { listCpqUseCases, type CpqUseCase } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const DEFAULT_USE_CASES = ['gix', 'puffin'] as const

/**
 * Resolves which CPQ use cases the demo_tenants orchestrator should seed.
 *
 * Selection logic:
 *   1. Read the comma-separated `CPQ_DEMO_USE_CASES` env. Defaults to
 *      `gix,puffin` so a fresh `yarn initialize` produces both demo tenants.
 *   2. `*` (or `all`) selects every use case currently in the registry.
 *   3. An explicit empty string selects none — useful for production
 *      deployments that only want the primary tenant.
 *   4. Unknown ids are dropped with a warning, never throw — running
 *      `yarn initialize` should not fail because an env file references a
 *      decommissioned use case.
 *
 * The function is pure: it reads `process.env` and the registry at call
 * time. Tests can manipulate both freely.
 */
export function getEnabledUseCases(): CpqUseCase[] {
  const all = listCpqUseCases()
  if (all.length === 0) return []

  const raw = process.env.CPQ_DEMO_USE_CASES
  if (raw === undefined) {
    // Default: every name in DEFAULT_USE_CASES that is registered.
    return DEFAULT_USE_CASES.map((id) => all.find((u) => u.id === id)).filter(
      (u): u is CpqUseCase => Boolean(u),
    )
  }

  const trimmed = raw.trim()
  if (trimmed === '') return []
  if (trimmed === '*' || trimmed.toLowerCase() === 'all') return [...all]

  const requestedIds = trimmed
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  const out: CpqUseCase[] = []
  for (const id of requestedIds) {
    const match = all.find((u) => u.id === id)
    if (match) {
      out.push(match)
    } else {
      console.warn(`[demo_tenants] CPQ_DEMO_USE_CASES references unknown use case "${id}" — skipping.`)
    }
  }
  return out
}

/**
 * True when the operator opted out of example data (via `mercato init
 * --no-examples` or `CPQ_DEMO_SKIP_EXAMPLES=1`).
 *
 * The CLI surface for `--no-examples` is consumed by the framework, not by
 * us — we only see it as an env var the CLI relays. The fallback
 * `CPQ_DEMO_SKIP_EXAMPLES` lets operators turn off examples without
 * touching the framework's flag set.
 */
export function shouldSkipExamples(): boolean {
  if (parseBooleanWithDefault(process.env.CPQ_DEMO_SKIP_EXAMPLES, false)) return true
  if (parseBooleanWithDefault(process.env.OM_INIT_NO_EXAMPLES, false)) return true
  return false
}
