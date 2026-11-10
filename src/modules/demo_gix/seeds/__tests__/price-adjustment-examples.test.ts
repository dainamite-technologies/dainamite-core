import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CpqProductOffering, CpqQuoteConfiguration } from '@dainamite/cpq/modules/cpq/data/entities'
import { PRICE_ADJUSTMENT_SCENARIO, SEED_ACTOR_USER_ID, seedGixPriceAdjustmentExample } from '../price-adjustment-examples'

const scope = { tenantId: 't', organizationId: 'o' }

function setup({ acme = true, existing = false, enabled = true, charges = ['setup_fee', 'monthly_port_fee'] } = {}) {
  const em = {
    findOne: jest.fn(async (entity: unknown) => entity === CustomerEntity ? (acme ? { id: 'acme' } : null) : entity === CpqProductOffering ? { id: 'offer' } : null),
    find: jest.fn(async (entity: unknown) => entity === CpqQuoteConfiguration && existing ? [{ quoteContext: { scenario: PRICE_ADJUSTMENT_SCENARIO } }] : []),
  }
  const quote = { id: 'q1', quoteNumber: 'Q-9', cpqStatus: 'ready', pricingSummary: { nrcTotal: 250, mrcTotal: 207 }, lines: [{ lineId: 'l1', charges: charges.map((chargeCode) => ({ chargeCode })) }] }
  const quoting = { createQuote: jest.fn().mockResolvedValue({ id: 'q1', lines: [] }), addQuoteItem: jest.fn().mockResolvedValue(quote) }
  const adjustments = { enabled: jest.fn().mockResolvedValue(enabled), create: jest.fn().mockResolvedValue({ quote }) }
  const container = { resolve: (name: string) => (name === 'cpqQuotingService' ? quoting : adjustments) }
  return { em, quoting, adjustments, container }
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

it('creates the Acme port-upgrade quote with a setup-fee override and a recurring line discount', async () => {
  const { em, quoting, adjustments, container } = setup()
  await seedGixPriceAdjustmentExample(em as never, container as never, scope)
  expect(quoting.createQuote).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'acme', quoteContext: expect.objectContaining({ scenario: PRICE_ADJUSTMENT_SCENARIO }) }), scope)
  expect(quoting.addQuoteItem).toHaveBeenCalledWith('q1', expect.objectContaining({ offeringId: 'offer', configuration: { port_size: '1G', data_centre: 'equinix-am1' } }), scope)
  expect(adjustments.create).toHaveBeenNthCalledWith(1, 'q1', expect.objectContaining({ level: 'charge', chargeCode: 'setup_fee', adjustmentType: 'price_override', value: 250, currencyCode: 'USD', reasonCode: 'competitive_match' }), SEED_ACTOR_USER_ID, scope)
  expect(adjustments.create).toHaveBeenNthCalledWith(2, 'q1', expect.objectContaining({ level: 'line', chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: 10, reasonCode: 'strategic_deal' }), SEED_ACTOR_USER_ID, scope)
})

it.each([
  ['the quote already exists', { existing: true }],
  ['Acme is missing', { acme: false }],
  ['the toggle is off', { enabled: false }],
])('is a no-op when %s', async (_label, options) => {
  const { em, quoting, adjustments, container } = setup(options)
  await seedGixPriceAdjustmentExample(em as never, container as never, scope)
  expect(quoting.createQuote).not.toHaveBeenCalled()
  expect(adjustments.create).not.toHaveBeenCalled()
})

it('skips adjustments when the priced line has no setup fee', async () => {
  const { em, adjustments, container } = setup({ charges: ['monthly_port_fee'] })
  await seedGixPriceAdjustmentExample(em as never, container as never, scope)
  expect(adjustments.create).not.toHaveBeenCalled()
})
