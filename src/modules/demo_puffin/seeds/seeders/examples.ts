import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  CustomerCompanyProfile,
  CustomerEntity,
} from '@open-mercato/core/modules/customers/data/entities'
import { CpqProductOffering } from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'

const DEMO_MARKER = 'puffin-seed-v1'

const ACME_APPS = {
  displayName: 'Acme Apps Ltd',
  primaryEmail: 'orders@acme-apps.example',
  primaryPhone: '+1 415 555 0101',
  legalName: 'Acme Apps Limited',
  brandName: 'Acme Apps',
  domain: 'acme-apps.example',
  websiteUrl: 'https://acme-apps.example',
  industry: 'Software',
  sizeBucket: '10-50',
} as const

const NORTHBEACH = {
  displayName: 'Northbeach Shop',
  primaryEmail: 'ops@northbeach.example',
  primaryPhone: '+44 20 7946 0102',
  legalName: 'Northbeach Trading Ltd',
  brandName: 'Northbeach',
  domain: 'northbeach.example',
  websiteUrl: 'https://northbeach.example',
  industry: 'Retail',
  sizeBucket: '50-100',
} as const

const TUNDRA = {
  displayName: 'Tundra Mining Co.',
  primaryEmail: 'it@tundra-mining.example',
  primaryPhone: '+1 907 555 0103',
  legalName: 'Tundra Mining Company',
  brandName: 'Tundra',
  domain: 'tundra-mining.example',
  websiteUrl: 'https://tundra-mining.example',
  industry: 'Mining',
  sizeBucket: '500-1000',
} as const

type CompanySeed = typeof ACME_APPS | typeof NORTHBEACH | typeof TUNDRA

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
    source: 'puffin_demo_seed',
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

async function findOffering(em: EntityManager, scope: TenantScope, code: string) {
  return em.findOne(CpqProductOffering, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code,
    deletedAt: null,
  })
}

/**
 * Seed three Puffin demo customers + one quote each, matching the XD-275
 * "Customer / Quote / Lines / Why" table. Each quote exercises a different
 * pricing path: bundle expansion, multi-region bundle, volume×prepay×uplift.
 *
 * Idempotent via the marker company check.
 */
export async function seedPuffinExamplesImpl(
  em: EntityManager,
  container: AwilixContainer,
  scope: TenantScope,
): Promise<void> {
  const log = (msg: string) => console.log(`    [demo_puffin:examples] ${msg}`)

  const existing = await em.findOne(CustomerEntity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    displayName: ACME_APPS.displayName,
    deletedAt: null,
  })
  if (existing) {
    log(`Skipping — demo company "${ACME_APPS.displayName}" already present.`)
    return
  }

  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService

  // Companies
  const acme = await ensureCompany(em, scope, ACME_APPS)
  const northbeach = await ensureCompany(em, scope, NORTHBEACH)
  const tundra = await ensureCompany(em, scope, TUNDRA)
  await em.flush()
  log(`Companies created: ${acme.displayName}, ${northbeach.displayName}, ${tundra.displayName}`)

  // Quote 1 — Acme Apps, dev-app standard package (bundle expansion)
  const devApp = await findOffering(em, scope, 'dev_app_standard')
  if (devApp) {
    let q1 = await quoting.createQuote(
      {
        customerId: acme.id,
        currencyCode: 'USD',
        quoteContext: { demo_marker: DEMO_MARKER, scenario: 'acme-apps-dev-standard', fromBundle: devApp.id },
      },
      scope,
    )
    q1 = await quoting.addQuoteItem(
      q1.id,
      { offeringId: devApp.id, configuration: { region: 'fra1' }, quantity: 1, termMonths: 12 },
      scope,
    )
    try {
      q1 = await quoting.recalculate(q1.id, { save: true }, scope)
      log(`Quote 1 (Acme Apps dev-app/standard): ${q1.quoteNumber}`)
    } catch (err) {
      log(`Quote 1 recalculate skipped: ${(err as Error).message}`)
    }
  }

  // Quote 2 — Northbeach Shop, ecommerce growing shop
  const ecom = await findOffering(em, scope, 'ecom_growing_shop')
  if (ecom) {
    let q2 = await quoting.createQuote(
      {
        customerId: northbeach.id,
        currencyCode: 'USD',
        quoteContext: { demo_marker: DEMO_MARKER, scenario: 'northbeach-ecom-growing', fromBundle: ecom.id },
      },
      scope,
    )
    q2 = await quoting.addQuoteItem(
      q2.id,
      { offeringId: ecom.id, configuration: { region: 'fra1' }, quantity: 1, termMonths: 12 },
      scope,
    )
    try {
      q2 = await quoting.recalculate(q2.id, { save: true }, scope)
      log(`Quote 2 (Northbeach ecom/growing): ${q2.quoteNumber}`)
    } catch (err) {
      log(`Quote 2 recalculate skipped: ${(err as Error).message}`)
    }
  }

  // Quote 3 — Tundra, custom enterprise mix exercising volume×prepay×uplift
  const wsEnt = await findOffering(em, scope, 'workspace_enterprise')
  const premium = await findOffering(em, scope, 'premium_support')
  const vpsLarge = await findOffering(em, scope, 'vps_large')
  if (wsEnt && premium && vpsLarge) {
    let q3 = await quoting.createQuote(
      {
        customerId: tundra.id,
        currencyCode: 'USD',
        quoteContext: {
          demo_marker: DEMO_MARKER,
          scenario: 'tundra-enterprise-mix',
          contract_model: 'reserved_3y',
          billing_cadence: 'annual_prepay',
        },
      },
      scope,
    )
    q3 = await quoting.addQuoteItem(
      q3.id,
      { offeringId: vpsLarge.id, configuration: { region: 'fra1', backups: true }, quantity: 2, termMonths: 36 },
      scope,
    )
    q3 = await quoting.addQuoteItem(
      q3.id,
      { offeringId: wsEnt.id, configuration: { seat_count: 250 }, quantity: 1, termMonths: 12 },
      scope,
    )
    q3 = await quoting.addQuoteItem(
      q3.id,
      { offeringId: premium.id, configuration: { reserved_term: '3y', dedicated_line: false }, quantity: 1, termMonths: 36 },
      scope,
    )
    try {
      q3 = await quoting.recalculate(q3.id, { save: true }, scope)
      log(`Quote 3 (Tundra enterprise mix): ${q3.quoteNumber}`)
    } catch (err) {
      log(`Quote 3 recalculate skipped: ${(err as Error).message}`)
    }
  }

  log('Puffin examples seed complete.')
}
