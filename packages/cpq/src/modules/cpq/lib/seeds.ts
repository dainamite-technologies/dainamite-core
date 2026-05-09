import type { EntityManager } from '@mikro-orm/postgresql'

export type CpqSeedScope = { tenantId: string; organizationId: string }

/**
 * Generic CPQ defaults seed.
 *
 * After XD-276 the cpq module ships with no built-in wizard or product
 * defaults — vertical-specific seeds live in app-level `demo_<x>` modules
 * that register CPQ use cases via `cpq/lib/seeds/api.ts`.
 *
 * The export is kept as a no-op so existing call sites and any external
 * tooling that imported it before the refactor still resolve. New code
 * should not call this — register a use case instead.
 */
export async function seedCpqDefaults(_em: EntityManager, _scope: CpqSeedScope): Promise<void> {
  // Intentionally empty: see XD-276 for the migration rationale.
}
