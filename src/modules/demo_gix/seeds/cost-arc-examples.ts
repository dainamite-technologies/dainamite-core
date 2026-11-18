import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
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
import type { DefaultCpqOrderService } from '@dainamite/cpq/modules/cpq/services/cpqOrderService'
import type { DefaultCpqInventoryService } from '@dainamite/cpq/modules/cpq/services/cpqInventoryService'
import type { CpqQuoteCostService } from '@dainamite/cpq/modules/cpq/services/costs/quoteCostService'
import { ARC_COST_DEMO } from './data/cost-plus'

/** Seeds run without a signed-in user; the nil UUID marks system-authored demo rows. */
const SEED_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'
const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'
const log = (msg: string) => console.log(`    [demo_gix:cost-arc] ${msg}`)
const isoDay = (offsetDays: number, now: Date = new Date()) => new Date(now.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** The demo offering: one cost-plus MRC charge with a single fixed 270 USD price-basis element. Idempotent. */
async function seedArcCostOffering(em: EntityManager, scope: TenantScope): Promise<CpqProductOffering> {
  const demo = ARC_COST_DEMO
  let product = await em.findOne(CatalogProduct, { ...scope, sku: demo.sku, deletedAt: null })
  if (!product) {
    product = em.create(CatalogProduct, {
      ...scope, title: demo.title, sku: demo.sku, handle: demo.sku.toLowerCase(),
      productType: 'configurable', description: demo.description, isConfigurable: true, isActive: true,
    })
    em.persist(product)
    await em.flush()
  }
  let spec = await em.findOne(CpqProductSpecification, { ...scope, code: demo.specCode })
  if (!spec) {
    spec = em.create(CpqProductSpecification, {
      ...scope, productId: product.id, code: demo.specCode, name: `${demo.title} Specification`,
      description: demo.description, lifecycleStatus: 'active', version: 1,
    })
    em.persist(spec)
    await em.flush()
  }
  let offering = await em.findOne(CpqProductOffering, { ...scope, code: demo.offerCode })
  if (!offering) {
    offering = em.create(CpqProductOffering, {
      ...scope, specId: spec.id, code: demo.offerCode, name: demo.title, description: demo.description, lifecycleStatus: 'active',
    })
    em.persist(offering)
    await em.flush()
  }
  let charge = await em.findOne(CpqProductCharge, { ...scope, productId: product.id, code: demo.chargeCode })
  if (!charge) {
    charge = em.create(CpqProductCharge, {
      ...scope, productId: product.id, offeringId: offering.id, code: demo.chargeCode, name: 'IP Transit Fee',
      chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus',
      markupRule: 'markup_percent', markupValue: String(demo.markupPercent), currencyCode: demo.currency, sortOrder: 0, isActive: true,
    })
    em.persist(charge)
    await em.flush()
  }
  const element = await em.findOne(CpqChargeCostElement, { ...scope, deletedAt: null, productChargeId: charge.id, code: demo.tailElementCode })
  if (!element) {
    em.persist(em.create(CpqChargeCostElement, {
      ...scope, productChargeId: charge.id, code: demo.tailElementCode, name: 'Partner tail', role: 'price_basis',
      costType: 'mrc', costModel: 'flat', source: 'fixed', amount: String(demo.tailAmount), currencyCode: demo.currency,
      requiresSourcing: false, isActive: true, sortOrder: 0,
    } as never))
    await em.flush()
  }
  return offering
}

/**
 * ARC costs demo: one live (`active`) subscription for Acme with a 270 USD partner-tail item cost whose supplier term
 * ends 45 days out, while the subscription renews in 90 days. Built through the real services (quote → supplier term
 * on the tail → accepted → order → activation) so the item cost, its history and the source ids are the engine's.
 * A freshly activated subscription is `pending`: it is moved to `active` like the ARC fixtures do, and given a term end.
 * Idempotent (the quote is found by its `quoteContext.scenario` marker); examples-gated by the caller.
 */
export async function seedGixCostArcExamples(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const demo = ARC_COST_DEMO
  const companies = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'company', deletedAt: null }, { limit: 500 }, scope)
  const customer = companies.find((company) => company.displayName === ACME_DISPLAY_NAME)
  if (!customer) { log(`Skipping — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const existing = await em.find(CpqQuoteConfiguration, { ...scope, customerId: customer.id, deletedAt: null })
  if (existing.some((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario === demo.scenario)) {
    log(`Skipping "${demo.scenario}" — already present.`)
    return
  }
  const offering = await seedArcCostOffering(em, scope)
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  const costs = container.resolve('cpqQuoteCostService') as CpqQuoteCostService
  const orders = container.resolve('cpqOrderService') as DefaultCpqOrderService
  const inventory = container.resolve('cpqInventoryService') as DefaultCpqInventoryService

  let quote = await quoting.createQuote({
    customerId: customer.id, currencyCode: demo.currency,
    quoteContext: { demo_marker: 'cpq-seed-v1', scenario: demo.scenario, label: demo.label },
  }, scope) as { id: string; cpqStatus?: string }
  quote = await quoting.addQuoteItem(quote.id, { offeringId: offering.id, configuration: {}, quantity: 1, termMonths: 12 }, scope) as typeof quote
  quote = await quoting.recalculate(quote.id, { save: true }, scope) as typeof quote

  // The supplier term of the partner tail: a value-neutral write (the amount is the catalog's), so no price change.
  const read = await costs.read(quote.id, scope, true)
  const tail = read.lines.flatMap((line) => line.costs as unknown as Array<{ id: string; costKey: string }>).find((cost) => cost.costKey === demo.tailElementCode)
  if (!tail) {
    log(`"${demo.scenario}": the partner tail cost line was not resolved — quote left as is.`)
    return
  }
  await costs.updateCost(quote.id, tail.id, {
    supplierName: demo.supplierName, supplierTermEnd: isoDay(demo.supplierTermEndDays), note: 'Supplier contract runs until the term end',
  }, SEED_ACTOR_USER_ID, scope)

  for (const target of ['ready', 'with_customer', 'accepted']) {
    // A transition to the current status is a 409, so skip it.
    if (quote.cpqStatus !== target) quote = await quoting.transitionStatus(quote.id, target, scope) as typeof quote
  }
  const order = await orders.convertQuoteToOrder(quote.id, scope)
  await orders.activateOrder(order.id, scope)
  const subs = await inventory.listSubscriptions({ customerId: customer.id, sourceOrderId: order.id }, scope)
  const subscription = subs.items[0]
  if (!subscription) {
    log(`"${demo.scenario}": the activated order produced no subscription — left as is.`)
    return
  }
  await inventory.transitionSubscriptionStatus(subscription.id, 'active', scope)
  await inventory.updateSubscription(subscription.id, { currentTermEnd: isoDay(demo.subscriptionTermEndDays) }, scope)
  log(`Live subscription seeded: ${demo.tailAmount} ${demo.currency} partner tail, supplier term ends in ${demo.supplierTermEndDays} days, subscription renews in ${demo.subscriptionTermEndDays}.`)
}
