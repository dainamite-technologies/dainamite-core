import { stripSnapshotCosts } from '../inventoryCostSnapshot'

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
})
