import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CpqProductOffering, CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import type { CpqAdjustmentService } from '@dainamite/cpq/modules/cpq/services/priceAdjustments/adjustmentService'

export const PRICE_ADJUSTMENT_SCENARIO = 'acme-port-upgrade-negotiated'
/** Seeds run without a signed-in user; the nil UUID marks system-authored demo rows. */
export const SEED_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'
const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'

/**
 * "Demo — Acme port upgrade": a Ready quote showing negotiated prices — the
 * setup fee overridden 290 → 250 (competitive match) and 10% off the recurring
 * port fee (strategic deal). Idempotent: keyed on the quote-context scenario.
 * Runs after `seedGixExamples` so existing tenants also receive it.
 */
export async function seedGixPriceAdjustmentExample(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const log = (msg: string) => console.log(`    [demo_gix:price-adjustments] ${msg}`)
  const acme = await em.findOne(CustomerEntity, { ...scope, displayName: ACME_DISPLAY_NAME, deletedAt: null })
  if (!acme) { log(`Skipping — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const quotes = await em.find(CpqQuoteConfiguration, { ...scope, customerId: acme.id, deletedAt: null })
  if (quotes.some((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario === PRICE_ADJUSTMENT_SCENARIO)) {
    log('Skipping — negotiated-price demo quote already present.')
    return
  }
  const offering = await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-ACCESS-PORT', deletedAt: null })
  if (!offering) { log('Skipping — Access Port offering not seeded.'); return }

  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  const adjustments = container.resolve('cpqAdjustmentService') as CpqAdjustmentService
  if (!(await adjustments.enabled(scope.tenantId))) { log('Skipping — manual price adjustments are turned off.'); return }

  let quote = await quoting.createQuote({
    customerId: acme.id,
    currencyCode: 'USD',
    quoteContext: { demo_marker: 'cpq-seed-v1', scenario: PRICE_ADJUSTMENT_SCENARIO, label: 'Demo — Acme port upgrade' },
  }, scope)
  quote = await quoting.addQuoteItem(quote.id, {
    offeringId: offering.id,
    configuration: { port_size: '1G', data_centre: 'equinix-am1' },
    quantity: 1,
    termMonths: 12,
  }, scope)
  const line = quote.lines[0]
  if (!line || !line.charges.some((charge) => charge.chargeCode === 'setup_fee')) {
    log('Skipping adjustments — the Access Port line has no setup_fee charge.')
    return
  }
  await adjustments.create(quote.id, {
    level: 'charge', quoteLineId: line.lineId, chargeCode: 'setup_fee',
    adjustmentType: 'price_override', value: 250, currencyCode: 'USD', reasonCode: 'competitive_match',
    reasonNote: 'Matched competitor setup offer',
  }, SEED_ACTOR_USER_ID, scope)
  const result = await adjustments.create(quote.id, {
    level: 'line', quoteLineId: line.lineId, chargeTypeFilter: 'mrc',
    adjustmentType: 'discount_percent', value: 10, reasonCode: 'strategic_deal',
  }, SEED_ACTOR_USER_ID, scope)
  log(`Quote ${result.quote.quoteNumber} (${result.quote.cpqStatus}): NRC ${result.quote.pricingSummary.nrcTotal}, MRC ${result.quote.pricingSummary.mrcTotal}`)
}
