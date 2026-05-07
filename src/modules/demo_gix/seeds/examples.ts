import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  CustomerCompanyProfile,
  CustomerEntity,
} from '@open-mercato/core/modules/customers/data/entities'
import { CpqProductOffering } from '../../cpq/data/entities'
import type { TenantScope } from '../../cpq/services/types'
import type { DefaultCpqQuotingService } from '../../cpq/services/cpqQuotingService'
import type { DefaultCpqOrderService } from '../../cpq/services/cpqOrderService'
import type { DefaultCpqInventoryService } from '../../cpq/services/cpqInventoryService'

/**
 * Seed sample GIX demo data: companies, quotes (across statuses), an order
 * activation, and the resulting subscription + assets.
 *
 * Idempotent: skips on re-run by checking for the marker company.
 * Defensive: warns and skips if required offerings are not seeded yet.
 *
 * Migrated from src/modules/cpq/lib/example-seeds.ts (XD-210). Now scoped to
 * the GIX use case so its data only seeds into the GIX tenant.
 */
export async function seedGixExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: TenantScope,
): Promise<void> {
  const log = (msg: string) => console.log(`    [demo_gix:examples] ${msg}`)

  // 1. Idempotency guard — skip if marker company already exists
  const existing = await em.findOne(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: ACME.displayName,
    deletedAt: null,
  })
  if (existing) {
    log(`Skipping — demo company "${ACME.displayName}" already present.`)
    return
  }

  // 2. Look up required offerings by code; bail out softly if missing
  const offerings = await loadOfferings(em, scope)
  if (!offerings.accessPort || !offerings.cloudConnect || !offerings.internetPeering) {
    log('Required offerings not seeded yet — run seedDefaults first. Skipping.')
    return
  }

  // 3. Resolve services
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  const orders = container.resolve('cpqOrderService') as DefaultCpqOrderService
  // Resolve to validate registration even if not used directly here.
  container.resolve('cpqInventoryService') as DefaultCpqInventoryService

  // 4. Create demo companies
  const acme = await ensureCompany(em, scope, ACME)
  const globex = await ensureCompany(em, scope, GLOBEX)
  await em.flush()
  log(`Companies created: ${acme.displayName}, ${globex.displayName}`)

  // 5. Quote A1 — Acme, GIX Access Port 10G Amsterdam — full happy path
  let quoteA1 = await quoting.createQuote(
    {
      customerId: acme.id,
      currencyCode: 'USD',
      quoteContext: { demo_marker: DEMO_MARKER, scenario: 'acme-amsterdam-port' },
    },
    scope,
  )
  quoteA1 = await quoting.addQuoteItem(
    quoteA1.id,
    {
      offeringId: offerings.accessPort.id,
      configuration: {
        port_size: '10G',
        data_centre: 'equinix-am1',
      },
      quantity: 1,
      termMonths: 12,
    },
    scope,
  )
  quoteA1 = await quoting.recalculate(quoteA1.id, { save: true }, scope)
  quoteA1 = await safeTransition(quoting, quoteA1, 'ready', scope)
  quoteA1 = await safeTransition(quoting, quoteA1, 'with_customer', scope)
  quoteA1 = await safeTransition(quoting, quoteA1, 'accepted', scope)
  log(`Quote A1 (accepted): ${quoteA1.quoteNumber} — total MRC ${quoteA1.pricingSummary.mrcTotal}`)

  const orderA1 = await orders.convertQuoteToOrder(quoteA1.id, scope)
  log(`Order A1 (draft): ${orderA1.orderNumber ?? orderA1.id}`)

  const activatedA1 = await orders.activateOrder(orderA1.id, scope)
  log(`Order A1 activated → subscription + assets created (status: ${activatedA1.cpqStatus})`)

  // 6. Quote A2 — Acme, GIX Cloud Connect — sent, awaiting decision
  let quoteA2 = await quoting.createQuote(
    {
      customerId: acme.id,
      currencyCode: 'USD',
      quoteContext: { demo_marker: DEMO_MARKER, scenario: 'acme-cloud-connect-aws' },
    },
    scope,
  )
  quoteA2 = await quoting.addQuoteItem(
    quoteA2.id,
    {
      offeringId: offerings.cloudConnect.id,
      configuration: {
        cloud_provider: 'aws',
        cloud_region: 'eu-west-1',
        pricing_model: 'flat',
        bandwidth_mb: 100,
      },
      quantity: 1,
      termMonths: 24,
    },
    scope,
  )
  quoteA2 = await quoting.recalculate(quoteA2.id, { save: true }, scope)
  quoteA2 = await safeTransition(quoting, quoteA2, 'ready', scope)
  quoteA2 = await safeTransition(quoting, quoteA2, 'with_customer', scope)
  log(`Quote A2 (with_customer): ${quoteA2.quoteNumber} — Cloud Connect AWS eu-west-1 100Mbps`)

  // 7. Quote B1 — Globex, GIX Connectivity Bundle — ready (priced, not yet sent)
  if (offerings.bundle) {
    let quoteB1 = await quoting.createQuote(
      {
        customerId: globex.id,
        currencyCode: 'USD',
        quoteContext: { demo_marker: DEMO_MARKER, scenario: 'globex-bundle' },
      },
      scope,
    )
    quoteB1 = await quoting.addQuoteItem(
      quoteB1.id,
      {
        offeringId: offerings.bundle.id,
        configuration: {},
        quantity: 1,
        termMonths: 36,
      },
      scope,
    )
    quoteB1 = await quoting.recalculate(quoteB1.id, { save: true }, scope)
    quoteB1 = await safeTransition(quoting, quoteB1, 'ready', scope)
    log(`Quote B1 (ready): ${quoteB1.quoteNumber} — Connectivity Bundle 36mo`)
  } else {
    log('Bundle offering not seeded — skipping Quote B1.')
  }

  // 8. Quote B2 — Globex, Internet Peering 500Mbps — incomplete (draft)
  let quoteB2 = await quoting.createQuote(
    {
      customerId: globex.id,
      currencyCode: 'USD',
      quoteContext: { demo_marker: DEMO_MARKER, scenario: 'globex-peering-500' },
    },
    scope,
  )
  quoteB2 = await quoting.addQuoteItem(
    quoteB2.id,
    {
      offeringId: offerings.internetPeering.id,
      configuration: { bandwidth_mb: 500 },
      quantity: 1,
    },
    scope,
  )
  log(`Quote B2 (${quoteB2.cpqStatus}): ${quoteB2.quoteNumber} — Internet Peering 500Mbps draft`)

  log('Example seed complete: 2 companies, 4 quotes, 1 order activated, subscription+assets generated.')
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const DEMO_MARKER = 'cpq-seed-v1'

