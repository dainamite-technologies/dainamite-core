/**
 * Translates a bundle offering's `designTimeValues` into a per-slot
 * (offering id + attribute configuration) pair the calculator can drop into
 * the cart.
 *
 * The bundle DTV (seeded in `seeds/data/products.ts`) uses *logical* keys
 * — `db_plan`, `db_ha`, `db_pitr`, `db_backup_days`, `ddos_tier`,
 * `vps_offering`, `workspace_offering`, …  These are deliberately distinct
 * from the per-product attribute codes (`plan_size`, `ha_replicas`,
 * `pitr_enabled`, `backup_retention_days`, …) because one bundle DTV blob
 * fans out across many slots with different attribute namespaces.
 *
 * For each slot key declared in `seeds/seeders/bundles.ts`, this resolver
 * decides:
 *   - whether to include the slot at all (e.g. CDN slot in dev-app bundles
 *     is only present when `cdn: true`);
 *   - which child offering to use (e.g. `ddos_tier: 'advanced'` →
 *     `OFFER-PUFFIN-DDOS-ADV`);
 *   - which configuration attributes to seed on the resulting cart line.
 */

import type { PublicCatalog } from '../types'

// Engine → preferred default version. Mirrors the `engine → versions` map
// in the spec (`xd-275-public-pricing-calculator.md` §products). The
// calculator's CPQ attribute resolver returns a free-text input for
// `version` (no options), so we pick a sensible default per engine instead
// of leaving it empty.
const ENGINE_DEFAULT_VERSION: Record<string, string> = {
  postgres: '16',
  mysql: '8.4',
  redis: '7.2',
  mongodb: '7.0',
}

const DDOS_TIER_TO_OFFERING_CODE: Record<string, string> = {
  standard: 'OFFER-PUFFIN-DDOS-STD',
  advanced: 'OFFER-PUFFIN-DDOS-ADV',
  enterprise: 'OFFER-PUFFIN-DDOS-ENT',
}

export type SlotResolution = {
  /**
   * Whether the slot should be skipped entirely (e.g. optional CDN slot when
   * the bundle DTV says `cdn: false`).
   */
  skip?: boolean
  /** Offering id that overrides the slot's default component. */
  offeringIdOverride?: string
  /** Attributes to seed onto the cart line's configuration. */
  configuration: Record<string, unknown>
}

function findOfferingIdByCode(catalog: PublicCatalog, code: string): string | null {
  for (const spec of catalog.specifications) {
    const found = spec.offerings.find((o) => o.code === code)
    if (found) return found.id
  }
  return null
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function resolveDbSlot(
  dtv: Record<string, unknown>,
  prefix: 'db' | 'cache',
): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  const engine = str(dtv[`${prefix}_engine`])
  if (engine) {
    config.db_engine = engine
    const version = ENGINE_DEFAULT_VERSION[engine]
    if (version) config.version = version
  }
  const plan = str(dtv[`${prefix}_plan`])
  if (plan) config.plan_size = plan
  const ha = num(dtv[`${prefix}_ha`])
  if (ha != null) config.ha_replicas = ha
  // PITR + backups + read replicas only apply to the primary DB slot, not
  // the redis cache. The seed never sets cache_pitr / cache_backup_days,
  // but guarding by prefix keeps the contract explicit.
  if (prefix === 'db') {
    const pitr = bool(dtv.db_pitr)
    if (pitr != null) config.pitr_enabled = pitr
    const backupDays = num(dtv.db_backup_days)
    if (backupDays != null) config.backup_retention_days = String(backupDays)
  }
  return config
}

/**
 * Slot identity used by this resolver = `CpqBundleSlot.name` from the
 * seeds in `seeds/seeders/bundles.ts`. The slot's seed-side `key` (e.g.
 * `'storefront_host'`) is never persisted on the entity, and `componentGroup`
 * collides across slots within a single bundle (two `database`-group slots
 * in ecommerce, two `compute`-group slots in business, two `workspace`-group
 * slots in business). Slot `name` is the only available stable identifier
 * that's unique within a bundle.
 */
