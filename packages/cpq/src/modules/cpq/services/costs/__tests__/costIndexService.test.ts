import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import { CpqCostIndex, CpqCostIndexValue } from '../../../data/entities'
import { CpqCostIndexService, type IndexReference } from '../costIndexService'

const scope = { organizationId: '55555555-5555-4555-8555-555555555555', tenantId: '44444444-4444-4444-8444-444444444444' }
const NOW = new Date('2026-11-12T10:00:00Z')
let seq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

type Row = Record<string, unknown>

/** In-memory EntityManager covering the query shapes of the service (equality, $in, $ne, $lte, $gt, $gte, $or / $ilike). */
function fakeEm() {
  const store = new Map<unknown, Row[]>([[CpqCostIndex, []], [CpqCostIndexValue, []]])
  const events: string[] = []
  const pending: Array<{ cls: unknown; row: Row }> = []
  const hooks = { failFlush: null as Error | null }
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, cond]) => {
    if (key === '$or') return (cond as Row[]).some((alt) => matches(row, alt))
    const actual = row[key]
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.entries(cond as Row).every(([op, expected]) => {
        if (op === '$in') return (expected as unknown[]).includes(actual)
        if (op === '$ne') return actual !== expected
        if (op === '$lte') return (actual as string) <= (expected as string)
        if (op === '$gte') return (actual as string) >= (expected as string)
        if (op === '$gt') return (actual as string) > (expected as string)
        if (op === '$ilike') return new RegExp(String(expected).replace(/\\/g, '').replace(/%/g, '.*'), 'i').test(String(actual))
        throw new Error(`unsupported operator ${op}`)
      })
    }
    return (actual ?? null) === (cond ?? null)
  })
  const sort = (rows: Row[], orderBy?: Row) => {
    if (!orderBy) return rows
    return [...rows].sort((a, b) => {
      for (const [key, dir] of Object.entries(orderBy)) {
        if (a[key] === b[key]) continue
        return ((a[key] as string) < (b[key] as string) ? -1 : 1) * (dir === 'desc' ? -1 : 1)
      }
      return 0
    })
  }
  const em: Record<string, unknown> = {
    fork: () => em,
    transactional: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = new Map([...store].map(([k, v]) => [k, [...v]]))
      try { return await fn(em) } catch (error) { for (const [k, v] of snapshot) store.set(k, v); pending.length = 0; throw error }
    },
    find: async (cls: unknown, where: Row, options: Row = {}) => sort(store.get(cls)!.filter((row) => matches(row, where)), options.orderBy as Row),
    findOne: async (cls: unknown, where: Row, options: Row = {}) => {
      const found = store.get(cls)!.find((row) => matches(row, where)) ?? null
      if (found && options.lockMode === LockMode.PESSIMISTIC_WRITE) events.push(`lock:${found.id}`)
      return found
    },
    findAndCount: async (cls: unknown, where: Row, options: Row = {}) => {
      const rows = sort(store.get(cls)!.filter((row) => matches(row, where)), options.orderBy as Row)
      const offset = (options.offset as number) ?? 0
      return [rows.slice(offset, offset + ((options.limit as number) ?? rows.length)), rows.length]
    },
    count: async (cls: unknown, where: Row) => store.get(cls)!.filter((row) => matches(row, where)).length,
    create: (cls: unknown, data: Row) => ({ id: uuid(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null, description: null, isActive: true, ...data, __cls: cls }),
    persist: (row: Row) => { pending.push({ cls: row.__cls, row }) },
    flush: async () => {
      if (hooks.failFlush) throw hooks.failFlush
      for (const { cls, row } of pending.splice(0)) {
        if (cls === CpqCostIndexValue && store.get(cls)!.some((s) => s.costIndexId === row.costIndexId && s.effectiveDate === row.effectiveDate && s.revision === row.revision)) {
          throw new UniqueConstraintViolationException(Object.assign(new Error('duplicate key'), { code: '23505' }))
        }
        store.get(cls)!.push(row)
        events.push(`insert:${cls === CpqCostIndexValue ? 'value' : 'index'}`)
      }
    },
  }
  return { em, store, events, hooks }
}

