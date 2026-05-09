import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  CustomerCompanyProfile,
  CustomerEntity,
} from '@open-mercato/core/modules/customers/data/entities'
import { CpqInventorySubscription } from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqInventoryService } from '@dainamite/cpq/modules/cpq/services/cpqInventoryService'

/**
 * XD-250 ARC demo seed.
 *
 * Creates a dedicated company ("Meridian Connectivity Sp. z o.o.") and a
 * portfolio of subscriptions that exercise every ARC operator scenario:
 *
 *   • Amend            — single sub, simple item set, term well in the future
 *   • Renew (standalone) — single sub, term about to expire, picks up in the
 *                          Expiring Subscriptions list with a 30-day window
 *   • Cancel           — single sub, ready to terminate
 *   • Multi-target Amend — pair of subs for the same customer
 *   • Merge renewal    — three subs sharing customer/currency/billingCycle,
 *                        all expiring within the 30-day window
 *   • Suspended        — sub in 'suspended' status (still a valid ARC target)
 *
 * Idempotent: the marker company "Meridian Connectivity Sp. z o.o." is
 * created once; subsequent runs detect it and skip. Wired into `setup.seedExamples`,
 * so it only runs when the operator opted in to example seeding (NOT
 * during plain `seedDefaults` and NOT in production tenant init).
 *
 * The seed bypasses the Quote → Order → Activate flow on purpose — it
 * uses `cpqInventoryService.createSubscription` + transitions directly,
 * which is significantly faster and produces clean fixture state without
 * dragging seed pricing rules / offerings into the picture. The resulting
 * subs have null `sourceQuoteId` / `sourceOrderId`, which is fine for ARC
 * (the ARC flow itself produces non-null source ids on the *change* —
 * not the original sub).
 */
export async function seedCpqArcExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: TenantScope,
): Promise<void> {
  const log = (msg: string) => console.log(`    [cpq:arc-examples] ${msg}`)

  // 1. Idempotency guard — skip if marker company already present.
  const existing = await em.findOne(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: ARC_DEMO.displayName,
    deletedAt: null,
  })
  if (existing) {
    log(`Skipping — demo company "${ARC_DEMO.displayName}" already present.`)
    return
  }

  const inventory = container.resolve('cpqInventoryService') as DefaultCpqInventoryService

  // 2. Create the marker company.
  const company = ensureCompany(em, scope)
  await em.flush()
  log(`Company created: ${company.displayName}`)

  // 3. Spin up the portfolio. Each helper creates one subscription, optionally
  //    sets currentTermEnd, and optionally suspends it.
  const created: Array<{ scenario: string; code: string; status: string; termEnd: string | null }> = []

  for (const seed of SCENARIOS) {
    const sub = await inventory.createSubscription(
      {
        customerId: company.id,
        code: seed.code,
        name: seed.name,
        description: seed.description,
        billingCycle: seed.billingCycle,
        currencyCode: 'USD',
        termMonths: seed.termMonths,
        items: seed.items,
        metadata: { arcScenario: seed.scenario, demoMarker: ARC_DEMO_MARKER },
      },
      scope,
    )

    // pending → active (every scenario ships in active state at least briefly).
    await inventory.transitionSubscriptionStatus(sub.id, 'active', scope)

    // currentTermEnd is what drives the Expiring Subscriptions list — set it
    // explicitly when the scenario wants to land in the operator's renewal
    // triage view.
    if (seed.daysToExpire != null) {
      const termEnd = daysFromNow(seed.daysToExpire)
      await inventory.updateSubscription(sub.id, { currentTermEnd: termEnd }, scope)
    }

    // Final status flip for scenarios that need to be e.g. suspended.
    if (seed.finalStatus && seed.finalStatus !== 'active') {
      await inventory.transitionSubscriptionStatus(sub.id, seed.finalStatus, scope)
    }

    const termEnd = seed.daysToExpire != null ? daysFromNow(seed.daysToExpire) : null
    created.push({
      scenario: seed.scenario,
      code: seed.code,
      status: seed.finalStatus ?? 'active',
      termEnd,
    })
  }

  log(`Created ${created.length} subscription(s) across ${SCENARIOS.length} ARC scenario(s):`)
  for (const c of created) {
    const termInfo = c.termEnd ? ` (term ends ${c.termEnd})` : ''
    log(`  - ${c.code} [${c.status}]${termInfo} → ${c.scenario}`)
  }
  log('Tip: see /backend/cpq/inventory/subscriptions — click any sub to try Amend/Renew/Cancel.')
  log('Tip: see /backend/cpq/inventory/subscriptions/expiring — drives the renewal triage view.')
}