export function resolveBundleSlot(
  slotName: string,
  bundleDtv: Record<string, unknown>,
  catalog: PublicCatalog,
): SlotResolution {
  const codeToId = (code: string | undefined): string | undefined => {
    if (!code) return undefined
    return findOfferingIdByCode(catalog, code) ?? undefined
  }

  // VPS-style slots — bundle DTV picks which size offering to use and,
  // optionally, sets the `backups` attribute.
  if (slotName === 'App Host' || slotName === 'Storefront Host') {
    const config: Record<string, unknown> = {}
    const backups = bool(bundleDtv.backups)
    if (backups != null) config.backups = backups
    return { offeringIdOverride: codeToId(str(bundleDtv.vps_offering)), configuration: config }
  }
  if (slotName === 'Public Website') {
    const config: Record<string, unknown> = {}
    const backups = bool(bundleDtv.backups)
    if (backups != null) config.backups = backups
    return {
      offeringIdOverride: codeToId(str(bundleDtv.public_site_offering)),
      configuration: config,
    }
  }
  if (slotName === 'Apps Host') {
    // 0-or-many: only include when apps_count >= 1.
    const count = num(bundleDtv.apps_count) ?? 0
    if (count <= 0) return { skip: true, configuration: {} }
    const config: Record<string, unknown> = {}
    const backups = bool(bundleDtv.backups)
    if (backups != null) config.backups = backups
    return { offeringIdOverride: codeToId(str(bundleDtv.apps_offering)), configuration: config }
  }

  // Managed DB slots. `Database` / `Shared Database` use db_*; `Cache`
  // uses cache_*. All feed the same product (Managed DB).
  if (slotName === 'Database' || slotName === 'Shared Database') {
    return { configuration: resolveDbSlot(bundleDtv, 'db') }
  }
  if (slotName === 'Cache') {
    // Cache slot is optional (min: 0). Only seed when the bundle declares it.
    if (str(bundleDtv.cache_engine) == null) return { skip: true, configuration: {} }
    return { configuration: resolveDbSlot(bundleDtv, 'cache') }
  }

  // DDoS Shield — pick the right tier offering, carry contract_term_months
  // when set (Enterprise tier).
  if (slotName === 'DDoS Shield') {
    const tier = str(bundleDtv.ddos_tier)
    const config: Record<string, unknown> = {}
    const term = num(bundleDtv.contract_term_months)
    if (term != null) config.contract_term_months = term
    return {
      offeringIdOverride: codeToId(tier ? DDOS_TIER_TO_OFFERING_CODE[tier] : undefined),
      configuration: config,
    }
  }

  // Workspace seats — pick the plan offering, carry seat_count + cadence.
  if (slotName === 'Workspace Seats') {
    const config: Record<string, unknown> = {}
    const seats = num(bundleDtv.seat_count)
    if (seats != null) config.seat_count = seats
    const cadence = str(bundleDtv.billing_cadence)
    if (cadence != null) config.billing_cadence = cadence
    return {
      offeringIdOverride: codeToId(str(bundleDtv.workspace_offering)),
      configuration: config,
    }
  }
  if (slotName === 'Workspace Archive Add-on') {
    // Optional add-on (cardinalityMin: 0). Only include when the bundle DTV
    // explicitly turns it on.
    if (bool(bundleDtv.workspace_archive) !== true) return { skip: true, configuration: {} }
    const config: Record<string, unknown> = {}
    const seats = num(bundleDtv.seat_count)
    if (seats != null) config.seat_count = seats
    return { configuration: config }
  }

  // CDN — optional in dev-app bundles; the seed defaultComponent has
  // `isDefault: false` so it would be dropped by the default-pass logic.
  // Re-include when the bundle DTV says `cdn: true`. Pre-fill egress from
  // the bundle's bandwidth estimate (TB → GB).
  if (slotName === 'CDN') {
    if (bool(bundleDtv.cdn) === false) return { skip: true, configuration: {} }
    const config: Record<string, unknown> = {}
    const bandwidthTb = num(bundleDtv.bandwidth_tb)
    if (bandwidthTb != null) config.monthly_egress_gb = bandwidthTb * 1024
    return { configuration: config }
  }

  // Standalone bandwidth slot — same egress estimate.
  if (slotName === 'Bandwidth') {
    const config: Record<string, unknown> = {}
    const bandwidthTb = num(bundleDtv.bandwidth_tb)
    if (bandwidthTb != null) config.monthly_egress_gb = bandwidthTb * 1024
    return { configuration: config }
  }

  // Support tier — bundle DTV names the offering directly.
  if (slotName === 'Support') {
    return { offeringIdOverride: codeToId(str(bundleDtv.support)), configuration: {} }
  }

  // Object Storage slots ('Static Assets', 'Media', 'File Storage') have no
  // DTV-driven attributes (usage is visitor-driven). Leave configuration
  // empty so the visitor can dial in their own estimates.
  return { configuration: {} }
}
