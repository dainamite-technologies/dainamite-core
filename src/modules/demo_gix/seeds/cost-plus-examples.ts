import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { FeatureToggle, FeatureToggleOverride } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CpqChargeCostElement,
  CpqPricingTable,
  CpqPricingTableEntry,
  CpqProductAttribute,
  CpqProductCharge,
  CpqProductOffering,
  CpqProductSpecification,
  CpqQuoteConfiguration,
} from '@dainamite/cpq/modules/cpq/data/entities'
import { COST_PLUS_TOGGLE } from '@dainamite/cpq/modules/cpq/data/costs'
import { seedCostPlusDefaults } from '@dainamite/cpq/modules/cpq/lib/costPlusDefaults'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import type { CpqQuoteCostService } from '@dainamite/cpq/modules/cpq/services/costs/quoteCostService'
import { DATA_CENTRE_OPTIONS } from './data/products'
import {
  COST_ELEMENTS,
  COST_PLUS_SCENARIOS,
  CROSS_CONNECT_COST_TABLE,
  IP_TRANSIT,
  PARTNER_SUPPLIER,
  PARTNER_TAIL_ESTIMATE,
} from './data/cost-plus'

/** Seeds run without a signed-in user; the nil UUID marks system-authored demo rows. */
const SEED_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'
const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'
const log = (msg: string) => console.log(`    [demo_gix:cost-plus] ${msg}`)

/**
 * Turn `cpq.cost_plus` on for this tenant (default stays off elsewhere, R14).
 * Registers the global toggle when missing and adds a per-tenant override;
 * an existing override (an operator's choice) is never touched.
 */
export async function enableGixCostPlus(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  await seedCostPlusDefaults(em)
  const toggle = await em.findOne(FeatureToggle, { identifier: COST_PLUS_TOGGLE })
  if (!toggle) { log('Skipping the tenant override — the cpq.cost_plus toggle is not registered.'); return }
  const existing = await em.findOne(FeatureToggleOverride, { toggle, tenantId: scope.tenantId })
  if (existing) return
  em.persist(em.create(FeatureToggleOverride, { toggle, tenantId: scope.tenantId, value: true }))
  await em.flush()
  try {
    const toggles = container.resolve('featureTogglesService') as { invalidateIsEnabledCacheByKey?: (id: string, tenantId: string) => Promise<void> }
    await toggles.invalidateIsEnabledCacheByKey?.(COST_PLUS_TOGGLE, scope.tenantId)
  } catch {
    // A stale cache entry only delays the override until it expires.
  }
}

/**
 * Catalog side: the cross-connect cost table, the "IP Transit with partner tail"
 * product / specification / offering and its cost-plus charge with three cost
 * elements (table + on-request price basis, one margin-only). Idempotent.
 */
