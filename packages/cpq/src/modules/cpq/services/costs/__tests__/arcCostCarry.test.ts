import { CpqInventoryCost, CpqQuoteLineCost } from '../../../data/entities'
import { ARC_CARRIED_COST_SET_HASH_KEY, ARC_COSTS_CARRIED_KEY, stripQuoteOnlyArcMarkers } from '../../arcPriceFreeze'
import { carriedCostLines, itemCostSetHash, itemCostStateHash } from '../itemCostState'
import { carriedQuoteCostData, carryItemCosts, loadOpenItemCosts } from '../arcCostCarry'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const QUOTE = { id: 'cpq-1', quoteId: 'sq-1' }
const ITEM = { id: 'item-1', status: 'active' }

const cost = (over: Record<string, unknown> = {}) => ({
  id: 'ic-1', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', status: 'active', costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1',
  name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'catalog',
  unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000', currencyCode: 'USD', fxRate: '0.92000000', fxRateDate: '2026-11-01', fxRateSource: 'ecb',
  fxRateDerivation: 'direct', indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30',
  supplierTermEnd: '2028-11-30', supplierMinTermMonths: 12, note: 'n', ...over,
}) as unknown as CpqInventoryCost

function setup(existing: Array<Record<string, unknown>> = [], itemCosts: CpqInventoryCost[] = []) {
  const persisted: Array<Record<string, unknown>> = []
  const em = {
    find: jest.fn(async (entity: unknown) => (entity === CpqInventoryCost ? itemCosts : entity === CpqQuoteLineCost ? existing : [])),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((row: Record<string, unknown>) => { persisted.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  const line = { quoteLineId: 'ql-1', configuration: { _arcMirroredFromItemId: 'item-1' } as Record<string, unknown> }
  return { em, persisted, line }
}

describe('carriedQuoteCostData', () => {
  it('copies the full field list incl. source, cost_model, index_snapshot and the FX snapshot', () => {
    const row = cost()
    expect(carriedQuoteCostData(row, QUOTE, 'ql-1', SCOPE)).toEqual({
      id: expect.any(String), organizationId: 'org-1', tenantId: 'tenant-1', quoteConfigurationId: 'cpq-1', quoteId: 'sq-1', quoteLineId: 'ql-1',
      costKey: 'tail', chargeCode: 'mrc', origin: 'carried', costElementId: 'el-1', carriedFromItemCostId: 'ic-1', carriedFromHash: itemCostStateHash(row as never),
      name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'carried',
      unitAmount: '270.0000', instanceAmount: '270.0000', currencyCode: 'USD', fxRate: '0.92000000', fxRateDate: '2026-11-01', fxRateSource: 'ecb', fxRateDerivation: 'direct',
      indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30',
      supplierTermEnd: '2028-11-30', supplierMinTermMonths: 12, note: 'n', sourcingStatus: 'not_requested', renegotiationDue: false,
    })
  })

  it('is confirmed whatever the item cost status says, as long as it holds an amount; without an amount it keeps its own status', () => {
    expect(carriedQuoteCostData(cost({ valueStatus: 'estimated' }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ valueStatus: 'confirmed' })
    expect(carriedQuoteCostData(cost({ valueStatus: 'none', unitAmount: null, instanceAmount: null }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ valueStatus: 'none', unitAmount: null })
  })

  it('normalises Date columns to ISO days', () => {
    expect(carriedQuoteCostData(cost({ fxRateDate: new Date('2026-11-01T10:00:00Z'), validUntil: null }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ fxRateDate: '2026-11-01', validUntil: null })
  })
})

describe('carryItemCosts', () => {
  it('creates one carried row per open cost and marks the line with the set hash the guard recomputes', async () => {
    const open = [cost({ id: 'ic-2', costKey: 'install', costType: 'nrc' }), cost()]
    const { em, persisted, line } = setup([], open)
    const result = await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: open })
    expect(result.rows.map((row) => row.costKey)).toEqual(['install', 'tail'])
    expect(persisted).toHaveLength(2)
    const expected = itemCostSetHash(open as never, ITEM as never)
    expect(result.setHash).toBe(expected)
    expect(line.configuration).toMatchObject({ _arcMirroredFromItemId: 'item-1', [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: expected })
    // the guard's covered-line projection reads exactly these markers
    expect(carriedCostLines([{ quoteLineId: 'ql-1', action: 'modify', configuration: line.configuration, sourceSubscriptionItemId: 'item-1' } as never], 'amend'))
      .toEqual([{ quoteLineId: 'ql-1', subscriptionItemId: 'item-1', expectedSetHash: expected }])
    // markers are quote-only: they never reach orders / items
    expect(stripQuoteOnlyArcMarkers(line.configuration)).toEqual({ _arcMirroredFromItemId: 'item-1' })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('loads the item costs itself when none are given, scoped and open only', async () => {
    const { em, line } = setup([], [cost()])
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE })
    expect(em.find).toHaveBeenCalledWith(CpqInventoryCost, { subscriptionItemId: { $in: ['item-1'] }, status: 'active', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
  })

  it('ignores ended costs and costs of another item', async () => {
    const { em, persisted, line } = setup()
    const result = await carryItemCosts(em as never, {
      quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE,
      openCosts: [cost({ status: 'ended' }), cost({ id: 'ic-9', subscriptionItemId: 'item-2' })],
    })
    expect(result).toEqual({ rows: [], setHash: null })
    expect(persisted).toHaveLength(0)
  })

  it('an item with no open costs leaves the line unmarked', async () => {
    const { em, line } = setup()
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [] })
    expect(line.configuration).toEqual({ _arcMirroredFromItemId: 'item-1' })
  })

  it('replace soft-deletes the line\'s existing cost rows (flushed before the new rows) and then carries', async () => {
    const stale = { id: 'old', deletedAt: null as Date | null }
    const { em, persisted, line } = setup([stale])
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [cost()], replace: true })
    expect(stale.deletedAt).toBeInstanceOf(Date)
    expect(em.find).toHaveBeenCalledWith(CpqQuoteLineCost, { quoteLineId: 'ql-1', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
    expect(em.flush).toHaveBeenCalled()
    expect(persisted).toHaveLength(1)
  })

  it('never opens a sourcing request: rows are created not_requested with no request fields', async () => {
    const { em, persisted, line } = setup()
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [cost({ source: 'on_request' })] })
    expect(persisted[0]).toMatchObject({ sourcingStatus: 'not_requested' })
    expect(persisted[0]).not.toHaveProperty('costRequestId')
  })
})

describe('loadOpenItemCosts', () => {
  it('groups by item and reads nothing for no items', async () => {
    const { em } = setup([], [cost(), cost({ id: 'ic-3', subscriptionItemId: 'item-2' })])
    expect(await loadOpenItemCosts(em as never, [], SCOPE)).toEqual(new Map())
    expect(em.find).not.toHaveBeenCalled()
    const grouped = await loadOpenItemCosts(em as never, ['item-1', 'item-2'], SCOPE)
    expect([...grouped.keys()]).toEqual(['item-1', 'item-2'])
  })
})