async function safeTransition(
  quoting: DefaultCpqQuotingService,
  current: { id: string; cpqStatus: string },
  target: string,
  scope: TenantScope,
) {
  if (current.cpqStatus === target) return current as any
  return quoting.transitionStatus(current.id, target, scope)
}

const ACME = {
  displayName: 'Acme Telecom S.A.',
  primaryEmail: 'sales@acme-telecom.example',
  primaryPhone: '+48 22 555 0100',
  legalName: 'Acme Telecom Spółka Akcyjna',
  brandName: 'Acme Telecom',
  domain: 'acme-telecom.example',
  websiteUrl: 'https://acme-telecom.example',
  industry: 'Telecommunications',
  sizeBucket: '500-1000',
} as const

const GLOBEX = {
  displayName: 'Globex Industries Sp. z o.o.',
  primaryEmail: 'procurement@globex.example',
  primaryPhone: '+48 12 555 0200',
  legalName: 'Globex Industries Spółka z ograniczoną odpowiedzialnością',
  brandName: 'Globex',
  domain: 'globex.example',
  websiteUrl: 'https://globex.example',
  industry: 'Manufacturing',
  sizeBucket: '100-500',
} as const

type CompanySeed = typeof ACME | typeof GLOBEX

async function ensureCompany(
  em: EntityManager,
  scope: TenantScope,
  data: CompanySeed,
): Promise<CustomerEntity> {
  const existing = await em.findOne(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: data.displayName,
    deletedAt: null,
  })
  if (existing) return existing

  const entity = em.create(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind: 'company',
    displayName: data.displayName,
    primaryEmail: data.primaryEmail,
    primaryPhone: data.primaryPhone,
    status: 'active',
    lifecycleStage: 'customer',
    source: 'cpq_demo_seed',
    isActive: true,
  })
  em.create(CustomerCompanyProfile, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    legalName: data.legalName,
    brandName: data.brandName,
    domain: data.domain,
    websiteUrl: data.websiteUrl,
    industry: data.industry,
    sizeBucket: data.sizeBucket,
    entity,
  })
  return entity
}

async function loadOfferings(
  em: EntityManager,
  scope: TenantScope,
): Promise<{
  accessPort: CpqProductOffering | null
  cloudConnect: CpqProductOffering | null
  internetPeering: CpqProductOffering | null
  bundle: CpqProductOffering | null
}> {
  const filter = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  }
  return {
    accessPort: await em.findOne(CpqProductOffering, { ...filter, code: 'OFFER-GIX-ACCESS-PORT' }),
    cloudConnect: await em.findOne(CpqProductOffering, { ...filter, code: 'OFFER-GIX-CLOUD-CONNECT' }),
    internetPeering: await em.findOne(CpqProductOffering, { ...filter, code: 'OFFER-GIX-INTERNET-PEERING' }),
    bundle: await em.findOne(CpqProductOffering, { ...filter, code: 'OFFER-GIX-CONNECTIVITY-BUNDLE' }),
  }
}
