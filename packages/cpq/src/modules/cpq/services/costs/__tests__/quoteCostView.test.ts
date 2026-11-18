import { CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride } from '../../../data/entities'
import { loadQuoteMarginState } from '../quoteCostView'

const SCOPE = { organizationId: 'org', tenantId: 'ten' }

function line(id: string, action: string) {
  return { quoteLineId: id, parentLineId: null, quantity: 1, termMonths: 12, action, configuration: {}, charges: [] }
}
const pendingCost = (quoteLineId: string) => ({
  quoteLineId, chargeCode: 'tail', costKey: `tail-${quoteLineId}`, role: 'price_basis', costType: 'mrc',
  valueStatus: 'none', instanceAmount: null, currencyCode: null, fxRate: null, validUntil: null,
})

describe('loadQuoteMarginState: termination lines', () => {
  const run = async (quoteType: string, action: string) => {
    const em = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === CpqQuoteLineConfiguration) return [line('l1', action)]
        if (entity === CpqQuoteLineCost) return [pendingCost('l1')]
        if (entity === CpqQuoteMarkupOverride) return []
        return []
      }),
    }
    return loadQuoteMarginState(em as never, { id: 'q', quoteType, currencyCode: 'USD' } as never, SCOPE)
  }

  it('a Cancel-quote line with a pending price-basis cost sets no flag', async () => {
    const state = await run('cancel', 'cancel')
    expect(state.priceBasis).toEqual({ hasPendingCosts: false, hasEstimatedCosts: false })
    expect(state.margin.hasPendingCosts).toBe(false)
  })

  it('the same cost on a sold line still flags pending', async () => {
    const state = await run('new', 'add')
    expect(state.priceBasis.hasPendingCosts).toBe(true)
  })
})
