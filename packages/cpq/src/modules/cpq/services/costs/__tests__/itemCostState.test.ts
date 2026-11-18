import { CpqInventoryCost, CpqInventorySubscriptionItem, CpqQuoteLineCost } from '../../../data/entities'
import {
  assertCarriedCostsFresh,
  carriedCostLines,
  CostSourceChangedError,
  findStaleCarriedCosts,
  itemCostSetHash,
  itemCostStateHash,
  type ItemCostStateRow,
} from '../itemCostState'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

const row = (over: Partial<ItemCostStateRow> = {}): ItemCostStateRow => ({
  id: 'ic-1', subscriptionItemId: 'item-1', costKey: 'tail', status: 'active', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1', name: 'Tail',
  role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '270.0000',
  instanceAmount: '270.0000', totalAmount: '270.0000', currencyCode: 'EUR', fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null,
  indexSnapshot: null, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30', supplierTermEnd: '2028-11-30',
  supplierMinTermMonths: 12, note: null, ...over,
})

describe('itemCostStateHash', () => {
  const base = itemCostStateHash(row())

  it.each<[string, Partial<ItemCostStateRow>]>([
    ['id', { id: 'ic-2' }],
    ['subscriptionItemId (a merge re-point)', { subscriptionItemId: 'item-2' }],
    ['costKey', { costKey: 'install' }],
    ['status', { status: 'ended' }],
    ['chargeCode', { chargeCode: 'nrc' }],
    ['origin', { origin: 'manual' }],
    ['costElementId', { costElementId: 'el-2' }],
    ['name', { name: 'Tail 2' }],
    ['role', { role: 'margin_only' }],
    ['costType', { costType: 'nrc' }],
    ['source', { source: 'on_request' }],
    ['costModel', { costModel: 'per_unit' }],
    ['valueStatus', { valueStatus: 'estimated' }],
    ['valueOrigin', { valueOrigin: 'supplier' }],
    ['unitAmount', { unitAmount: '240' }],
    ['instanceAmount', { instanceAmount: '240' }],
    ['totalAmount', { totalAmount: '240' }],
    ['currencyCode', { currencyCode: 'USD' }],
    ['fxRate (PR #96)', { fxRate: '0.92' }],
    ['fxRateDate (PR #96)', { fxRateDate: '2026-11-01' }],
    ['fxRateSource (PR #96)', { fxRateSource: 'ecb' }],
    ['fxRateDerivation (PR #96)', { fxRateDerivation: 'inverse' }],
    ['indexSnapshot', { indexSnapshot: { index: 'cpi', value: 1.2 } }],
    ['supplierId', { supplierId: 'sup-2' }],
    ['supplierName', { supplierName: 'Carrier Y' }],
    ['supplierQuoteRef', { supplierQuoteRef: 'CX-2' }],
    ['validUntil', { validUntil: '2029-01-31' }],
    ['supplierTermEnd', { supplierTermEnd: '2029-01-31' }],
    ['supplierMinTermMonths', { supplierMinTermMonths: 24 }],
    ['note', { note: 'renegotiated' }],
  ])('a change of %s changes the hash', (_field, over) => {
    expect(itemCostStateHash(row(over))).not.toBe(base)
  })

  it('ignores updated_at, created_at and the bookkeeping columns (they are not projected)', () => {
    const noisy = { ...row(), updatedAt: new Date('2030-01-01'), createdAt: new Date('2030-01-01'), lastChangeId: 'log-9', lastOrderLineCostId: 'olc-9', startedAt: '2030-01-01', endedAt: null, subscriptionId: 'sub-9' }
    expect(itemCostStateHash(noisy)).toBe(base)
  })

  it('normalises decimals, dates and null vs undefined', () => {
    expect(itemCostStateHash(row({ unitAmount: '270', instanceAmount: '270', totalAmount: '270.00' }))).toBe(base)
    expect(itemCostStateHash(row({ validUntil: '2028-11-30T00:00:00.000Z' as string }))).toBe(base)
    expect(itemCostStateHash(row({ note: undefined as never, fxRate: undefined as never, indexSnapshot: undefined as never }))).toBe(base)
    expect(itemCostStateHash(row({ indexSnapshot: { b: 1, a: 2 } }))).toBe(itemCostStateHash(row({ indexSnapshot: { a: 2, b: 1 } })))
  })
})

describe('itemCostSetHash', () => {
  const a = row({ id: 'ic-a', costKey: 'a' })
  const b = row({ id: 'ic-b', costKey: 'b', unitAmount: '10' })

  it('does not depend on row order', () => {
    expect(itemCostSetHash([a, b])).toBe(itemCostSetHash([b, a]))
  })

  it('changes when a key is added, a value changes or a row is re-pointed to another item', () => {
    const base = itemCostSetHash([a])
    expect(itemCostSetHash([a, b])).not.toBe(base)
    expect(itemCostSetHash([row({ id: 'ic-a', costKey: 'a', unitAmount: '1' })])).not.toBe(base)
    expect(itemCostSetHash([row({ id: 'ic-a', costKey: 'a', subscriptionItemId: 'item-9' })])).not.toBe(base)
  })

  it('counts open rows only: an ended row is excluded', () => {
    expect(itemCostSetHash([a, row({ id: 'ic-b', costKey: 'b', status: 'ended' })])).toBe(itemCostSetHash([a]))
  })

  it('an owner that is not live has no open costs (PR #94 Q6): the hash of the empty set', () => {
    const empty = itemCostSetHash([])
    for (const status of ['terminated', 'expired', 'superseded']) expect(itemCostSetHash([a, b], { status })).toBe(empty)
    expect(itemCostSetHash([a, b], { status: 'active', deletedAt: new Date() })).toBe(empty)
    expect(itemCostSetHash([a, b], { status: 'active' })).toBe(itemCostSetHash([a, b]))
    expect(itemCostSetHash([a, b], { status: 'active' })).not.toBe(empty)
  })

  it('an item without costs has a stable hash of the empty set', () => {
    expect(itemCostSetHash([])).toBe(itemCostSetHash([row({ status: 'ended' })]))
  })
})

