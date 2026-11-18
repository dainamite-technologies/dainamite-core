import {
  CpqOrderConfiguration, CpqOrderLineConfiguration, CpqOrderLineCost, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride,
} from '../../../data/entities'
import { readOrderCosts } from '../orderCostView'
import { loadQuoteMarginState } from '../quoteCostView'

const SCOPE = { organizationId: 'org', tenantId: 'ten' }

const charges = (price: number) => [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: price }]
const cost = (lineId: string, over: Record<string, unknown> = {}) => ({
  chargeCode: 'mrc', costKey: `tail-${lineId}`, role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', instanceAmount: '40',
  currencyCode: 'USD', fxRate: null, validUntil: null, ...over,
})
// An Amend quote: a reconfigured mirror, a plain mirror (both excluded from the deal), a cancelled mirror, and a sold add line.
const lineDefs = [
  { id: 'l-mirror', action: 'modify', configuration: { _arcMirroredFromItemId: 'i1' }, price: 100 },
  { id: 'l-plain', action: 'modify', configuration: { _arcMirroredFromItemId: 'i2' }, price: 200 },
  { id: 'l-cancel', action: 'cancel', configuration: { _arcMirroredFromItemId: 'i3' }, price: 300 },
  { id: 'l-add', action: 'add', configuration: {}, price: 80 },
]

describe('order margin equals the quote margin (review1-c)', () => {
  it('an Amend order shows exactly the margin its quote showed, for the same lines and costs', async () => {
    const quote = { id: 'q', quoteType: 'amend', currencyCode: 'USD' }
    const quoteLines = lineDefs.map((l) => ({ quoteLineId: l.id, parentLineId: null, quantity: 1, termMonths: 12, action: l.action, configuration: l.configuration, charges: charges(l.price) }))
    const quoteCosts = lineDefs.map((l) => ({ id: `qc-${l.id}`, quoteLineId: l.id, ...cost(l.id) }))
    const quoteEm = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === CpqQuoteLineConfiguration) return quoteLines
        if (entity === CpqQuoteLineCost) return quoteCosts
        if (entity === CpqQuoteMarkupOverride) return []
        return []
      }),
    }
    const quoteMargin = (await loadQuoteMarginState(quoteEm as never, quote as never, SCOPE)).margin

    const orderLines = lineDefs.map((l) => ({ orderLineId: l.id, parentLineId: null, quantity: 1, termMonths: 12, action: l.action, configuration: l.configuration, charges: charges(l.price) }))
    const orderCosts = lineDefs.map((l) => ({ id: `oc-${l.id}`, orderLineId: l.id, ...cost(l.id) }))
    const orderEm = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === CpqOrderConfiguration) return { id: 'oc-1', orderId: 'so-1', sourceQuoteId: 'q', currencyCode: 'USD' }
        if (entity === CpqQuoteConfiguration) return quote
        return null
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === CpqOrderLineConfiguration) return orderLines
        if (entity === CpqOrderLineCost) return orderCosts
        return []
      }),
    }
    const read = await readOrderCosts(orderEm as never, 'oc-1', SCOPE, true)

    expect(read.margin).toEqual(quoteMargin)
    // Only the sold add line counts: 80 offer, 40 cost per month over 12 months.
    expect(read.margin).toMatchObject({ contractOffer: 960, contractCost: 480 })
  })

  it('a new-sale order (no source quote) counts every line', async () => {
    const orderEm = {
      findOne: jest.fn(async (entity: unknown) => (entity === CpqOrderConfiguration ? { id: 'oc-1', orderId: 'so-1', sourceQuoteId: null, currencyCode: 'USD' } : null)),
      find: jest.fn(async (entity: unknown) => {
        if (entity === CpqOrderLineConfiguration) return [{ orderLineId: 'o1', parentLineId: null, quantity: 1, termMonths: 12, action: 'add', configuration: { _arcMirroredFromItemId: 'x' }, charges: charges(80) }]
        if (entity === CpqOrderLineCost) return [{ id: 'c1', orderLineId: 'o1', ...cost('o1') }]
        return []
      }),
    }
    const read = await readOrderCosts(orderEm as never, 'oc-1', SCOPE, true)
    expect(JSON.stringify(read.margin)).toContain('960')
  })
})

describe('order margin with a foreign-currency cost equals the quote margin', () => {
  it('converts the cost-currency instance amount with the copied fx_rate, like the quote does', async () => {
    const quote = { id: 'q', quoteType: 'new', currencyCode: 'EUR' }
    const lineBase = { parentLineId: null, quantity: 3, termMonths: 12, action: 'add', configuration: {}, charges: charges(500) }
    const usd = { chargeCode: 'mrc', costKey: 'tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', instanceAmount: '90.3333', currencyCode: 'USD', fxRate: '0.92345678', fxRateDate: '2026-11-10', fxRateSource: 'ECB', fxRateDerivation: 'direct', validUntil: null }
    const quoteEm = {
      find: jest.fn(async (entity: unknown) => entity === CpqQuoteLineConfiguration ? [{ quoteLineId: 'l1', ...lineBase }] : entity === CpqQuoteLineCost ? [{ id: 'qc', quoteLineId: 'l1', ...usd }] : []),
    }
    const quoteMargin = (await loadQuoteMarginState(quoteEm as never, quote as never, SCOPE)).margin
    const orderEm = {
      findOne: jest.fn(async (entity: unknown) => entity === CpqOrderConfiguration ? { id: 'oc-1', orderId: 'so-1', sourceQuoteId: 'q', currencyCode: 'EUR' } : entity === CpqQuoteConfiguration ? quote : null),
      find: jest.fn(async (entity: unknown) => entity === CpqOrderLineConfiguration ? [{ orderLineId: 'l1', ...lineBase }] : entity === CpqOrderLineCost ? [{ id: 'oc', orderLineId: 'l1', ...usd }] : []),
    }
    const read = await readOrderCosts(orderEm as never, 'oc-1', SCOPE, true)
    expect(read.margin).toEqual(quoteMargin)
    // 90.3333 x 0.92345678 x 3 per month, 12 months, converted at full precision
    expect(read.margin!.mrcCost).toBeCloseTo(90.3333 * 0.92345678 * 3, 3)
    expect(read.margin!.contractCost).toBeCloseTo(90.3333 * 0.92345678 * 3 * 12, 3)
  })
})
