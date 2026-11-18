import { computeArcCosts, itemCostTotal, loadQuoteArcCosts } from '../arcCostRead'

const scope = { organizationId: 'org', tenantId: 'ten' }

describe('computeArcCosts', () => {
  it('sums MRC and NRC separately; an unknown (null) cost counts 0', () => {
    expect(computeArcCosts(
      [{ costType: 'mrc', total: 270 }, { costType: 'nrc', total: 10 }, { costType: 'mrc', total: null }],
      [{ costType: 'mrc', total: 240 }, { costType: 'mrc', total: 10.5 }],
      false,
    )).toEqual({ before: { mrcCost: 270, nrcCost: 10 }, after: { mrcCost: 250.5, nrcCost: 0 } })
  })
  it('a terminated line ends every cost: after is zero', () => {
    expect(computeArcCosts([{ costType: 'mrc', total: 100 }], [{ costType: 'mrc', total: 100 }], true).after).toEqual({ mrcCost: 0, nrcCost: 0 })
  })
})

describe('itemCostTotal', () => {
  it('is null while the cost is unknown or has no total', () => {
    expect(itemCostTotal({ valueStatus: 'none', totalAmount: '5' })).toBeNull()
    expect(itemCostTotal({ valueStatus: 'confirmed', totalAmount: null })).toBeNull()
    expect(itemCostTotal({ valueStatus: 'estimated', totalAmount: '12.5000' })).toBe(12.5)
  })
})

describe('loadQuoteArcCosts', () => {
  const line = (over: Record<string, unknown>) => ({ quoteLineId: 'l1', action: 'modify', quantity: '2', sourceSubscriptionItemId: 'item-1', configuration: { _arcMirroredFromItemId: 'item-1' }, ...over })
  const em = (open: unknown[]) => ({ find: jest.fn(async () => open) }) as never

  it('compares the item open costs with the line cost rows (quantity applied to the line side)', async () => {
    const result = await loadQuoteArcCosts(
      em([{ subscriptionItemId: 'item-1', costType: 'mrc', valueStatus: 'confirmed', totalAmount: '540' }]),
      { quoteType: 'amend' }, [line({}) as never],
      [{ quoteLineId: 'l1', costType: 'mrc', valueStatus: 'confirmed', instanceAmount: '120', fxRate: null }] as never, scope,
    )
    expect(result.get('l1')).toEqual({ before: { mrcCost: 540, nrcCost: 0 }, after: { mrcCost: 240, nrcCost: 0 } })
  })
  it('skips non-mirror lines and zeroes the cancel line', async () => {
    const result = await loadQuoteArcCosts(
      em([{ subscriptionItemId: 'item-1', costType: 'mrc', valueStatus: 'confirmed', totalAmount: '100' }]),
      { quoteType: 'amend' }, [line({ quoteLineId: 'plain', configuration: {} }) as never, line({ action: 'cancel' }) as never], [], scope,
    )
    expect(result.has('plain')).toBe(false)
    expect(result.get('l1')?.after).toEqual({ mrcCost: 0, nrcCost: 0 })
  })
  it('does not query without a mirror line', async () => {
    const mock = { find: jest.fn() }
    expect((await loadQuoteArcCosts(mock as never, { quoteType: 'new' }, [line({}) as never], [], scope)).size).toBe(0)
    expect(mock.find).not.toHaveBeenCalled()
  })
})
