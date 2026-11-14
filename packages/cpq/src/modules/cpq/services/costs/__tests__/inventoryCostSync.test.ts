import { CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscriptionItem, CpqOrderLineCost, CpqSubscriptionChangeLog } from '../../../data/entities'
import { DefaultCpqInventoryService } from '../../cpqInventoryService'
import { createMockEm } from '../../__tests__/_helpers/mockEm'
import {
  costSeedFromOrderLineCost, createAssetCosts, createItemCosts, isInventoryCostUnchanged, type CostSeed,
} from '../inventoryCostSync'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const CTX = { scope: SCOPE, startedAt: '2026-11-14' }
type Row = Record<string, any>

const seed = (over: Partial<CostSeed> = {}): CostSeed => ({
  orderLineCostId: 'olc-1', costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1', name: 'Tail', role: 'price_basis', costType: 'mrc',
  source: 'table', costModel: 'per_unit', valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000',
  currencyCode: 'EUR', fxRate: null, fxRateDate: null, indexSnapshot: null, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: null,
  validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null, ...over,
})

function setup(existing: Row[] = []) {
  const created: Row[] = []
  const em: Row = {
    find: jest.fn(async (entity: unknown, where: Row) => {
      expect(entity).toBe(CpqInventoryCost)
      expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null })
      return existing
    }),
    create: jest.fn((entity: unknown, data: Row) => { expect(entity).toBe(CpqInventoryCost); const row = { ...data }; created.push(row); return row }),
    persist: jest.fn(),
  }
  return { em, created }
}
const item = (seeds: CostSeed[], id = 'item-1') => ({ subscriptionId: 'sub-1', subscriptionItemId: id, seeds })
const asset = (seeds: CostSeed[], id = 'asset-1') => ({ subscriptionId: 'sub-1', assetId: id, seeds })
const stored = (over: Row = {}): Row => ({ id: 'ic-1', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', assetId: null, status: 'active', endedAt: null, startedAt: '2026-01-01',
  lastChangeId: 'log-0', lastOrderLineCostId: 'olc-0', deletedAt: null, ...seed(), ...over })

