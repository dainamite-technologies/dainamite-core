import { CpqInventoryCost } from '../../../data/entities'
import { snapshotInventoryCost, stripSnapshotCosts } from '../inventoryCostSnapshot'

describe('stripSnapshotCosts', () => {
  it('removes items[].costs and assets[].costs, keeps everything else, and does not mutate the input', () => {
    const snapshot = { id: 's', status: 'active', items: [{ id: 'i', name: 'N', costs: [{ id: 'c' }] }, { id: 'j' }], assets: [{ id: 'a', costs: [] }] }
    const stripped = stripSnapshotCosts(snapshot)
    expect(stripped).toEqual({ id: 's', status: 'active', items: [{ id: 'i', name: 'N' }, { id: 'j' }], assets: [{ id: 'a' }] })
    expect(snapshot.items[0]).toHaveProperty('costs')
  })
  it('passes null, non-objects and snapshots without owners through', () => {
    expect(stripSnapshotCosts(null)).toBeNull()
    expect(stripSnapshotCosts(undefined)).toBeUndefined()
    expect(stripSnapshotCosts({ id: 's' })).toEqual({ id: 's' })
  })
  it('the snapshot cost shape carries the four fx fields (null when unset) and the strip removes them with the costs key', () => {
    const row = Object.assign(new CpqInventoryCost(), { id: 'ic', costKey: 'k', name: 'N', role: 'price_basis', costType: 'mrc', status: 'active', valueStatus: 'confirmed', startedAt: '2026-11-01',
      currencyCode: 'USD', fxRate: '0.77777777', fxRateDate: '2026-11-10', fxRateSource: 'SentinelFX', fxRateDerivation: 'inverse' })
    const shape = snapshotInventoryCost(row)
    expect(shape).toMatchObject({ fxRate: '0.77777777', fxRateDate: '2026-11-10', fxRateSource: 'SentinelFX', fxRateDerivation: 'inverse' })
    expect(snapshotInventoryCost(Object.assign(new CpqInventoryCost(), { ...row, fxRate: null, fxRateSource: null, fxRateDerivation: null, fxRateDate: null }))).toMatchObject({ fxRate: null, fxRateSource: null, fxRateDerivation: null })
    const stripped = JSON.stringify(stripSnapshotCosts({ items: [{ id: 'i', costs: [shape] }], assets: [{ id: 'a', costs: [shape] }] }))
    expect(stripped).not.toMatch(/SentinelFX|0\.77777777|fxRate/)
  })
})
