import cliCommands from '../cli'
import { CpqSubscriptionChangeLog } from '../data/entities'
import { scrubChangeLogCosts } from '../lib/scrubChangeLogCosts'

type Row = Record<string, unknown>

/** In-memory change-log table honouring tenant / `id > cursor` filters, `limit`, `nativeUpdate` and `clear`. */
function logStore(rows: Row[]) {
  const em = {
    find: jest.fn(async (_entity: unknown, where: Row, options: { limit: number }) => {
      const gt = (where.id as { $gt?: string } | undefined)?.$gt
      return rows
        .filter((row) => (!where.tenantId || row.tenantId === where.tenantId) && (!gt || (row.id as string) > gt))
        .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1))
        .slice(0, options.limit)
        .map((row) => ({ ...row }))
    }),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Row, patch: Row) => {
      Object.assign(rows.find((row) => row.id === where.id) as Row, patch)
      return 1
    }),
    clear: jest.fn(),
  }
  return em
}

const cost = { id: 'ic-1', costKey: 'tail', totalAmount: '270.0000', supplierId: 'sup-1' }
const snapshot = (withCosts: boolean) => ({
  id: 'sub-1',
  status: 'active',
  items: [{ id: 'item-1', name: 'Line', mrcAmount: '50', ...(withCosts ? { costs: [cost] } : {}) }, { id: 'item-2', name: 'Plain' }],
  assets: [{ id: 'asset-1', name: 'Srv', ...(withCosts ? { costs: [{ ...cost, id: 'ic-a' }] } : {}) }],
})
const fixture = (): Row[] => [
  { id: 'l1', tenantId: 't1', changeType: 'created', beforeSnapshot: null, afterSnapshot: snapshot(true) },
  { id: 'l2', tenantId: 't1', changeType: 'amend', beforeSnapshot: snapshot(true), afterSnapshot: snapshot(true) },
  { id: 'l3', tenantId: 't2', changeType: 'cancel', beforeSnapshot: snapshot(false), afterSnapshot: snapshot(true) },
  { id: 'l4', tenantId: 't1', changeType: 'merge-source', beforeSnapshot: snapshot(false), afterSnapshot: null },
]

describe('scrubChangeLogCosts', () => {
  it('removes only items[].costs and assets[].costs, leaving every other key of the snapshots', async () => {
    const rows = fixture()
    const em = logStore(rows)
    const result = await scrubChangeLogCosts(em as never)
    expect(result).toEqual({ scanned: 4, affected: 3, dryRun: false })
    expect(rows[0].afterSnapshot).toEqual(snapshot(false))
    expect(rows[1]).toMatchObject({ beforeSnapshot: snapshot(false), afterSnapshot: snapshot(false) })
    expect(rows[2].afterSnapshot).toEqual(snapshot(false))
    expect(rows[3]).toMatchObject({ beforeSnapshot: snapshot(false), afterSnapshot: null })
    expect(rows[0]).toMatchObject({ changeType: 'created', beforeSnapshot: null })
  })

  it('is idempotent: a second run changes nothing', async () => {
    const rows = fixture()
    await scrubChangeLogCosts(logStore(rows) as never)
    const after = JSON.stringify(rows)
    const em = logStore(rows)
    const second = await scrubChangeLogCosts(em as never)
    expect(second).toEqual({ scanned: 4, affected: 0, dryRun: false })
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(JSON.stringify(rows)).toBe(after)
  })

  it('dry run counts but writes nothing', async () => {
    const rows = fixture()
    const before = JSON.stringify(rows)
    const em = logStore(rows)
    const result = await scrubChangeLogCosts(em as never, { dryRun: true })
    expect(result).toEqual({ scanned: 4, affected: 3, dryRun: true })
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('is tenant scoped with --tenant and pages by id (no full-table read)', async () => {
    const rows = fixture()
    const em = logStore(rows)
    const result = await scrubChangeLogCosts(em as never, { tenantId: 't1', batchSize: 1 })
    expect(result).toEqual({ scanned: 3, affected: 2, dryRun: false })
    expect(rows[2].afterSnapshot).toEqual(snapshot(true)) // tenant t2 untouched
    const limits = em.find.mock.calls.map(([, , options]) => (options as { limit: number }).limit)
    expect(new Set(limits)).toEqual(new Set([1]))
    expect(em.find.mock.calls.length).toBeGreaterThan(1)
    expect(em.find.mock.calls[0][0]).toBe(CpqSubscriptionChangeLog)
  })
})

describe('cpq scrub-change-log-costs command', () => {
  it('is registered', () => {
    expect(cliCommands.map((command) => command.command)).toContain('scrub-change-log-costs')
  })
})