describe('createItemCosts', () => {
  it('creates one active item cost per seed, started at the activation date, with a pre-generated id', async () => {
    const { em, created } = setup()
    const result = await createItemCosts(em as never, [item([seed(), seed({ costKey: 'install', orderLineCostId: 'olc-2', costType: 'nrc' })])], CTX)
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ organizationId: 'org', tenantId: 'tenant', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', assetId: null,
      status: 'active', startedAt: '2026-11-14', endedAt: null, lastOrderLineCostId: 'olc-1', costKey: 'tail', totalAmount: '270.0000' })
    expect(created[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.changes.map((c) => [c.kind, c.ownerType, c.costKey, c.subscriptionItemId, c.assetId])).toEqual([
      ['created', 'subscription_item', 'tail', 'item-1', null], ['created', 'subscription_item', 'install', 'item-1', null],
    ])
    expect(result.links).toEqual([{ orderLineCostId: 'olc-1', inventoryCostId: created[0].id }, { orderLineCostId: 'olc-2', inventoryCostId: created[1].id }])
    expect(em.persist).toHaveBeenCalledTimes(2)
  })

  it('reads the existing rows of ALL owners with one query', async () => {
    const { em } = setup()
    await createItemCosts(em as never, [item([seed()], 'i1'), item([seed()], 'i2'), item([seed()], 'i3')], CTX)
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.find.mock.calls[0][1].subscriptionItemId).toEqual({ $in: ['i1', 'i2', 'i3'] })
  })

  it('does not query or write for owners without seeds', async () => {
    const { em, created } = setup()
    const result = await createItemCosts(em as never, [item([])], CTX)
    expect(em.find).not.toHaveBeenCalled()
    expect(created).toEqual([])
    expect(result).toEqual({ rows: [], changes: [], links: [] })
  })

  it('keeps one row per owner and cost_key: duplicate keys of an owner are refused, the same key on two owners is fine', async () => {
    const { em } = setup()
    await expect(createItemCosts(em as never, [item([seed(), seed()])], CTX)).rejects.toThrow(/Duplicate cost_key/)
    const ok = await createItemCosts(setup().em as never, [item([seed()], 'i1'), item([seed()], 'i2')], CTX)
    expect(ok.changes).toHaveLength(2)
  })

  it('updates an existing row in place (same id) when a value changed', async () => {
    const row = stored()
    const { em, created } = setup([row])
    const result = await createItemCosts(em as never, [item([seed({ totalAmount: '300.0000', instanceAmount: '300.0000', orderLineCostId: 'olc-9' })])], CTX)
    expect(created).toEqual([])
    expect(row).toMatchObject({ id: 'ic-1', instanceAmount: '300.0000', totalAmount: '300.0000', status: 'active', lastOrderLineCostId: 'olc-9', startedAt: '2026-01-01' })
    expect(result.changes).toEqual([expect.objectContaining({ inventoryCostId: 'ic-1', kind: 'changed' })])
  })

  it('reactivates an ended row for a returning cost_key instead of inserting a second one (Q9)', async () => {
    const row = stored({ status: 'ended', endedAt: '2026-06-01' })
    const { em, created } = setup([row])
    const result = await createItemCosts(em as never, [item([seed()])], CTX)
    expect(created).toEqual([])
    expect(row).toMatchObject({ id: 'ic-1', status: 'active', endedAt: null })
    expect(result.changes).toEqual([expect.objectContaining({ inventoryCostId: 'ic-1', kind: 'changed' })])
  })

  it('is a no-op for a row whose values and status already equal the seed: no write, no change, last_change_id untouched', async () => {
    const row = stored({ unitAmount: '270', instanceAmount: '270.00', totalAmount: '270.0000', indexSnapshot: { b: 1, a: 2 } })
    const before = { ...row }
    const { em } = setup([row])
    const result = await createItemCosts(em as never, [item([seed({ indexSnapshot: { a: 2, b: 1 } })])], CTX)
    expect(result.changes).toEqual([])
    expect(result.rows).toEqual([row])
    expect(row).toEqual(before)
    // the order line cost still links to the row that already holds its values
    expect(result.links).toEqual([{ orderLineCostId: 'olc-1', inventoryCostId: 'ic-1' }])
    expect(em.persist).not.toHaveBeenCalled()
    expect(isInventoryCostUnchanged(row as never, seed({ indexSnapshot: { a: 2, b: 1 } }))).toBe(true)
  })

  it('writes only the rows that differ when several seeds are synced', async () => {
    const same = stored()
    const differs = stored({ id: 'ic-2', costKey: 'install' })
    const { em } = setup([same, differs])
    const result = await createItemCosts(em as never, [item([seed(), seed({ costKey: 'install', supplierName: 'Carrier Y', orderLineCostId: 'olc-2' })])], CTX)
    expect(result.changes.map((c) => c.inventoryCostId)).toEqual(['ic-2'])
    expect(differs.supplierName).toBe('Carrier Y')
  })

  it('rejects an invalid owner (no item id, or an asset id set as well, or no subscription)', async () => {
    const { em } = setup()
    await expect(createItemCosts(em as never, [{ subscriptionId: 'sub-1', subscriptionItemId: '', seeds: [seed()] }], CTX)).rejects.toThrow(/exactly one/)
    await expect(createItemCosts(em as never, [{ subscriptionId: 'sub-1', subscriptionItemId: 'i', assetId: 'a', seeds: [seed()] } as never], CTX)).rejects.toThrow(/exactly one/)
    await expect(createItemCosts(em as never, [{ subscriptionId: '', subscriptionItemId: 'i', seeds: [seed()] }], CTX)).rejects.toThrow(/exactly one/)
    expect(em.persist).not.toHaveBeenCalled()
  })
})

describe('createAssetCosts', () => {
  it('creates asset-owned costs: asset_id set, subscription_item_id null (Q2)', async () => {
    const { em, created } = setup()
    const result = await createAssetCosts(em as never, [asset([seed({ costKey: 'hardware', costType: 'nrc' }), seed({ costKey: 'licence', orderLineCostId: 'olc-2' })])], CTX)
    expect(created.map((row) => [row.costKey, row.assetId, row.subscriptionItemId])).toEqual([['hardware', 'asset-1', null], ['licence', 'asset-1', null]])
    expect(result.changes.map((c) => [c.ownerType, c.assetId, c.subscriptionItemId])).toEqual([['asset', 'asset-1', null], ['asset', 'asset-1', null]])
    expect(em.find.mock.calls[0][1].assetId).toEqual({ $in: ['asset-1'] })
  })

  it('keeps asset and item cost keys apart: an item cost with the same key never matches an asset lookup', async () => {
    const { em } = setup([])
    const result = await createAssetCosts(em as never, [asset([seed()])], CTX)
    expect(result.changes[0]).toMatchObject({ kind: 'created', assetId: 'asset-1' })
  })

  it('refuses an owner that carries an item id', async () => {
    const { em } = setup()
    await expect(createAssetCosts(em as never, [{ subscriptionId: 's', assetId: 'a', subscriptionItemId: 'i', seeds: [seed()] } as never], CTX)).rejects.toThrow(/exactly one/)
  })
})

