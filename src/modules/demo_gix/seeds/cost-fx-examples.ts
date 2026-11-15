import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ExchangeRate } from '@open-mercato/core/modules/currencies/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CpqChargeCostElement,
  CpqProductCharge,
  CpqProductOffering,
  CpqProductSpecification,
  CpqQuoteConfiguration,
} from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import { FX_DEMO } from './data/cost-plus'

const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'
const log = (msg: string) => console.log(`    [demo_gix:cost-fx] ${msg}`)

/** UTC midnight `offsetDays` from `now`: the only instant `currencies.getRate` matches (UP-FX-1). */
export function utcMidnight(offsetDays: number, now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
}

/**
 * Demo USD→EUR rates for the last three days (source `Manual`, UTC midnight). Written straight to the framework
 * `ExchangeRate` entity (this is an L3 demo module; CPQ itself only reads through `exchangeRateService`). Idempotent per
 * (pair, day, source): an operator's own row for the same day and source is never overwritten.
 */
export async function seedGixDemoFxRates(em: EntityManager, scope: TenantScope, now: Date = new Date()): Promise<void> {
  for (const [index, rate] of FX_DEMO.rates.entries()) {
    const date = utcMidnight(-index, now)
    const where = {
      ...scope, fromCurrencyCode: FX_DEMO.costCurrency, toCurrencyCode: FX_DEMO.quoteCurrency, date, source: FX_DEMO.rateSource,
    }
    if (await em.findOne(ExchangeRate, where)) continue
    em.persist(em.create(ExchangeRate, { ...where, rate, isActive: true, createdAt: now, updatedAt: now }))
  }
  await em.flush()
}

/** The demo offering: one cost-plus charge in EUR with a single fixed 300 USD price-basis element. Idempotent. */
async function seedFxOffering(em: EntityManager, scope: TenantScope): Promise<CpqProductOffering> {
  let product = await em.findOne(CatalogProduct, { ...scope, sku: FX_DEMO.sku, deletedAt: null })
  if (!product) {
    product = em.create(CatalogProduct, {
      ...scope, title: FX_DEMO.title, sku: FX_DEMO.sku, handle: FX_DEMO.sku.toLowerCase(),
      productType: 'configurable', description: FX_DEMO.description, isConfigurable: true, isActive: true,
    })
    em.persist(product)
    await em.flush()
  }
  let spec = await em.findOne(CpqProductSpecification, { ...scope, code: FX_DEMO.specCode })
  if (!spec) {
    spec = em.create(CpqProductSpecification, {
      ...scope, productId: product.id, code: FX_DEMO.specCode, name: `${FX_DEMO.title} Specification`,
      description: FX_DEMO.description, lifecycleStatus: 'active', version: 1,
    })
    em.persist(spec)
    await em.flush()
  }
  let offering = await em.findOne(CpqProductOffering, { ...scope, code: FX_DEMO.offerCode })
  if (!offering) {
    offering = em.create(CpqProductOffering, {
      ...scope, specId: spec.id, code: FX_DEMO.offerCode, name: FX_DEMO.title,
      description: `${FX_DEMO.title} — a USD cost converted into EUR`, lifecycleStatus: 'active',
    })
    em.persist(offering)
    await em.flush()
  }
  let charge = await em.findOne(CpqProductCharge, { ...scope, productId: product.id, code: FX_DEMO.chargeCode })
  if (!charge) {
    charge = em.create(CpqProductCharge, {
      ...scope, productId: product.id, offeringId: offering.id, code: FX_DEMO.chargeCode, name: 'IP Transit Fee (EUR)',
      chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus',
      markupRule: 'markup_percent', markupValue: String(FX_DEMO.markupPercent), currencyCode: FX_DEMO.quoteCurrency, sortOrder: 0, isActive: true,
    })
    em.persist(charge)
    await em.flush()
  }
  const element = await em.findOne(CpqChargeCostElement, { ...scope, deletedAt: null, productChargeId: charge.id, code: FX_DEMO.tailElementCode })
  if (!element) {
    em.persist(em.create(CpqChargeCostElement, {
      ...scope, productChargeId: charge.id, code: FX_DEMO.tailElementCode, name: 'Partner tail (USD)', role: 'price_basis',
      costType: 'mrc', costModel: 'flat', source: 'fixed', amount: String(FX_DEMO.tailAmount), currencyCode: FX_DEMO.costCurrency,
      requiresSourcing: false, isActive: true, sortOrder: 0,
    } as never))
    await em.flush()
  }
  return offering
}

/**
 * Foreign-currency cost demo: the USD→EUR rates and one EUR quote whose 300 USD partner tail is converted at today's
 * rate (list price 345.00 EUR). Driven through the real quoting service so the rate snapshot is the engine's.
 * Idempotent (rates per day / source; the quote by its `quoteContext.scenario` marker).
 */
export async function seedGixCostFxExamples(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  await seedGixDemoFxRates(em, scope)
  const companies = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'company', deletedAt: null }, { limit: 500 }, scope)
  const customer = companies.find((company) => company.displayName === ACME_DISPLAY_NAME)
  if (!customer) { log(`Skipping the quote — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const existing = await em.find(CpqQuoteConfiguration, { ...scope, customerId: customer.id, deletedAt: null })
  if (existing.some((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario === FX_DEMO.scenario)) {
    log(`Skipping "${FX_DEMO.scenario}" — already present.`)
    return
  }
  const offering = await seedFxOffering(em, scope)
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  let quote = await quoting.createQuote({
    customerId: customer.id, currencyCode: FX_DEMO.quoteCurrency,
    quoteContext: { demo_marker: 'cpq-seed-v1', scenario: FX_DEMO.scenario, label: FX_DEMO.label },
  }, scope)
  quote = await quoting.addQuoteItem(quote.id, { offeringId: offering.id, configuration: {}, quantity: 1, termMonths: 12 }, scope)
  await quoting.recalculate(quote.id, { save: true }, scope)
  log(`Quote for "${FX_DEMO.scenario}" created (USD→EUR demo rates for the last ${FX_DEMO.rates.length} days).`)
}