describe('carriedCostLines', () => {
  const line = (id: string, configuration: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    ({ quoteLineId: id, action: 'modify', configuration, sourceSubscriptionItemId: `item-${id}`, ...over }) as never

  it('covers only lines with both markers, and never a termination line', () => {
    const marked = { _arcMirroredFromItemId: 'i', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h1' }
    expect(carriedCostLines([
      line('ql-1', marked),
      line('ql-2', { _arcMirroredFromItemId: 'i' }),
      line('ql-3', { ...marked, _arcCarriedCostSetHash: undefined }),
      line('ql-4', { ...marked, _arcCostsCarried: false }),
      line('ql-5', marked, { action: 'cancel' }),
      line('ql-6', marked, { sourceSubscriptionItemId: null }),
    ], 'amend')).toEqual([
      { quoteLineId: 'ql-1', subscriptionItemId: 'item-ql-1', expectedSetHash: 'h1' },
      { quoteLineId: 'ql-6', subscriptionItemId: 'i', expectedSetHash: 'h1' },
    ])
  })

  it('covers nothing on a line without markers (the guard is a no-op until the carry step)', () => {
    expect(carriedCostLines([line('ql-1', {})], 'amend')).toEqual([])
  })
})

describe('findStaleCarriedCosts / assertCarriedCostsFresh', () => {
  const item = { id: 'item-1', status: 'active', deletedAt: null }
  const quoteRow = (over: Record<string, unknown>) => ({ quoteLineId: 'ql-1', costKey: 'tail', carriedFromItemCostId: 'ic-1', carriedFromHash: itemCostStateHash(row()), ...over })

  function setup(options: { items?: unknown[]; costs?: unknown[]; carried?: unknown[] }) {
    const em = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === CpqInventorySubscriptionItem) return options.items ?? [item]
        if (entity === CpqInventoryCost) return options.costs ?? [row()]
        if (entity === CpqQuoteLineCost) return options.carried ?? [quoteRow({})]
        return []
      }),
    }
    return em
  }
  const covered = (costs: ItemCostStateRow[] = [row()]) => [{ quoteLineId: 'ql-1', subscriptionItemId: 'item-1', expectedSetHash: itemCostSetHash(costs) }]

  it('reads nothing without covered lines', async () => {
    const em = setup({})
    await expect(findStaleCarriedCosts(em as never, [], SCOPE)).resolves.toEqual([])
    await assertCarriedCostsFresh(em as never, [], SCOPE)
    expect(em.find).not.toHaveBeenCalled()
  })

  it('passes with two reads when the open costs are as recorded', async () => {
    const em = setup({})
    await assertCarriedCostsFresh(em as never, covered(), SCOPE)
    expect(em.find).toHaveBeenCalledTimes(2)
  })

  it('names the changed key (value, supplier), a key that ended, a re-pointed row and an added key', async () => {
    const changed = row({ unitAmount: '240' })
    expect(await findStaleCarriedCosts(setup({ costs: [changed] }) as never, covered(), SCOPE)).toEqual([{ quoteLineId: 'ql-1', subscriptionItemId: 'item-1', costKeys: ['tail'] }])
    expect(await findStaleCarriedCosts(setup({ costs: [row({ supplierId: 'sup-9' })] }) as never, covered(), SCOPE)).toMatchObject([{ costKeys: ['tail'] }])
    // ended: the query asks for active rows, the DB returns none
    expect(await findStaleCarriedCosts(setup({ costs: [] }) as never, covered(), SCOPE)).toMatchObject([{ costKeys: ['tail'] }])
    // re-pointed to a clone on another item: the same id, now owned by item-9, is not in this item's open rows any more
    expect(await findStaleCarriedCosts(setup({ costs: [row({ subscriptionItemId: 'item-9' })] }) as never, covered(), SCOPE)).toMatchObject([{ costKeys: ['tail'] }])
    const added = row({ id: 'ic-2', costKey: 'install' })
    expect(await findStaleCarriedCosts(setup({ costs: [row(), added] }) as never, covered(), SCOPE)).toMatchObject([{ costKeys: ['install'] }])
  })

  it('a not-live item has no open costs, so it is stale against a recorded non-empty set', async () => {
    const em = setup({ items: [{ ...item, status: 'terminated' }] })
    await expect(findStaleCarriedCosts(em as never, covered(), SCOPE)).resolves.toHaveLength(1)
  })

  it('throws CostSourceChangedError by default, or the caller\'s own error, and writes nothing', async () => {
    const em = setup({ costs: [row({ unitAmount: '240' })] })
    await expect(assertCarriedCostsFresh(em as never, covered(), SCOPE)).rejects.toBeInstanceOf(CostSourceChangedError)
    await expect(assertCarriedCostsFresh(em as never, covered(), SCOPE, (lines) => Object.assign(new Error('mine'), { lines }))).rejects.toMatchObject({ message: 'mine', lines: [{ quoteLineId: 'ql-1' }] })
  })

  it('scopes every read by tenant and organization and filters deleted rows', async () => {
    const em = setup({ costs: [row({ unitAmount: '240' })] })
    await findStaleCarriedCosts(em as never, covered(), SCOPE)
    for (const [, where] of em.find.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>) {
      expect(where).toMatchObject({ organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
    }
  })
})