describe('costSeedFromOrderLineCost', () => {
  it('maps an order line cost to a seed that remembers its id', () => {
    const row = Object.assign(new CpqOrderLineCost(), { id: 'olc-5', ...seed({ orderLineCostId: null }), note: undefined })
    expect(costSeedFromOrderLineCost(row)).toEqual(seed({ orderLineCostId: 'olc-5' }))
  })
})

describe('createSubscriptionWithCosts: write ordering, assets inside, last_change_id (Q2, Q12)', () => {
  const SC = { organizationId: 'org', tenantId: 'tenant' }

  /** Stateful mock EM: created rows are visible to later `find` calls (the snapshot reads them), every step is traced. */
  function statefulEm() {
    const trace: string[] = []
    const store = new Map<unknown, Row[]>()
    const em = createMockEm()
    em.create.mockImplementation((entity: unknown, data: Row) => {
      const row = { ...data, id: (data.id as string | undefined) ?? 'gen' }
      store.set(entity, [...(store.get(entity) ?? []), row])
      trace.push(`create:${(entity as { name: string }).name}`)
      return row
    })
    em.find.mockImplementation(async (entity: unknown) => {
      trace.push(`find:${(entity as { name: string }).name}`)
      // existing inventory costs of the owners: none (fresh subscription); the rest reads what was created
      return entity === CpqInventoryCost ? [] : (store.get(entity) ?? [])
    })
    em.flush.mockImplementation(async () => { trace.push('flush') })
    return { em, trace, store }
  }
  const run = (over: Row = {}) => {
    const h = statefulEm()
    const service = new DefaultCpqInventoryService(h.em as never)
    const input = {
      customerId: 'cust', name: 'S', currencyCode: 'EUR', sourceOrderId: 'order-1', code: 'SUB-1',
      items: [{ name: 'Tail', mrcAmount: 400, costs: [seed(), seed({ costKey: 'install', orderLineCostId: 'olc-2', costType: 'nrc' })] }, { name: 'Plain' }],
      assets: [
        { name: 'Server', purchasePrice: 5000, parentItemIndex: 0, costs: [seed({ costKey: 'hardware', orderLineCostId: 'olc-3', costType: 'nrc' }), seed({ costKey: 'licence', orderLineCostId: 'olc-4' })] },
        { name: 'Switch', purchasePrice: 100 },
      ],
      ...over,
    }
    return { ...h, service, input }
  }

  it('creates items, assets and their costs, flushes, snapshots, writes the change log, then sets last_change_id and flushes', async () => {
    const { service, input, trace, store } = run()
    const result = await service.createSubscriptionWithCosts(input as never, SC)

    // items -> assets -> costs (item then asset) -> ONE flush -> after-snapshot reads -> change log -> final flush
    const created = trace.filter((step) => step.startsWith('create:'))
    expect(created).toEqual([
      'create:CpqInventorySubscription', 'create:CpqInventorySubscriptionItem', 'create:CpqInventorySubscriptionItem',
      'create:CpqInventoryAsset', 'create:CpqInventoryAsset',
      'create:CpqInventoryCost', 'create:CpqInventoryCost', 'create:CpqInventoryCost', 'create:CpqInventoryCost',
      'create:CpqSubscriptionChangeLog',
    ])
    const flushes = trace.reduce<number[]>((acc, step, index) => (step === 'flush' ? [...acc, index] : acc), [])
    expect(flushes).toHaveLength(2)
    const idx = (step: string) => trace.indexOf(step)
    expect(trace.lastIndexOf('create:CpqInventoryCost')).toBeLessThan(flushes[0])
    expect(flushes[0]).toBeLessThan(idx('find:CpqInventorySubscriptionItem')) // snapshot only after the costs are flushed
    expect(idx('find:CpqInventoryAsset')).toBeLessThan(idx('create:CpqSubscriptionChangeLog'))
    expect(idx('create:CpqSubscriptionChangeLog')).toBeLessThan(flushes[1])

    // last_change_id: every cost written in this step points at the created change-log row
    const log = store.get(CpqSubscriptionChangeLog)![0]
    const costs = store.get(CpqInventoryCost)!
    expect(costs).toHaveLength(4)
    expect(costs.every((cost) => cost.lastChangeId === log.id)).toBe(true)
    expect(result.subscription.lastChangeLogId).toBe(log.id)
    expect(result.inventoryCostChanges.map((c) => [c.ownerType, c.costKey, c.kind])).toEqual([
      ['subscription_item', 'tail', 'created'], ['subscription_item', 'install', 'created'], ['asset', 'hardware', 'created'], ['asset', 'licence', 'created'],
    ])
    expect(result.inventoryCostLinks.map((l) => l.orderLineCostId)).toEqual(['olc-1', 'olc-2', 'olc-3', 'olc-4'])
  })

  it('the created snapshot lists the new-sale assets (they are created before it), linked to their parent item', async () => {
    const { service, input, store } = run()
    await service.createSubscriptionWithCosts(input as never, SC)
    const snapshot = store.get(CpqSubscriptionChangeLog)![0].afterSnapshot as { assets: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> }
    const [tail] = store.get(CpqInventorySubscriptionItem)!
    expect(snapshot.assets.map((a) => a.name)).toEqual(['Server', 'Switch'])
    expect(snapshot.assets[0]).toMatchObject({ subscriptionItemId: tail.id, status: 'pending' })
    expect(snapshot.assets[1].subscriptionItemId).toBeNull()
    expect(snapshot.items.map((i) => i.name)).toEqual(['Tail', 'Plain'])
  })

  it('asset costs are owned by the asset (asset_id set, item id null); item costs by the item', async () => {
    const { service, input, store } = run()
    const { subscription } = await service.createSubscriptionWithCosts(input as never, SC)
    const [server] = store.get(CpqInventoryAsset)!
    const [tail] = store.get(CpqInventorySubscriptionItem)!
    const owners = store.get(CpqInventoryCost)!.map((c) => [c.costKey, c.subscriptionItemId, c.assetId])
    expect(owners).toEqual([['tail', tail.id, null], ['install', tail.id, null], ['hardware', null, server.id], ['licence', null, server.id]])
    expect(store.get(CpqInventoryCost)!.every((c) => c.subscriptionId === subscription.id)).toBe(true)
  })

  it('gives each new-sale asset its own code from one count (rows are not flushed between them)', async () => {
    const { service, input, store, em } = run()
    em.count.mockResolvedValue(7)
    await service.createSubscriptionWithCosts(input as never, SC)
    const codes = store.get(CpqInventoryAsset)!.map((a) => a.code)
    const year = new Date().getFullYear()
    expect(codes).toEqual([`AST-${year}-00008`, `AST-${year}-00009`])
  })

  it('refuses a parentItemIndex that matches no item', async () => {
    const { service, input } = run({ assets: [{ name: 'Server', parentItemIndex: 5 }] })
    await expect(service.createSubscriptionWithCosts(input as never, SC)).rejects.toMatchObject({ status: 400 })
  })

  it('an uncosted subscription writes no cost row and keeps today\'s two flushes', async () => {
    const { service, trace, store } = run({ items: [{ name: 'Plain', mrcAmount: 10 }], assets: undefined })
    const result = await service.createSubscriptionWithCosts({ customerId: 'cust', name: 'S', currencyCode: 'EUR', code: 'SUB-1', items: [{ name: 'Plain', mrcAmount: 10 }] }, SC)
    expect(store.get(CpqInventoryCost)).toBeUndefined()
    expect(trace.filter((step) => step === 'flush')).toHaveLength(2)
    expect(result.inventoryCostChanges).toEqual([])
    expect(trace.filter((step) => step === 'find:CpqInventoryCost')).toEqual([])
  })

  it('createSubscription still returns the subscription entity alone (nothing cost-related leaks into the route response)', async () => {
    const { service, input } = run()
    const sub = await service.createSubscription(input as never, SC)
    expect(Object.keys(sub)).not.toEqual(expect.arrayContaining(['inventoryCostChanges']))
    expect(JSON.stringify(sub)).not.toMatch(/inventoryCost|costLinks/)
  })
})
