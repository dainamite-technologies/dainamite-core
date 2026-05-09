import type { EntityManager } from '@mikro-orm/postgresql'
import type { SeedScope } from './_types'

type RuleInput = {
  code: string
  name: string
  description?: string
  productOfferingId?: string | null
  ruleType:
    | 'discount_percent'
    | 'discount_absolute'
    | 'surcharge_percent'
    | 'surcharge_absolute'
    | 'price_override'
  value: string
  chargeTypeFilter?: string | null
  chargeCodeFilter?: string | null
  applicabilityCondition?: Record<string, unknown> | null
  sortOrder: number
  isActive?: boolean
  metadata?: Record<string, unknown> | null
}

async function ensureRule(em: EntityManager, scope: SeedScope, data: RuleInput): Promise<void> {
  const { CpqPriceRule } = await import('@dainamite/cpq/modules/cpq/data/entities')
  const exists = await em.findOne(CpqPriceRule, { ...scope, code: data.code })
  if (!exists) {
    em.persist(em.create(CpqPriceRule, { ...scope, ...data }))
  }
}

async function offeringId(em: EntityManager, scope: SeedScope, code: string): Promise<string | null> {
  const { CpqProductOffering } = await import('@dainamite/cpq/modules/cpq/data/entities')
  const o = await em.findOne(CpqProductOffering, { ...scope, code, deletedAt: null })
  return o?.id ?? null
}

// Reserved-eligible offerings per XD-275 Rule 1: VPS family + the single
// Compute offering + the single Managed-DB offering + DDoS (all tiers).
const RESERVED_ELIGIBLE_OFFERING_CODES = [
  'vps_nano',
  'vps_micro',
  'vps_small',
  'vps_medium',
  'vps_large',
  'vps_xlarge',
  'vps_mega',
  'OFFER-PUFFIN-COMPUTE',
  'OFFER-PUFFIN-MANAGED-DB',
  'OFFER-PUFFIN-DDOS-STD',
  'OFFER-PUFFIN-DDOS-ADV',
  'OFFER-PUFFIN-DDOS-ENT',
]

// Workspace plans + add-ons that participate in volume-tier and annual-prepay
// discounts. Mirrors the seat_price-bearing offerings plus storage/compliance.
const WORKSPACE_DISCOUNTABLE_OFFERING_CODES = [
  'workspace_essentials',
  'workspace_business',
  'workspace_business_premium',
  'workspace_enterprise',
  'ws_email_archive',
  'ws_atp',
  'ws_extra_storage',
  'ws_compliance',
]

/**
 * Seed CpqPriceRule rows that implement the XD-275 pricing semantics —
 * reserved discounts, Workspace volume tiers + annual prepay, VPS backups
 * surcharge, and DB attribute-driven surcharges.
 *
 * Important: CPQ's `evaluateApplicability` only understands the
 * `{ attribute, operator: 'eq'|'neq', value }` shape. Anything else (richer
 * condition keys, `gte`/`lte`/`in` operators) silently returns `true` and
 * the rule fires on every line. For that reason scoping is done two ways:
 *   1. Row-level via `productOfferingId` (loaded only for that offering).
 *   2. Inside the `applicabilityCondition` via a single attribute test that
 *      reads from configuration — including the synthetic attributes the
 *      public price route injects (`offering_code`, `seat_volume_tier`,
 *      plus quoteContext fields like `contract_model`, `billing_cadence`).
 */
