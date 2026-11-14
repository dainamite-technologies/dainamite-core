import { costDiffValueText, diffOwners, diffSnapshotCosts, type SnapshotCost } from '../costDiff'

const cost = (patch: Partial<SnapshotCost> = {}): SnapshotCost => ({
  id: 'c1', costKey: 'tail', name: 'Tail', status: 'active', valueStatus: 'confirmed', unitAmount: '270', instanceAmount: '270', totalAmount: '270',
  currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: '2999-12-31', supplierTermEnd: null, ...patch,
})
const snap = (items: Array<[string, SnapshotCost[] | undefined]> = [], assets: Array<[string, SnapshotCost[] | undefined]> = []) => ({
  items: items.map(([id, costs]) => ({ id, name: `Item ${id}`, ...(costs ? { costs } : {}) })),
  assets: assets.map(([id, costs]) => ({ id, name: `Asset ${id}`, ...(costs ? { costs } : {}) })),
})

describe('diffSnapshotCosts', () => {
  it('returns nothing without costs keys (non-holders, uncosted subscriptions) and for null snapshots', () => {
    expect(diffSnapshotCosts(snap([['i1', undefined]], [['a1', undefined]]), snap([['i1', undefined]], [['a1', undefined]]))).toEqual([])
    expect(diffSnapshotCosts(null, null)).toEqual([])
    expect(diffSnapshotCosts(undefined, { items: [{ id: 'i1' }] })).toEqual([])
  })

  it('reports a changed cost with the differing fields, for items and assets', () => {
    const before = snap([['i1', [cost()]]], [['a1', [cost({ id: 'c2' })]]])
    const after = snap([['i1', [cost({ totalAmount: '300', supplierName: 'Carrier Y' })]]], [['a1', [cost({ id: 'c2', validUntil: '2030-01-01' })]]])
    const out = diffSnapshotCosts(before, after)
    expect(out.map((e) => [e.kind, e.ownerType, e.ownerId, e.fields])).toEqual([
      ['changed', 'item', 'i1', ['totalAmount', 'supplierName']],
      ['changed', 'asset', 'a1', ['validUntil']],
    ])
    expect(costDiffValueText(out[0])).toBe('270 EUR → 300 EUR · Carrier Y')
  })

  it('ignores identical costs', () => {
    expect(diffSnapshotCosts(snap([['i1', [cost()]]]), snap([['i1', [cost()]]]))).toEqual([])
  })

  it('reports added costs (null before snapshot, new row, new asset)', () => {
    const out = diffSnapshotCosts(null, snap([['i1', [cost()]]], [['a1', [cost({ id: 'c2' })]]]))
    expect(out.map((e) => [e.kind, e.ownerType, e.costId])).toEqual([['added', 'item', 'c1'], ['added', 'asset', 'c2']])
    expect(costDiffValueText(out[0])).toBe('270 EUR · Carrier X')
  })

  it('reports ended costs: status flipped to ended, or gone from the snapshot', () => {
    const flipped = diffSnapshotCosts(snap([['i1', [cost()]]]), snap([['i1', [cost({ status: 'ended' })]]]))
    expect(flipped.map((e) => e.kind)).toEqual(['ended'])
    const gone = diffSnapshotCosts(snap([['i1', [cost()]]]), snap([['i1', undefined]]))
    expect(gone.map((e) => [e.kind, e.after])).toEqual([['ended', null]])
    // an already ended cost that stays ended is not news
    expect(diffSnapshotCosts(snap([['i1', [cost({ status: 'ended' })]]]), snap([['i1', [cost({ status: 'ended' })]]]))).toEqual([])
  })

  it('reports a reactivated cost as changed', () => {
    const out = diffSnapshotCosts(snap([['i1', [cost({ status: 'ended' })]]]), snap([['i1', [cost()]]]))
    expect(out.map((e) => [e.kind, e.fields])).toEqual([['changed', ['status']]])
  })

  it('reports a cost under a different owner as moved, with the previous owner', () => {
    const out = diffSnapshotCosts(snap([['i1', [cost()]], ['i2', undefined]]), snap([['i1', undefined], ['i2', [cost()]]]))
    expect(out.map((e) => [e.kind, e.ownerId, e.fromOwnerId])).toEqual([['moved', 'i2', 'i1']])
    const asset = diffSnapshotCosts(snap([], [['a1', [cost()]]]), snap([], [['a2', [cost()]]]))
    expect(asset.map((e) => [e.kind, e.ownerType, e.fromOwnerId])).toEqual([['moved', 'asset', 'a1']])
  })

  it('treats merge rows as moves between subscriptions', () => {
    const result = diffSnapshotCosts(null, snap([['m1', [cost()]]], [['ma', [cost({ id: 'c2' })]]]), { merge: 'result' })
    expect(result.map((e) => e.kind)).toEqual(['moved', 'moved'])
    const source = diffSnapshotCosts(snap([['i1', [cost()]]]), snap([['i1', undefined]]), { merge: 'source' })
    expect(source.map((e) => [e.kind, e.after])).toEqual([['moved', null]])
  })

  it('lists the owners that have entries, for the per-item filter', () => {
    const out = diffSnapshotCosts(null, snap([['i1', [cost(), cost({ id: 'c3', costKey: 'x' })]]], [['a1', [cost({ id: 'c2' })]]]))
    expect(diffOwners(out)).toEqual([
      { ownerType: 'item', ownerId: 'i1', ownerName: 'Item i1' },
      { ownerType: 'asset', ownerId: 'a1', ownerName: 'Asset a1' },
    ])
  })
})