function setup(references: IndexReference[] = []) {
  const fake = fakeEm()
  const service = new CpqCostIndexService({
    em: fake.em as never, now: () => NOW, findReferences: async (_em, ids) => references.filter((ref) => ids.includes(ref.costIndexId)),
  })
  const addIndex = (over: Row = {}) => {
    const row = { id: uuid(), ...scope, code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD', description: null, isActive: true, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...over }
    fake.store.get(CpqCostIndex)!.push(row)
    return row as Row & { id: string }
  }
  const values = () => fake.store.get(CpqCostIndexValue)!
  return { ...fake, service, addIndex, values }
}

const ref = (costIndexId: string, over: Partial<IndexReference> = {}): IndexReference => ({ costIndexId, id: uuid(), code: 'fuel_surcharge', name: 'Fuel', role: 'price_basis', productChargeId: uuid(), chargeCode: 'transit', isActive: true, ...over })

describe('create', () => {
  it('stores an index, refuses a duplicate code per tenant and an unknown currency', async () => {
    const { service, values } = setup()
    const created = await service.create({ code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD' }, scope)
    expect(created).toMatchObject({ code: 'BRENT', isActive: true, currencyCode: 'USD' })
    await expect(service.create({ code: 'BRENT', name: 'Other', unit: 'x', currencyCode: 'EUR' }, scope)).rejects.toMatchObject({ status: 422, message: 'DUPLICATE_CODE' })
    await expect(service.create({ code: 'XXQ', name: 'Other', unit: 'x', currencyCode: 'QQQ' }, scope)).rejects.toMatchObject({ status: 422, message: 'UNKNOWN_CURRENCY' })
    expect(values()).toHaveLength(0)
  })

  it('maps a unique-index violation on the code to DUPLICATE_CODE', async () => {
    const { service, hooks } = setup()
    hooks.failFlush = new UniqueConstraintViolationException(Object.assign(new Error('dup'), { code: '23505' }))
    await expect(service.create({ code: 'BRENT', name: 'Brent', unit: 'x', currencyCode: 'USD' }, scope)).rejects.toMatchObject({ status: 422, message: 'DUPLICATE_CODE' })
  })
})

describe('appendValues: revisions', () => {
  it('assigns revision 1, then 2 on the same date, then 1 on another date', async () => {
    const { service, addIndex, values } = setup()
    const index = addIndex()
    const first = await service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 80 }, scope)
    const second = await service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 82.4, sourceNote: 'ICE' }, scope, { userId: 'u1' })
    const other = await service.appendValue(index.id, { effectiveDate: '2026-11-11', value: 81 }, scope)
    expect([first.revision, second.revision, other.revision]).toEqual([1, 2, 1])
    expect(values().map((row) => [row.effectiveDate, row.revision, row.value])).toEqual([['2026-11-10', 1, '80.000000'], ['2026-11-10', 2, '82.400000'], ['2026-11-11', 1, '81.000000']])
    expect(values()[1]).toMatchObject({ createdByUserId: 'u1', sourceNote: 'ICE', ...scope })
  })

  it('numbers several rows of one call on the same date sequentially', async () => {
    const { service, addIndex } = setup()
    const index = addIndex()
    const results = await service.appendValues(index.id, [{ effectiveDate: '2026-11-10', value: 80 }, { effectiveDate: '2026-11-10', value: 81 }], scope)
    expect(results.map((result) => result.revision)).toEqual([1, 2])
  })

  it('stores a re-entered identical value as a new revision for single appends (a correction is explicit)', async () => {
    const { service, addIndex, values } = setup()
    const index = addIndex()
    await service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 80 }, scope)
    await service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 80 }, scope)
    expect(values()).toHaveLength(2)
  })

  it('takes the index row lock before writing, and refuses an unknown, deleted or inactive index', async () => {
    const { service, addIndex, events } = setup()
    const index = addIndex()
    await service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 80 }, scope)
    expect(events).toEqual([`lock:${index.id}`, 'insert:value'])
    await expect(service.appendValue(uuid(), { effectiveDate: '2026-11-10', value: 1 }, scope)).rejects.toMatchObject({ status: 404 })
    const gone = addIndex({ code: 'GONE', deletedAt: NOW })
    await expect(service.appendValue(gone.id, { effectiveDate: '2026-11-10', value: 1 }, scope)).rejects.toMatchObject({ status: 404 })
    const off = addIndex({ code: 'OFF', isActive: false })
    await expect(service.appendValue(off.id, { effectiveDate: '2026-11-10', value: 1 }, scope)).rejects.toMatchObject({ status: 422, message: 'INDEX_INACTIVE' })
  })

  it('refuses a non-positive value before touching the database', async () => {
    const { service, addIndex, events } = setup()
    const index = addIndex()
    await expect(service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 0 }, scope)).rejects.toThrow()
    await expect(service.appendValue(index.id, { effectiveDate: '2026-11-10', value: -5 }, scope)).rejects.toThrow()
    expect(events).toEqual([])
  })

  it('a unique-key violation (a racing writer) becomes 409 CONCURRENT_INDEX_WRITE and stores nothing', async () => {
    const { service, addIndex, values, hooks } = setup()
    const index = addIndex()
    hooks.failFlush = new UniqueConstraintViolationException(Object.assign(new Error('duplicate key'), { code: '23505' }))
    await expect(service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 80 }, scope)).rejects.toMatchObject({ status: 409, message: 'CONCURRENT_INDEX_WRITE' })
    expect(values()).toHaveLength(0)
  })

  it('the unique key backstops a stale revision read (same index / date / revision inserted twice)', async () => {
    const { service, addIndex, values } = setup()
    const index = addIndex()
    values().push({ id: uuid(), ...scope, costIndexId: index.id, effectiveDate: '2026-11-10', revision: 1, value: '80.000000' })
    // A stale read would assign revision 1 again; simulate by hiding the stored row from the revision read only.
    const original = (service as unknown as { loadRevisionState: unknown }).loadRevisionState
    ;(service as unknown as { loadRevisionState: () => Promise<Map<string, unknown>> }).loadRevisionState = async () => new Map()
    await expect(service.appendValue(index.id, { effectiveDate: '2026-11-10', value: 81 }, scope)).rejects.toMatchObject({ status: 409, message: 'CONCURRENT_INDEX_WRITE' })
    ;(service as unknown as { loadRevisionState: unknown }).loadRevisionState = original
    expect(values()).toHaveLength(1)
  })
})

