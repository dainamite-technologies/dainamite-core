import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CpqChargeCostElement,
  CpqCostIndex,
  CpqProductCharge,
  CpqProductOffering,
  CpqProductSpecification,
  CpqQuoteConfiguration,
} from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import type { CpqCostIndexService } from '@dainamite/cpq/modules/cpq/services/costs/costIndexService'
import { INDEX_DEMO } from './data/cost-plus'

const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'
const log = (msg: string) => console.log(`    [demo_gix:cost-index] ${msg}`)

/** `YYYY-MM-DD` (UTC) `offsetDays` from `now`: index values are dated days, not instants. */
export function isoDayFrom(offsetDays: number, now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)).toISOString().slice(0, 10)
}

/**
 * The demo index and its values, through `costIndexService`: the last three months, one same-date correction (revision 2)
 * and one future value. Idempotent per index code: an index that already holds values (a previous run, or the operator's
 * own data) is never topped up, because the dates are relative to the seed run and a later run would otherwise append a
 * second, shifted history.
 */
export async function seedGixDemoIndex(em: EntityManager, container: AwilixContainer, scope: TenantScope, now: Date = new Date()): Promise<CpqCostIndex> {
  const service = container.resolve('cpqCostIndexService') as CpqCostIndexService
  let index = await em.findOne(CpqCostIndex, { tenantId: scope.tenantId, code: INDEX_DEMO.indexCode, deletedAt: null })
  if (!index) {
    await service.create({ code: INDEX_DEMO.indexCode, name: INDEX_DEMO.indexName, unit: INDEX_DEMO.unit, currencyCode: INDEX_DEMO.currency }, scope)
    index = await em.findOne(CpqCostIndex, { tenantId: scope.tenantId, code: INDEX_DEMO.indexCode, deletedAt: null })
    if (!index) throw new Error(`Demo index ${INDEX_DEMO.indexCode} was not created`)
  }
  const existing = await service.listValues(index.id, scope, { page: 1, pageSize: 1, includeSuperseded: true })
  if (existing.total > 0) { log(`Skipping the values of "${INDEX_DEMO.indexCode}" — already present.`); return index }
  const past = INDEX_DEMO.values.map((row) => ({ effectiveDate: isoDayFrom(row.days, now), value: row.value, sourceNote: 'Demo feed' }))
  const future = { effectiveDate: isoDayFrom(INDEX_DEMO.future.days, now), value: INDEX_DEMO.future.value, sourceNote: 'Demo forecast (not in force yet)' }
  await service.appendValues(index.id, [...past, future], scope)
  // The correction is a second write for the same date, so it lands as revision 2.
  for (const row of INDEX_DEMO.values) {
    if ('correctedValue' in row) await service.appendValue(index.id, { effectiveDate: isoDayFrom(row.days, now), value: row.correctedValue, sourceNote: 'Demo correction' }, scope)
  }
  log(`Index "${INDEX_DEMO.indexCode}" seeded (${past.length} past values, 1 correction, 1 future value).`)
  return index
}

/** The demo offering: one cost-plus charge in EUR with a single `index` price-basis element (factor 0.5). Idempotent. */
async function seedIndexOffering(em: EntityManager, scope: TenantScope, index: CpqCostIndex): Promise<CpqProductOffering> {
  let product = await em.findOne(CatalogProduct, { ...scope, sku: INDEX_DEMO.sku, deletedAt: null })
  if (!product) {
    product = em.create(CatalogProduct, {
      ...scope, title: INDEX_DEMO.title, sku: INDEX_DEMO.sku, handle: INDEX_DEMO.sku.toLowerCase(),
      productType: 'configurable', description: INDEX_DEMO.description, isConfigurable: true, isActive: true,
    })
    em.persist(product)
    await em.flush()
  }
  let spec = await em.findOne(CpqProductSpecification, { ...scope, code: INDEX_DEMO.specCode })
  if (!spec) {
    spec = em.create(CpqProductSpecification, {
      ...scope, productId: product.id, code: INDEX_DEMO.specCode, name: `${INDEX_DEMO.title} Specification`,
      description: INDEX_DEMO.description, lifecycleStatus: 'active', version: 1,
    })
    em.persist(spec)
    await em.flush()
  }
  let offering = await em.findOne(CpqProductOffering, { ...scope, code: INDEX_DEMO.offerCode })
  if (!offering) {
    offering = em.create(CpqProductOffering, {
      ...scope, specId: spec.id, code: INDEX_DEMO.offerCode, name: INDEX_DEMO.title,
      description: `${INDEX_DEMO.title} — a cost that follows an index`, lifecycleStatus: 'active',
    })
    em.persist(offering)
    await em.flush()
  }
  let charge = await em.findOne(CpqProductCharge, { ...scope, productId: product.id, code: INDEX_DEMO.chargeCode })
  if (!charge) {
    charge = em.create(CpqProductCharge, {
      ...scope, productId: product.id, offeringId: offering.id, code: INDEX_DEMO.chargeCode, name: 'IP Transit Fee (indexed power)',
      chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus',
      markupRule: 'markup_percent', markupValue: String(INDEX_DEMO.markupPercent), currencyCode: INDEX_DEMO.currency, sortOrder: 0, isActive: true,
    })
    em.persist(charge)
    await em.flush()
  }
  const element = await em.findOne(CpqChargeCostElement, { ...scope, deletedAt: null, productChargeId: charge.id, code: INDEX_DEMO.elementCode })
  if (!element) {
    em.persist(em.create(CpqChargeCostElement, {
      ...scope, productChargeId: charge.id, code: INDEX_DEMO.elementCode, name: 'Data-centre power (indexed)', role: 'price_basis',
      costType: 'mrc', costModel: 'flat', source: 'index', costIndexId: index.id, indexFactor: INDEX_DEMO.factor, indexOffset: INDEX_DEMO.offset,
      requiresSourcing: false, isActive: true, sortOrder: 0,
    } as never))
    await em.flush()
  }
  return offering
}