// ─── Scenario portfolio ──────────────────────────────────────────

interface ScenarioSeed {
  scenario: string
  code: string
  name: string
  description: string
  billingCycle: 'monthly' | 'quarterly' | 'annually'
  termMonths: number
  /** ISO term-end days from today; null = leave term-end unset. */
  daysToExpire: number | null
  /**
   * Final status to leave the sub in. Defaults to 'active'. Terminal statuses
   * (`expired`, `terminated`) are reachable only via `active → terminal`, so
   * the seed first activates and then transitions; both transitions are
   * within the allowed state-machine.
   */
  finalStatus?: 'active' | 'suspended' | 'terminated' | 'expired'
  items: Array<{
    name: string
    mrcAmount?: number
    nrcAmount?: number
  }>
}

const SCENARIOS: ScenarioSeed[] = [
  // ── Amend ────────────────────────────────────────────────────
  {
    scenario: 'amend (single target, items mid-term)',
    code: 'SUB-ARC-AMEND-1',
    name: 'Amend Demo — Add / remove items',
    description: 'Active subscription with room to add lines. Term well in the future.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 180,
    items: [
      { name: 'Premium Support Tier', mrcAmount: 250 },
      { name: 'Extra Storage 100GB', mrcAmount: 50 },
    ],
  },

  // ── Renew (standalone) ──────────────────────────────────────
  {
    scenario: 'renew standalone (within Expiring window)',
    code: 'SUB-ARC-RENEW-SOON',
    name: 'Renew Demo — Term ending in 20d',
    description: 'Operator should pick this up via the Expiring Subscriptions list.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 20,
    items: [{ name: 'Standard Plan', mrcAmount: 199 }],
  },

  // ── Cancel ───────────────────────────────────────────────────
  {
    scenario: 'cancel (with reason + ETF)',
    code: 'SUB-ARC-CANCEL',
    name: 'Cancel Demo — Single item to terminate',
    description: 'Use the Cancel header button + drawer to stamp reason + ETF.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 90,
    items: [{ name: 'Trial Plan', mrcAmount: 49 }],
  },

  // ── Multi-target Amend ───────────────────────────────────────
  {
    scenario: 'multi-target amend (paired with MULTI-B)',
    code: 'SUB-ARC-MULTI-A',
    name: 'Multi-target Demo A — pair with MULTI-B',
    description: 'Open Amend on this then attach MULTI-B from the drawer.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 60,
    items: [{ name: 'Account A — Service', mrcAmount: 75 }],
  },
  {
    scenario: 'multi-target amend (paired with MULTI-A)',
    code: 'SUB-ARC-MULTI-B',
    name: 'Multi-target Demo B — pair with MULTI-A',
    description: 'Pickable as a 2nd target from MULTI-A\'s Amend drawer.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 60,
    items: [{ name: 'Account B — Service', mrcAmount: 75 }],
  },

  // ── Merge renewal ────────────────────────────────────────────
  // Three subs, same customer/currency/billingCycle, all in the Expiring
  // window — open Renew on MERGE-1, attach MERGE-2 + MERGE-3 in the drawer,
  // drawer auto-flips to merge mode.
  {
    scenario: 'merge renewal source (1 of 3)',
    code: 'SUB-ARC-MERGE-1',
    name: 'Merge Source 1 — same cycle/currency as 2 + 3',
    description: 'Open Renew → attach MERGE-2 and MERGE-3 → drawer enters merge mode.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 25,
    items: [{ name: 'Site North', mrcAmount: 320 }],
  },
  {
    scenario: 'merge renewal source (2 of 3)',
    code: 'SUB-ARC-MERGE-2',
    name: 'Merge Source 2 — same cycle/currency as 1 + 3',
    description: 'Pickable as merge target from MERGE-1\'s Renew drawer.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 25,
    items: [{ name: 'Site South', mrcAmount: 280 }],
  },
  {
    scenario: 'merge renewal source (3 of 3)',
    code: 'SUB-ARC-MERGE-3',
    name: 'Merge Source 3 — same cycle/currency as 1 + 2',
    description: 'Pickable as merge target from MERGE-1\'s Renew drawer.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 25,
    items: [{ name: 'Site East', mrcAmount: 410 }],
  },

  // ── Suspended (still a valid ARC target) ─────────────────────
  {
    scenario: 'amend on suspended sub (status not changed by ARC)',
    code: 'SUB-ARC-SUSPENDED',
    name: 'Suspended Demo — ARC works on suspended subs',
    description: 'Spec § DD-ARC: amend / standalone-renew / cancel work on suspended subs without reactivating.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 120,
    finalStatus: 'suspended',
    items: [{ name: 'Paused Service', mrcAmount: 130 }],
  },

  // ── Negative scenario: terminal-status subs (ARC unavailable) ──
  // These are seeded so operators can verify that the subscription detail
  // page hides the Amend / Renew / Cancel buttons when the sub is in a
  // terminal state. Spec § UI Integration line 794 — the action row only
  // renders when status ∈ {active, suspended}.
  {
    scenario: 'expired sub (ARC buttons hidden, terminal)',
    code: 'SUB-ARC-EXPIRED',
    name: 'Expired Demo — term ended, ARC unavailable',
    description: 'Subscription whose term lapsed without renewal. ARC buttons MUST NOT render.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: -10, // term ended 10 days ago
    finalStatus: 'expired',
    items: [{ name: 'Lapsed Plan', mrcAmount: 89 }],
  },
  {
    scenario: 'terminated sub (ARC buttons hidden, terminal)',
    code: 'SUB-ARC-TERMINATED',
    name: 'Terminated Demo — cancelled previously, ARC unavailable',
    description: 'Subscription that was cancelled before. ARC buttons MUST NOT render. Change History should still be visible.',
    billingCycle: 'monthly',
    termMonths: 12,
    daysToExpire: 60,
    finalStatus: 'terminated',
    items: [{ name: 'Old Plan', mrcAmount: 199 }],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────

const ARC_DEMO_MARKER = 'cpq-arc-seed-v1'

// Meridian Connectivity — fictional B2B telecom operator used as the
// demo customer for every ARC scenario. Domain uses RFC 2606 .example TLD
// (same convention as the Acme / Globex demo seeds).
const ARC_DEMO = {
  displayName: 'Meridian Connectivity Sp. z o.o.',
  primaryEmail: 'noc@meridian-connectivity.example',
  primaryPhone: '+48 22 555 0300',
  legalName: 'Meridian Connectivity Spółka z ograniczoną odpowiedzialnością',
  brandName: 'Meridian',
  domain: 'meridian-connectivity.example',
  websiteUrl: 'https://meridian-connectivity.example',
  industry: 'Telecommunications',
  sizeBucket: '100-500',
} as const

function ensureCompany(em: EntityManager, scope: TenantScope): CustomerEntity {
  const entity = em.create(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind: 'company',
    displayName: ARC_DEMO.displayName,
    primaryEmail: ARC_DEMO.primaryEmail,
    primaryPhone: ARC_DEMO.primaryPhone,
    status: 'active',
    lifecycleStage: 'customer',
    source: 'cpq_meridian_demo_seed',
    isActive: true,
  })
  em.create(CustomerCompanyProfile, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    legalName: ARC_DEMO.legalName,
    brandName: ARC_DEMO.brandName,
    domain: ARC_DEMO.domain,
    websiteUrl: ARC_DEMO.websiteUrl,
    industry: ARC_DEMO.industry,
    sizeBucket: ARC_DEMO.sizeBucket,
    entity,
  })
  return entity
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

// Re-export marker constants for tests / cleanup scripts that may want to
// detect or purge seeded data.
export const ARC_SEED_MARKER_COMPANY = ARC_DEMO.displayName
export const ARC_SEED_MARKER_CONTEXT = ARC_DEMO_MARKER

/**
 * Returns the seed scenario codes — useful for tests that want to assert
 * the seed produced the expected set without hard-coding strings.
 */
export function listArcSeedSubscriptionCodes(): string[] {
  return SCENARIOS.map((s) => s.code)
}

/**
 * Returns the marker subscriptions currently in the database (active OR
 * suspended). Useful for tests / dev tools.
 */
export async function findArcSeedSubscriptions(
  em: EntityManager,
  scope: TenantScope,
): Promise<CpqInventorySubscription[]> {
  return em.find(
    CpqInventorySubscription,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      code: { $in: listArcSeedSubscriptionCodes() },
    },
    { orderBy: { code: 'asc' } },
  )
}