describe('value in force', () => {
  async function seeded() {
    const ctx = setup()
    const brent = ctx.addIndex()
    const gas = ctx.addIndex({ code: 'GAS', currencyCode: 'EUR' })
    const put = (index: Row, date: string, revision: number, value: string) =>
      ctx.values().push({ id: uuid(), ...scope, costIndexId: index.id, effectiveDate: date, revision, value })
    put(brent, '2026-11-10', 1, '80.000000')
    put(brent, '2026-11-10', 2, '82.400000')
    put(brent, '2026-12-01', 1, '90.000000')
    put(gas, '2026-11-01', 1, '30.000000')
    return { ...ctx, brent, gas, put }
  }

  it('picks the highest revision of the latest date on or before the as-of date', async () => {
    const { service, brent } = await seeded()
    expect(await service.valueInForce(brent.id, '2026-11-10', scope)).toEqual({ indexId: brent.id, effectiveDate: '2026-11-10', revision: 2, value: '82.400000' })
  })

  it('ignores a future-dated value', async () => {
    const { service, brent } = await seeded()
    expect(await service.valueInForce(brent.id, '2026-11-12', scope)).toMatchObject({ effectiveDate: '2026-11-10', value: '82.400000' })
    expect(await service.valueInForce(brent.id, '2026-12-01', scope)).toMatchObject({ effectiveDate: '2026-12-01', value: '90.000000' })
  })

  it('is null before the first value', async () => {
    const { service, brent } = await seeded()
    expect(await service.valueInForce(brent.id, '2026-11-09', scope)).toBeNull()
  })

  it('is deterministic whatever order the rows come back in (revision tie-break)', async () => {
    const { service, brent, put, values } = await seeded()
    put(brent, '2026-11-10', 3, '83.000000')
    const forward = await service.valueInForce(brent.id, '2026-11-12', scope)
    values().reverse()
    const reversed = await service.valueInForce(brent.id, '2026-11-12', scope)
    expect(forward).toEqual(reversed)
    expect(forward).toMatchObject({ revision: 3, value: '83.000000' })
  })

  it('valuesInForce answers many indices in one read and omits indices without a value', async () => {
    const { service, brent, gas, em } = await seeded()
    const find = jest.spyOn(em as { find: (...args: unknown[]) => unknown }, 'find')
    const empty = (await seeded()).addIndex({ code: 'EMPTY' })
    const result = await service.valuesInForce([brent.id, gas.id, empty.id, brent.id], '2026-11-12', scope)
    expect([...result.keys()].sort()).toEqual([brent.id, gas.id].sort())
    expect(result.get(gas.id)).toMatchObject({ value: '30.000000' })
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('does not read other tenants or organizations', async () => {
    const { service, brent } = await seeded()
    expect(await service.valueInForce(brent.id, '2026-11-12', { ...scope, tenantId: uuid() })).toBeNull()
  })

  it('listValues flags superseded / future / in-force-today and hides corrections by default', async () => {
    const { service, brent } = await seeded()
    const visible = await service.listValues(brent.id, scope, { page: 1, pageSize: 50 })
    expect(visible.items.map((item) => [item.effectiveDate, item.revision, item.inForceToday, item.future, item.superseded]))
      .toEqual([['2026-12-01', 1, false, true, false], ['2026-11-10', 2, true, false, false]])
    const all = await service.listValues(brent.id, scope, { page: 1, pageSize: 50, includeSuperseded: true })
    expect(all.items.map((item) => [item.revision, item.superseded])).toEqual([[1, false], [2, false], [1, true]])
    expect(all.total).toBe(3)
  })

  it('get reports the current value, future count and referencing elements; list reports elementCount', async () => {
    const { service, brent, put } = await seeded()
    put(brent, '2026-12-01', 2, '91.000000')
    const reference = ref(brent.id)
    const withRefs = new CpqCostIndexService({ em: (service as unknown as { deps: { em: never } }).deps.em, now: () => NOW, findReferences: async () => [reference] })
    const detail = await withRefs.get(brent.id, scope)
    expect(detail.current).toEqual({ effectiveDate: '2026-11-10', value: '82.400000', revision: 2 })
    expect(detail.futureValueCount).toBe(1)
    expect(detail.elements).toEqual([expect.objectContaining({ code: 'fuel_surcharge', chargeCode: 'transit' })])
    const listed = await withRefs.list(scope, { page: 1, pageSize: 10 })
    expect(listed.items.find((item) => item.code === 'BRENT')).toMatchObject({ elementCount: 1, current: { value: '82.400000' } })
    await expect(withRefs.get(uuid(), scope)).rejects.toMatchObject({ status: 404 })
  })
})

describe('importValues', () => {
  const row = (over: Row = {}) => ({ indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4, ...over })

  it('creates rows under one batch id, then reports the same feed unchanged without adding revisions', async () => {
    const { service, addIndex, values } = setup()
    addIndex()
    const feed = [row(), row({ effectiveDate: '2026-11-11', value: 83 })]
    const first = await service.importValues(feed, scope, { userId: 'u1' })
    expect(first.results).toEqual([
      { row: 1, indexCode: 'BRENT', effectiveDate: '2026-11-10', status: 'created', revision: 1 },
      { row: 2, indexCode: 'BRENT', effectiveDate: '2026-11-11', status: 'created', revision: 1 },
    ])
    expect(first.batchId).toEqual(expect.any(String))
    expect(new Set(values().map((v) => v.importBatchId))).toEqual(new Set([first.batchId]))
    const second = await service.importValues(feed, scope, { userId: 'u1' })
    expect(second.results.map((r) => r.status)).toEqual(['unchanged', 'unchanged'])
    expect(second.results.map((r) => r.revision)).toEqual([1, 1])
    expect(values()).toHaveLength(2)
  })

  it('a changed value for an existing date is a correction (revision + 1); unchanged rows in the same call are skipped', async () => {
    const { service, addIndex, values } = setup()
    addIndex()
    await service.importValues([row(), row({ effectiveDate: '2026-11-11', value: 83 })], scope)
    const run = await service.importValues([row({ value: 82.5 }), row({ effectiveDate: '2026-11-11', value: 83 })], scope)
    expect(run.results.map((r) => [r.status, r.revision])).toEqual([['created', 2], ['unchanged', 1]])
    expect(values()).toHaveLength(3)
  })

  it('dry run reports what would happen and writes nothing (no locks, no batch id)', async () => {
    const { service, addIndex, values, events } = setup()
    addIndex()
    await service.importValues([row()], scope)
    events.length = 0
    const preview = await service.importValues([row(), row({ effectiveDate: '2026-11-12', value: 70 })], scope, { dryRun: true })
    expect(preview).toMatchObject({ batchId: null, dryRun: true })
    expect(preview.results.map((r) => [r.status, r.revision])).toEqual([['unchanged', 1], ['created', 1]])
    expect(values()).toHaveLength(1)
    expect(events).toEqual([])
  })

  it('one invalid row fails the whole call with per-row errors and nothing is persisted', async () => {
    const { service, addIndex, values, events } = setup()
    addIndex()
    addIndex({ code: 'OFF', isActive: false })
    const rows = [
      row(), row({ indexCode: 'NOPE' }), row({ indexCode: 'OFF' }), row({ value: 0, effectiveDate: '2026-11-11' }),
      row({ effectiveDate: '2026-11-12' }), row({ effectiveDate: '2026-11-12', value: 1 }), 'garbage',
    ]
    const error = await service.importValues(rows, scope).catch((e) => e)
    expect(error).toMatchObject({ status: 422, details: { errors: [
      { row: 2, code: 'UNKNOWN_INDEX', indexCode: 'NOPE' }, { row: 3, code: 'INDEX_INACTIVE', indexCode: 'OFF' },
      { row: 4, code: 'INVALID_VALUE', indexCode: 'BRENT' }, { row: 6, code: 'DUPLICATE_ROW', indexCode: 'BRENT' }, { row: 7, code: 'INVALID_VALUE' },
    ] } })
    expect(values()).toHaveLength(0)
    expect(events).toEqual([])
    await expect(service.importValues(rows, scope, { dryRun: true })).rejects.toMatchObject({ status: 422 })
  })

  it('locks every touched index in ascending id order, whatever the row order', async () => {
    const { service, addIndex, events } = setup()
    const a = addIndex({ id: '00000000-0000-4000-8000-0000000000aa', code: 'AAA' })
    const b = addIndex({ id: '00000000-0000-4000-8000-0000000000bb', code: 'BBB' })
    const c = addIndex({ id: '00000000-0000-4000-8000-0000000000cc', code: 'CCC' })
    await service.importValues([row({ indexCode: 'CCC' }), row({ indexCode: 'AAA' }), row({ indexCode: 'BBB' }), row({ indexCode: 'AAA', effectiveDate: '2026-11-11' })], scope)
    expect(events.filter((event) => event.startsWith('lock:'))).toEqual([`lock:${a.id}`, `lock:${b.id}`, `lock:${c.id}`])
  })

  it('a unique violation during the import is a 409 and rolls the batch back', async () => {
    const { service, addIndex, values, hooks } = setup()
    addIndex()
    hooks.failFlush = new UniqueConstraintViolationException(Object.assign(new Error('duplicate key'), { code: '23505' }))
    await expect(service.importValues([row()], scope)).rejects.toMatchObject({ status: 409, message: 'CONCURRENT_INDEX_WRITE' })
    expect(values()).toHaveLength(0)
  })

  it('an index deactivated between the pre-check and the lock fails the import', async () => {
    const { service, addIndex, values, em } = setup()
    const index = addIndex()
    const transactional = (em as { transactional: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).transactional
    // The pre-check (before the transaction) saw the index active; it is deactivated before the lock is taken.
    ;(em as { transactional: unknown }).transactional = (fn: (tx: unknown) => Promise<unknown>) => { index.isActive = false; return transactional(fn) }
    await expect(service.importValues([row()], scope)).rejects.toMatchObject({ status: 422, details: { errors: [{ row: 1, code: 'INDEX_INACTIVE' }] } })
    expect(values()).toHaveLength(0)
  })
})

describe('update / setActive / softDelete', () => {
  it('code is immutable; currency is editable only without values and references', async () => {
    const { service, addIndex, values } = setup()
    const index = addIndex()
    await expect(service.update(index.id, { code: 'OTHER' }, scope)).rejects.toMatchObject({ status: 422, message: 'CODE_IMMUTABLE' })
    expect(await service.update(index.id, { code: 'BRENT', currencyCode: 'EUR', name: 'Brent EUR' }, scope)).toMatchObject({ currencyCode: 'EUR', name: 'Brent EUR' })
    values().push({ id: uuid(), ...scope, costIndexId: index.id, effectiveDate: '2026-11-10', revision: 1, value: '1.000000' })
    await expect(service.update(index.id, { currencyCode: 'USD' }, scope)).rejects.toMatchObject({ status: 422, message: 'INDEX_CURRENCY_LOCKED' })
    expect(index.currencyCode).toBe('EUR')
    // An unchanged currency is not a change.
    await expect(service.update(index.id, { currencyCode: 'EUR', name: 'Still fine' }, scope)).resolves.toMatchObject({ name: 'Still fine' })
  })

  it('a referencing element (even an inactive one) locks the currency', async () => {
    const { em, addIndex } = setup()
    const index = addIndex()
    const service = new CpqCostIndexService({ em: em as never, now: () => NOW, findReferences: async () => [ref(index.id, { isActive: false })] })
    await expect(service.update(index.id, { currencyCode: 'EUR' }, scope)).rejects.toMatchObject({ status: 422, message: 'INDEX_CURRENCY_LOCKED' })
  })

  it('deactivating is refused while an active element uses the index (listing it), allowed for inactive references', async () => {
    const { em, addIndex } = setup()
    const index = addIndex()
    const active = ref(index.id)
    const blocked = new CpqCostIndexService({ em: em as never, now: () => NOW, findReferences: async () => [active] })
    const error = await blocked.setActive(index.id, false, scope).catch((e) => e)
    expect(error).toMatchObject({ status: 422, message: 'INDEX_IN_USE', details: { elements: [expect.objectContaining({ id: active.id, code: 'fuel_surcharge', chargeCode: 'transit' })] } })
    expect(index.isActive).toBe(true)
    const inactiveOnly = new CpqCostIndexService({ em: em as never, now: () => NOW, findReferences: async () => [ref(index.id, { isActive: false })] })
    expect(await inactiveOnly.setActive(index.id, false, scope)).toMatchObject({ isActive: false })
    expect(await inactiveOnly.setActive(index.id, true, scope)).toMatchObject({ isActive: true })
  })

  it('soft delete is refused for any referencing element, otherwise stamps deletedAt and keeps the values', async () => {
    const { em, addIndex, values } = setup()
    const used = addIndex({ code: 'USED' })
    const free = addIndex({ code: 'FREE' })
    values().push({ id: uuid(), ...scope, costIndexId: free.id, effectiveDate: '2026-11-10', revision: 1, value: '1.000000' })
    const service = new CpqCostIndexService({ em: em as never, now: () => NOW, findReferences: async (_em, ids) => ids.includes(used.id) ? [ref(used.id, { isActive: false })] : [] })
    await expect(service.softDelete(used.id, scope)).rejects.toMatchObject({ status: 422, message: 'INDEX_IN_USE', details: { elements: [expect.any(Object)] } })
    expect(used.deletedAt).toBeNull()
    await service.softDelete(free.id, scope)
    expect(free.deletedAt).toEqual(NOW)
    expect(values()).toHaveLength(1)
    await expect(service.softDelete(free.id, scope)).rejects.toMatchObject({ status: 404 })
  })

  it('the default in-use query reports nothing until the element fields are wired', async () => {
    const { service, addIndex } = setup()
    const index = addIndex()
    const plain = new CpqCostIndexService({ em: (service as unknown as { deps: { em: never } }).deps.em, now: () => NOW })
    expect(await plain.referencingElements(index.id, scope)).toEqual([])
    await expect(plain.softDelete(index.id, scope)).resolves.toBeUndefined()
  })
})