/**
 * Index cost demo: `DEMO-DC-POWER` with values, an `index` price-basis offering and two quotes on it, driven through the
 * real quoting service: one `ready` (an unlocked quote re-prices on every saved recalculation when a new value is in
 * force) and one `with_customer` (the cost lock freezes its snapshot and price). Idempotent (index by code, quotes by
 * their `quoteContext.scenario` marker).
 */
export async function seedGixCostIndexExamples(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const index = await seedGixDemoIndex(em, container, scope)
  const companies = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'company', deletedAt: null }, { limit: 500 }, scope)
  const customer = companies.find((company) => company.displayName === ACME_DISPLAY_NAME)
  if (!customer) { log(`Skipping the quotes — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const existing = await em.find(CpqQuoteConfiguration, { ...scope, customerId: customer.id, deletedAt: null })
  const present = new Set(existing.map((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario))
  if (present.has(INDEX_DEMO.readyScenario) && present.has(INDEX_DEMO.sentScenario)) { log('Skipping the index quotes — already present.'); return }
  const offering = await seedIndexOffering(em, scope, index)
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService

  const createQuote = async (scenario: string, label: string) => {
    let quote = await quoting.createQuote({
      customerId: customer.id, currencyCode: INDEX_DEMO.currency,
      quoteContext: { demo_marker: 'cpq-seed-v1', scenario, label },
    }, scope)
    quote = await quoting.addQuoteItem(quote.id, { offeringId: offering.id, configuration: {}, quantity: 1, termMonths: 12 }, scope)
    const priced = await quoting.recalculate(quote.id, { save: true }, scope)
    return { id: quote.id, cpqStatus: (priced as { cpqStatus?: string } | undefined)?.cpqStatus }
  }

  if (present.has(INDEX_DEMO.readyScenario)) log(`Skipping "${INDEX_DEMO.readyScenario}" — already present.`)
  else {
    await createQuote(INDEX_DEMO.readyScenario, INDEX_DEMO.readyLabel)
    log(`Quote for "${INDEX_DEMO.readyScenario}" created (ready; re-prices when a newer index value is saved).`)
  }

  if (present.has(INDEX_DEMO.sentScenario)) log(`Skipping "${INDEX_DEMO.sentScenario}" — already present.`)
  else {
    const quote = await createQuote(INDEX_DEMO.sentScenario, INDEX_DEMO.sentLabel)
    try {
      // A transition to the current status is a 409: only move when the saved recalculation did not already settle it.
      const ready = quote.cpqStatus === 'ready' ? quote : (await quoting.transitionStatus(quote.id, 'ready', scope)) as { id: string }
      await quoting.transitionStatus(ready.id, 'with_customer', scope)
    } catch (error) {
      log(`"${INDEX_DEMO.sentScenario}": could not move the quote to with_customer (${error instanceof Error ? error.message : String(error)}).`)
      // The scenario marker lives on the quote: drop the half-built quote so the next seed run retries the scenario.
      await quoting.deleteQuote(quote.id, scope).catch(() => undefined)
      return
    }
    log(`Quote for "${INDEX_DEMO.sentScenario}" created (with customer; index snapshot frozen).`)
  }
}
