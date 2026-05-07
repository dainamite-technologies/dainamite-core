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
  const { CpqPriceRule } = await import('../../../cpq/data/entities')
  const exists = await em.findOne(CpqPriceRule, { ...scope, code: data.code })
  if (!exists) {
    em.persist(em.create(CpqPriceRule, { ...scope, ...data }))
  }
}

async function offeringId(em: EntityManager, scope: SeedScope, code: string): Promise<string | null> {
  const { CpqProductOffering } = await import('../../../cpq/data/entities')
  const o = await em.findOne(CpqProductOffering, { ...scope, code, deletedAt: null })
  return o?.id ?? null
}

/**
 * Seed CpqPriceRule rows that implement the XD-275 pricing semantics —
 * reserved discounts, Workspace volume tiers + annual prepay, API Gateway
 * free tier, Premium Support spend-uplift `price_override`, VPS backups
 * surcharge, and DB attribute-driven surcharges.
 *
 * Where possible we reference offering ids so re-runs after offering
 * deletion don't dangle.
 */
export async function seedPuffinPriceRules(em: EntityManager, scope: SeedScope): Promise<void> {
  // VPS backups surcharge — +20% on MRC, scoped to the VPS spec.
  await ensureRule(em, scope, {
    code: 'puffin-vps-backups-surcharge',
    name: 'VPS Backups Add-on (+20% MRC)',
    description: 'When backups attribute is true, surcharge VPS MRC by 20%.',
    ruleType: 'surcharge_percent',
    value: '20',
    chargeTypeFilter: 'mrc',
    applicabilityCondition: {
      offeringSpecCode: 'SPEC-PUFFIN-VPS',
      attribute: 'backups',
      operator: 'eq',
      value: true,
    },
    sortOrder: 10,
    isActive: true,
  })

  // Reserved discounts — 1y −22%, 3y −38%. Scoped to specs that are reserved-eligible
  // per XD-275 Rule 1: VPS, Compute, Managed DB, DDoS adv/ent.
  await ensureRule(em, scope, {
    code: 'puffin-reserved-1y',
    name: 'Reserved 1-year discount (−22% MRC)',
    description: 'Applies to reserved-eligible specs when contract_model = reserved_1y.',
    ruleType: 'discount_percent',
    value: '22',
    chargeTypeFilter: 'mrc',
    applicabilityCondition: {
      contractModel: 'reserved_1y',
      offeringSpecCodeIn: [
        'SPEC-PUFFIN-VPS',
        'SPEC-PUFFIN-COMPUTE',
        'SPEC-PUFFIN-MANAGED-DB',
        'SPEC-PUFFIN-DDOS',
      ],
    },
    sortOrder: 20,
    isActive: true,
  })
  await ensureRule(em, scope, {
    code: 'puffin-reserved-3y',
    name: 'Reserved 3-year discount (−38% MRC)',
    description: 'Applies to reserved-eligible specs when contract_model = reserved_3y.',
    ruleType: 'discount_percent',
    value: '38',
    chargeTypeFilter: 'mrc',
    applicabilityCondition: {
      contractModel: 'reserved_3y',
      offeringSpecCodeIn: [
        'SPEC-PUFFIN-VPS',
        'SPEC-PUFFIN-COMPUTE',
        'SPEC-PUFFIN-MANAGED-DB',
        'SPEC-PUFFIN-DDOS',
      ],
    },
    sortOrder: 21,
    isActive: true,
  })

  // Workspace volume tiers — mutually exclusive via priority order. Each
  // applies to all Workspace charges. Volume tier rules apply only when seat
  // count exceeds the threshold; the rule engine selects the highest match.
  const workspacePlanCodes = [
    'workspace_essentials',
    'workspace_business',
    'workspace_business_premium',
    'workspace_enterprise',
    'ws_email_archive',
    'ws_atp',
    'ws_extra_storage',
    'ws_compliance',
  ]
  await ensureRule(em, scope, {
    code: 'puffin-ws-volume-25',
    name: 'Workspace Volume −5% (≥26 seats)',
    description: 'Applies when seat_count ≥ 26.',
    ruleType: 'discount_percent',
    value: '5',
    applicabilityCondition: {
      offeringCodeIn: workspacePlanCodes,
      attribute: 'seat_count',
      operator: 'gte',
      value: 26,
    },
    sortOrder: 30,
    isActive: true,
    metadata: { volume_tier: 1 },
  })
  await ensureRule(em, scope, {
    code: 'puffin-ws-volume-100',
    name: 'Workspace Volume −10% (≥101 seats)',
    description: 'Applies when seat_count ≥ 101.',
    ruleType: 'discount_percent',
    value: '10',
    applicabilityCondition: {
      offeringCodeIn: workspacePlanCodes,
      attribute: 'seat_count',
      operator: 'gte',
      value: 101,
    },
    sortOrder: 31,
    isActive: true,
    metadata: { volume_tier: 2 },
  })
  await ensureRule(em, scope, {
    code: 'puffin-ws-volume-500',
    name: 'Workspace Volume −15% (≥501 seats)',
    description: 'Applies when seat_count ≥ 501.',
    ruleType: 'discount_percent',
    value: '15',
    applicabilityCondition: {
      offeringCodeIn: workspacePlanCodes,
      attribute: 'seat_count',
      operator: 'gte',
      value: 501,
    },
    sortOrder: 32,
    isActive: true,
    metadata: { volume_tier: 3 },
  })

  // Annual prepay — multiplies on top of volume tier.
  await ensureRule(em, scope, {
    code: 'puffin-ws-annual-prepay',
    name: 'Workspace Annual Prepay (−15%)',
    description: 'Applies when quoteContext.billing_cadence = annual_prepay.',
    ruleType: 'discount_percent',
    value: '15',
    applicabilityCondition: {
      offeringCodeIn: workspacePlanCodes,
      contextField: 'billing_cadence',
      operator: 'eq',
      value: 'annual_prepay',
    },
    sortOrder: 40,
    isActive: true,
  })

  // API Gateway free tier — subtract 1M requests + 400k GB-s/month.
  await ensureRule(em, scope, {
    code: 'puffin-api-free-tier-requests',
    name: 'API Gateway — first 1M requests free',
    description: 'Subtracts up to 1M requests/month from the request usage subtotal.',
    ruleType: 'discount_absolute',
    value: '0.20',
    chargeCodeFilter: 'api_gateway_requests',
    applicabilityCondition: { allowance_million_requests: 1 },
    sortOrder: 50,
    isActive: true,
  })
  await ensureRule(em, scope, {
    code: 'puffin-api-free-tier-compute',
    name: 'API Gateway — first 400k GB-s free',
    description: 'Subtracts up to 400,000 GB-s/month from the compute subtotal.',
    ruleType: 'discount_absolute',
    value: '6.6667',
    chargeCodeFilter: 'api_gateway_compute',
    applicabilityCondition: { allowance_gb_seconds: 400000 },
    sortOrder: 51,
    isActive: true,
  })

  // Managed DB — read replica rate (60% of HA-0 base, per replica)
  await ensureRule(em, scope, {
    code: 'puffin-db-read-replica-rate',
    name: 'Managed DB — Read Replica rate (60% of HA-0 base)',
    description: 'Multiplies the read_replicas charge by HA-0 base × 0.6 per replica.',
    ruleType: 'price_override',
    value: '0',
    chargeCodeFilter: 'db_read_replicas',
    applicabilityCondition: { multiplierKey: 'db_ha0_base', multiplier: 0.6 },
    sortOrder: 60,
    isActive: true,
  })

  // Managed DB — PITR add-on (15% of HA-0 base)
  await ensureRule(em, scope, {
    code: 'puffin-db-pitr-rate',
    name: 'Managed DB — PITR Add-on (15% of HA-0 base)',
    description: 'Sets PITR add-on charge to 15% of HA-0 base when pitr_enabled is true.',
    ruleType: 'price_override',
    value: '0',
    chargeCodeFilter: 'db_pitr_addon',
    applicabilityCondition: { multiplierKey: 'db_ha0_base', multiplier: 0.15 },
    sortOrder: 61,
    isActive: true,
  })

  // Managed DB — backup retention surcharge (+5% for 14, +12% for 30)
  await ensureRule(em, scope, {
    code: 'puffin-db-backup-retention-14',
    name: 'Managed DB — 14-day backup retention (+5% base)',
    description: 'Adds 5% of base MRC when backup_retention_days = 14.',
    ruleType: 'surcharge_percent',
    value: '5',
    chargeCodeFilter: 'db_base_mrc',
    applicabilityCondition: { attribute: 'backup_retention_days', operator: 'eq', value: '14' },
    sortOrder: 62,
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
    sortOrder: 63,
    isActive: true,
  })

  // Premium Support — composite spend-uplift (price_override).
  // Implementation note: the rule references quote-level totals via
  // `applicabilityCondition.use_total_mrc_excluding_codes_prefix`. The pricing
  // engine already evaluates rules in priority order with quote totals
  // available — we set the priority high so this runs LAST.
  const premiumOfferingId = await offeringId(em, scope, 'premium_support')
  await ensureRule(em, scope, {
    code: 'puffin-premium-support-uplift',
    name: 'Premium Support — Spend Uplift max(500, 6% × MRC)',
    description: 'Sets premium_support_base to max(500, 0.06 × sum_of_mrc_excluding_support).',
    productOfferingId: premiumOfferingId,
    ruleType: 'price_override',
    value: '500',
    chargeCodeFilter: 'premium_support_base',
    applicabilityCondition: {
      formula: 'max(base, percent_of_quote_mrc)',
      base: 500,
      percent: 6,
      excludeChargeCodePrefixes: ['support_', 'premium_support_'],
    },
    sortOrder: 999, // evaluate last
    isActive: true,
  })

  // Premium Support — reserved discounts.
  await ensureRule(em, scope, {
    code: 'puffin-premium-support-1y',
    name: 'Premium Support — Reserved 1y (−10%)',
    productOfferingId: premiumOfferingId,
    ruleType: 'discount_percent',
    value: '10',
    chargeTypeFilter: 'mrc',
    applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '1y' },
    sortOrder: 70,
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
    sortOrder: 71,
    isActive: true,
  })
}