export async function seedGixCostPlusCatalog(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  await enableGixCostPlus(em, container, scope)
  const filter = { ...scope, deletedAt: null }

  // 1. Cost table (purpose = cost) and its entries.
  let table = await em.findOne(CpqPricingTable, { ...scope, code: CROSS_CONNECT_COST_TABLE.code })
  if (!table) {
    table = em.create(CpqPricingTable, {
      ...scope,
      code: CROSS_CONNECT_COST_TABLE.code,
      name: CROSS_CONNECT_COST_TABLE.name,
      purpose: 'cost',
      dimensions: [{ key: 'data_centre', label: 'Data Centre' }],
      priceColumns: [{ key: CROSS_CONNECT_COST_TABLE.column, label: 'Monthly cost (MRC)' }],
      currencyCodeList: [IP_TRANSIT.currency],
    })
    em.persist(table)
    await em.flush()
  }
  for (const [dataCentre, cost] of Object.entries(CROSS_CONNECT_COST_TABLE.entries)) {
    const dimensionValues = { data_centre: dataCentre }
    const exists = await em.findOne(CpqPricingTableEntry, { ...scope, pricingTableId: table.id, dimensionValues })
    if (!exists) {
      em.persist(em.create(CpqPricingTableEntry, {
        ...scope, pricingTableId: table.id, currencyCode: IP_TRANSIT.currency, dimensionValues,
        prices: { [CROSS_CONNECT_COST_TABLE.column]: cost },
      }))
    }
  }
  await em.flush()

  // 2. Product, attribute, specification, offering.
  let product = await em.findOne(CatalogProduct, { ...scope, sku: IP_TRANSIT.sku, deletedAt: null })
  if (!product) {
    product = em.create(CatalogProduct, {
      ...scope, title: IP_TRANSIT.title, sku: IP_TRANSIT.sku, handle: IP_TRANSIT.sku.toLowerCase(),
      productType: 'configurable', description: IP_TRANSIT.description, isConfigurable: true, isActive: true,
    })
    em.persist(product)
    await em.flush()
  }
  let spec = await em.findOne(CpqProductSpecification, { ...scope, code: IP_TRANSIT.specCode })
  if (!spec) {
    spec = em.create(CpqProductSpecification, {
      ...scope, productId: product.id, code: IP_TRANSIT.specCode, name: `${IP_TRANSIT.title} Specification`,
      description: IP_TRANSIT.description, lifecycleStatus: 'active', version: 1,
    })
    em.persist(spec)
    await em.flush()
  }
  let offering = await em.findOne(CpqProductOffering, { ...scope, code: IP_TRANSIT.offerCode })
  if (!offering) {
    offering = em.create(CpqProductOffering, {
      ...scope, specId: spec.id, code: IP_TRANSIT.offerCode, name: IP_TRANSIT.title,
      description: `${IP_TRANSIT.title} — priced from costs plus a markup`, lifecycleStatus: 'active',
    })
    em.persist(offering)
    await em.flush()
  }
  const attribute = await em.findOne(CpqProductAttribute, { ...scope, productId: product.id, code: 'data_centre' })
  if (!attribute) {
    em.persist(em.create(CpqProductAttribute, {
      ...scope, productId: product.id, specId: spec.id, code: 'data_centre', name: 'Data Centre', attributeType: 'enum',
      options: DATA_CENTRE_OPTIONS.map((option) => ({ value: option.value, label: option.label })), sortOrder: 0, isRequired: true,
    }))
  }

  // 3. The cost-plus charge: markup on the price-basis costs; the fixed price is the indicative fallback.
  let charge = await em.findOne(CpqProductCharge, { ...scope, productId: product.id, code: IP_TRANSIT.chargeCode })
  if (!charge) {
    charge = em.create(CpqProductCharge, {
      ...scope, productId: product.id, offeringId: offering.id, code: IP_TRANSIT.chargeCode, name: 'IP Transit Fee',
      chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus',
      markupRule: 'markup_percent', markupValue: String(IP_TRANSIT.markupPercent),
      fixedPrice: String(IP_TRANSIT.fallbackPrice), currencyCode: IP_TRANSIT.currency, sortOrder: 0, isActive: true,
    })
    em.persist(charge)
    await em.flush()
  }

  // 4. Cost elements (the code is the quote cost key).
  const ensureElement = async (code: string, data: Record<string, unknown>) => {
    const exists = await em.findOne(CpqChargeCostElement, { ...filter, productChargeId: charge!.id, code })
    if (!exists) {
      em.persist(em.create(CpqChargeCostElement, { ...scope, productChargeId: charge!.id, code, costType: 'mrc', costModel: 'flat', isActive: true, ...data } as never))
    }
  }
  await ensureElement(COST_ELEMENTS.crossConnect, {
    name: 'Cross-connect', role: 'price_basis', source: 'table', costTableId: table.id,
    costColumnKey: CROSS_CONNECT_COST_TABLE.column, requiresSourcing: false, sortOrder: 0,
  })
  await ensureElement(COST_ELEMENTS.partnerTail, {
    name: 'Partner tail', role: 'price_basis', source: 'on_request', estimateAmount: String(PARTNER_TAIL_ESTIMATE),
    currencyCode: IP_TRANSIT.currency, defaultSupplierName: PARTNER_SUPPLIER, defaultValidityDays: 30, requiresSourcing: true, sortOrder: 1,
  })
  await ensureElement(COST_ELEMENTS.monitoring, {
    name: 'NOC monitoring (internal)', role: 'margin_only', source: 'fixed', amount: '40', currencyCode: IP_TRANSIT.currency,
    requiresSourcing: false, sortOrder: 2,
  })
  await em.flush()
}

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/**
 * Demo quotes, one per cost state: pending (no cost match), estimated,
 * confirmed and expired (supplier validity in the past). Idempotent per scenario.
 */
export async function seedGixCostPlusExamples(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const companies = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'company', deletedAt: null }, { limit: 500 }, scope)
  const customer = companies.find((company) => company.displayName === ACME_DISPLAY_NAME)
  if (!customer) { log(`Skipping — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const offering = await em.findOne(CpqProductOffering, { ...scope, code: IP_TRANSIT.offerCode, deletedAt: null })
  if (!offering) { log('Skipping — the IP Transit offering is not seeded.'); return }
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  const costs = container.resolve('cpqQuoteCostService') as CpqQuoteCostService
  const existing = await em.find(CpqQuoteConfiguration, { ...scope, customerId: customer.id, deletedAt: null })
  const present = new Set(existing.map((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario))

  for (const demo of Object.values(COST_PLUS_SCENARIOS)) {
    if (present.has(demo.scenario)) { log(`Skipping "${demo.scenario}" — already present.`); continue }
    let quote = await quoting.createQuote({
      customerId: customer.id, currencyCode: IP_TRANSIT.currency,
      quoteContext: { demo_marker: 'cpq-seed-v1', scenario: demo.scenario, label: demo.label },
    }, scope)
    quote = await quoting.addQuoteItem(quote.id, { offeringId: offering.id, configuration: { data_centre: demo.dataCentre }, quantity: 1, termMonths: 12 }, scope)
    if ('partnerTail' in demo) {
      const read = await costs.read(quote.id, scope, true)
      const tail = read.lines.flatMap((line) => line.costs).find((cost) => cost.costKey === COST_ELEMENTS.partnerTail)
      if (!tail) { log(`"${demo.scenario}": no partner-tail cost line — left estimated.`); continue }
      await costs.updateCost(quote.id, tail.id, {
        unitAmount: demo.partnerTail, currencyCode: IP_TRANSIT.currency, valueStatus: 'confirmed',
        supplierName: PARTNER_SUPPLIER, supplierQuoteRef: `PCL-${demo.scenario}`, validUntil: isoDay(demo.validDays),
        note: 'Supplier quote received',
      }, SEED_ACTOR_USER_ID, scope)
    }
    log(`Quote for "${demo.scenario}" created.`)
  }
}