export async function seedPuffinPriceRules(em: EntityManager, scope: SeedScope): Promise<void> {
  // VPS backups surcharge — +20% on MRC. Scoped by attribute (`backups` is a
  // VPS-only attribute, so non-VPS lines never satisfy the condition).
  await ensureRule(em, scope, {
    code: 'puffin-vps-backups-surcharge',
    name: 'VPS Backups Add-on (+20% MRC)',
    description: 'When backups attribute is true, surcharge VPS MRC by 20%.',
    ruleType: 'surcharge_percent',
    value: '20',
    chargeTypeFilter: 'mrc',
    applicabilityCondition: { attribute: 'backups', operator: 'eq', value: true },
    sortOrder: 10,
    isActive: true,
  })

  // Reserved 1y / 3y discounts — per offering, gated by contract_model. The
  // public price route merges quoteContext into each item's configuration so
  // `contract_model` is available as a normal attribute.
  let reservedSort = 20
  for (const code of RESERVED_ELIGIBLE_OFFERING_CODES) {
    const oid = await offeringId(em, scope, code)
    if (!oid) continue
    await ensureRule(em, scope, {
      code: `puffin-reserved-1y-${code}`,
      name: `Reserved 1y (−22% MRC) — ${code}`,
      description: 'Applies when contract_model = reserved_1y on this offering.',
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '22',
      chargeTypeFilter: 'mrc',
      applicabilityCondition: { attribute: 'contract_model', operator: 'eq', value: 'reserved_1y' },
      sortOrder: reservedSort++,
      isActive: true,
    })
    await ensureRule(em, scope, {
      code: `puffin-reserved-3y-${code}`,
      name: `Reserved 3y (−38% MRC) — ${code}`,
      description: 'Applies when contract_model = reserved_3y on this offering.',
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '38',
      chargeTypeFilter: 'mrc',
      applicabilityCondition: { attribute: 'contract_model', operator: 'eq', value: 'reserved_3y' },
      sortOrder: reservedSort++,
      isActive: true,
    })
  }

  // Workspace volume tiers — mutually exclusive via the synthetic attribute
  // `seat_volume_tier` injected by the public price route based on
  // `seat_count`:
  //   < 26 → 'tier0' (no discount)   26–100 → 'tier1' (−5%)
  //   101–500 → 'tier2' (−10%)       ≥ 501 → 'tier3' (−15%)
  // Per-offering scope avoids spilling onto non-Workspace mrc lines.
  let workspaceSort = 100
  for (const code of WORKSPACE_DISCOUNTABLE_OFFERING_CODES) {
    const oid = await offeringId(em, scope, code)
    if (!oid) continue
    await ensureRule(em, scope, {
      code: `puffin-ws-volume-tier1-${code}`,
      name: `Workspace Volume −5% (26+ seats) — ${code}`,
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '5',
      applicabilityCondition: { attribute: 'seat_volume_tier', operator: 'eq', value: 'tier1' },
      sortOrder: workspaceSort++,
      isActive: true,
      metadata: { volume_tier: 1 },
    })
    await ensureRule(em, scope, {
      code: `puffin-ws-volume-tier2-${code}`,
      name: `Workspace Volume −10% (101+ seats) — ${code}`,
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '10',
      applicabilityCondition: { attribute: 'seat_volume_tier', operator: 'eq', value: 'tier2' },
      sortOrder: workspaceSort++,
      isActive: true,
      metadata: { volume_tier: 2 },
    })
    await ensureRule(em, scope, {
      code: `puffin-ws-volume-tier3-${code}`,
      name: `Workspace Volume −15% (501+ seats) — ${code}`,
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '15',
      applicabilityCondition: { attribute: 'seat_volume_tier', operator: 'eq', value: 'tier3' },
      sortOrder: workspaceSort++,
      isActive: true,
      metadata: { volume_tier: 3 },
    })
    // Annual prepay — multiplies on top of the volume tier (sort > tiers).
    await ensureRule(em, scope, {
      code: `puffin-ws-annual-prepay-${code}`,
      name: `Workspace Annual Prepay (−15%) — ${code}`,
      productOfferingId: oid,
      ruleType: 'discount_percent',
      value: '15',
      applicabilityCondition: { attribute: 'billing_cadence', operator: 'eq', value: 'annual_prepay' },
      sortOrder: workspaceSort++,
      isActive: true,
    })
  }

  // API Gateway free tier — encodes quote-level allowances the engine does
  // not support. Left in the seed (inactive) for documentation; flipping to
  // active before the engine grows allowance-aware math would silently
  // discount every unit by a flat amount.
  await ensureRule(em, scope, {
    code: 'puffin-api-free-tier-requests',
    name: 'API Gateway — first 1M requests free',
    description: 'INACTIVE: requires quote-level allowance math not yet supported by CPQ.',
    ruleType: 'discount_absolute',
    value: '0.20',
    chargeCodeFilter: 'api_gateway_requests',
    applicabilityCondition: null,
    sortOrder: 500,
    isActive: false,
  })
  await ensureRule(em, scope, {
    code: 'puffin-api-free-tier-compute',
    name: 'API Gateway — first 400k GB-s free',
    description: 'INACTIVE: requires quote-level allowance math not yet supported by CPQ.',
    ruleType: 'discount_absolute',
    value: '6.6667',
    chargeCodeFilter: 'api_gateway_compute',
    applicabilityCondition: null,
    sortOrder: 501,
    isActive: false,
  })

  // Managed DB read replicas / PITR rates — encode "X% of HA-0 base", which
  // requires referencing another charge's resolved price (multiplier rules).
  // The engine doesn't expose that. Leave the rows inactive so they don't
  // masquerade as working price_overrides to $0.
  await ensureRule(em, scope, {
    code: 'puffin-db-read-replica-rate',
    name: 'Managed DB — Read Replica rate (60% of HA-0 base)',
    description: 'INACTIVE: requires multiplier-of-base support not yet in CPQ.',
    ruleType: 'price_override',
    value: '0',
    chargeCodeFilter: 'db_read_replicas',
    applicabilityCondition: null,
    sortOrder: 600,
    isActive: false,
  })
  await ensureRule(em, scope, {
    code: 'puffin-db-pitr-rate',
    name: 'Managed DB — PITR Add-on (15% of HA-0 base)',
    description: 'INACTIVE: requires multiplier-of-base support not yet in CPQ.',
    ruleType: 'price_override',
    value: '0',
    chargeCodeFilter: 'db_pitr_addon',
    applicabilityCondition: null,
    sortOrder: 601,
    isActive: false,
  })

  // Managed DB — backup retention surcharges. Already in the supported shape.
  await ensureRule(em, scope, {
    code: 'puffin-db-backup-retention-14',
    name: 'Managed DB — 14-day backup retention (+5% base)',
    description: 'Adds 5% of base MRC when backup_retention_days = 14.',
    ruleType: 'surcharge_percent',
    value: '5',
    chargeCodeFilter: 'db_base_mrc',
    applicabilityCondition: { attribute: 'backup_retention_days', operator: 'eq', value: '14' },
    sortOrder: 620,
    isActive: true,
  })
  await ensureRule(em, scope, {
    code: 'puffin-db-backup-retention-30',
    name: 'Managed DB — 30-day backup retention (+12% base)',
    description: 'Adds 12% of base MRC when backup_retention_days = 30.',
    ruleType: 'surcharge_percent',
    value: '12',
    chargeCodeFilter: 'db_base_mrc',
    applicabilityCondition: { attribute: 'backup_retention_days', operator: 'eq', value: '30' },
    sortOrder: 621,
    isActive: true,
  })

  // Premium Support — composite spend-uplift. Engine sees only the simple
  // `price_override` to 500 (which equals the documented floor). The
  // max(500, 6% × MRC) part is quote-level math not yet supported; leaving
  // this active means visitors always pay the floor — better than $0.
  const premiumOfferingId = await offeringId(em, scope, 'premium_support')
  if (premiumOfferingId) {
    await ensureRule(em, scope, {
      code: 'puffin-premium-support-uplift',
      name: 'Premium Support — Spend Uplift (floor only; full formula needs quote-level math)',
      productOfferingId: premiumOfferingId,
      ruleType: 'price_override',
      value: '500',
      chargeCodeFilter: 'premium_support_base',
      applicabilityCondition: null,
      sortOrder: 999,
      isActive: true,
    })
    await ensureRule(em, scope, {
      code: 'puffin-premium-support-1y',
      name: 'Premium Support — Reserved 1y (−10%)',
      productOfferingId: premiumOfferingId,
      ruleType: 'discount_percent',
      value: '10',
      chargeTypeFilter: 'mrc',
      applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '1y' },
      sortOrder: 700,
      isActive: true,
    })
    await ensureRule(em, scope, {
      code: 'puffin-premium-support-3y',
      name: 'Premium Support — Reserved 3y (−18%)',
      productOfferingId: premiumOfferingId,
      ruleType: 'discount_percent',
      value: '18',
      chargeTypeFilter: 'mrc',
      applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '3y' },
      sortOrder: 701,
      isActive: true,
    })
  }
}
