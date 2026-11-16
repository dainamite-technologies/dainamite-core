import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { CpqCostExpiryWarning, CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineCost } from '../../../data/entities'
import { CpqCostExpiryService, addDays, daysBetween } from '../costExpiryService'

type Row = Record<string, any>
const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const NOW = new Date('2026-11-06T06:00:00Z')

/** A tiny filter matcher: equality, $in / $nin (a value list or a query-builder semi-join), $ne, $lt(e), $gt, $and, $or. */
function matches(row: Row, where: Row, data: Map<unknown, Row[]>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === '$and') return (cond as Row[]).every((part) => matches(row, part, data))
    if (key === '$or') return (cond as Row[]).some((part) => matches(row, part, data))
    const value = row[key]
    if (cond === null) return value === null || value === undefined
    if (cond instanceof Date || typeof cond !== 'object') return cond instanceof Date ? value instanceof Date && value.getTime() === cond.getTime() : value === cond
    const op = cond as Row
    const list = (v: any): unknown[] => (v && v.__qb ? subquery(v, data) : v)
    return Object.entries(op).every(([name, arg]) => {
      switch (name) {
        case '$in': return list(arg).includes(value)
        case '$nin': return !list(arg).includes(value)
        case '$ne': return arg === null ? value !== null && value !== undefined : value !== arg
        case '$lte': return value !== null && value <= (arg as any)
        case '$lt': return value !== null && value < (arg as any)
        case '$gt': return value !== null && value > (arg as any)
        default: throw new Error(`unsupported operator ${name}`)
      }
    })
  })
}
function subquery(qb: Row, data: Map<unknown, Row[]>): unknown[] {
  return (data.get(qb.entity) ?? []).filter((row) => matches(row, qb.where ?? {}, data)).map((row) => row[qb.field.split('.')[1]])
}

function lineRow(over: Row = {}): Row {
  return {
    id: 'cost-1', organizationId: 'org', tenantId: 'tenant', quoteConfigurationId: 'qc-1', quoteId: 'sq-1', quoteLineId: 'line-1',
    costKey: 'tail', chargeCode: 'mrc', name: 'Tail circuit', role: 'price_basis', valueStatus: 'confirmed', validUntil: '2026-11-20',
    deletedAt: null, supplierName: 'SecretSupplier', unitAmount: '7777.7700', ...over,
  }
}

function setup(opts: { lines?: Row[]; quotes?: Row[]; orders?: Row[]; ledger?: Row[]; toggle?: boolean; recipients?: string[]; batchSize?: number; emitFails?: boolean } = {}) {
  const data = new Map<unknown, Row[]>([
    [CpqQuoteLineCost, opts.lines ?? [lineRow()]],
    [CpqQuoteConfiguration, opts.quotes ?? [{ id: 'qc-1', quoteId: 'sq-1', organizationId: 'org', tenantId: 'tenant', cpqStatus: 'ready', deletedAt: null }]],
    [SalesQuote, [{ id: 'sq-1', quoteNumber: 'Q-2026-1', organizationId: 'org', tenantId: 'tenant', deletedAt: null }]],
    [CpqOrderConfiguration, opts.orders ?? []],
    [CpqCostExpiryWarning, opts.ledger ?? []],
  ])
  const ledger = data.get(CpqCostExpiryWarning)!
  let seq = 0
  const kysely = {
    insertInto: () => ({
      values: (rows: Row[]) => ({
        onConflict: (build: (c: Row) => unknown) => {
          const spec: Row = {}
          build({ columns: (cols: string[]) => { spec.cols = cols; return { doNothing: () => undefined } } })
          return { returning: () => ({ execute: async () => {
            const out: Row[] = []
            for (const row of rows) {
              // Mirrors the DB unique key (quote_line_cost_id, valid_until) and the NOT NULL columns.
              for (const col of ['quote_line_cost_id', 'quote_id', 'quote_line_id', 'valid_until', 'lead_days', 'expired', 'created_at', 'organization_id', 'tenant_id']) expect(row[col]).not.toBeUndefined()
              if (ledger.some((existing) => existing.quoteLineCostId === row.quote_line_cost_id && existing.validUntil === row.valid_until)) continue
              const id = `w-${++seq}`
              ledger.push({ id, organizationId: row.organization_id, tenantId: row.tenant_id, quoteLineCostId: row.quote_line_cost_id, quoteId: row.quote_id,
                quoteLineId: row.quote_line_id, validUntil: row.valid_until, leadDays: row.lead_days, expired: row.expired, emittedAt: null, createdAt: row.created_at })
              out.push({ id, quote_line_cost_id: row.quote_line_cost_id })
            }
            return out
          } }) }
        },
      }),
    }),
    updateTable: () => {
      const state: Row = {}
      const chain: Row = {
        set: (values: Row) => { state.set = values; return chain },
        where: (col: string, _op: string, value: unknown) => { if (col === 'id') state.ids = value; return chain },
        execute: async () => { for (const row of ledger) if ((state.ids as string[]).includes(row.id)) row.emittedAt = state.set.emitted_at },
      }
      return chain
    },
  }
  const em: Row = {
    fork: jest.fn(() => em),
    find: jest.fn(async (entity: unknown, where: Row, options: Row = {}) => {
      let rows = (data.get(entity) ?? []).filter((row) => matches(row, where, data))
      for (const order of [...(options.orderBy ?? [])].reverse()) {
        const [[key, dir]] = Object.entries(order) as [[string, string]]
        rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
      }
      return options.limit ? rows.slice(0, options.limit) : rows
    }),
    findOne: jest.fn(async (entity: unknown, where: Row) => (data.get(entity) ?? []).find((row) => matches(row, where, data)) ?? null),
    createQueryBuilder: jest.fn((entity: unknown) => {
      const qb: Row = { __qb: true, entity }
      qb.select = (field: string) => { qb.field = field; return qb }
      qb.where = (where: Row) => { qb.where = where; return qb }
      return qb
    }),
    getKysely: () => kysely,
  }
  const emit = jest.fn(async (..._args: unknown[]) => { if (opts.emitFails) throw new Error('bus down') })
  const toggles = {
    getBoolConfig: jest.fn(async () => ({ ok: true, value: opts.toggle ?? true })),
    getNumberConfig: jest.fn(async () => ({ ok: true, value: 14 })),
  }
  const createBatch = jest.fn(async (..._args: unknown[]) => [])
  const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
  // The recipient lookup is a kysely select over `users`; the service only needs it to resolve one manager.
  const baseKysely = kysely as Row
  baseKysely.selectFrom = () => { const q: Row = {}; for (const m of ['where', 'select']) q[m] = () => q; q.execute = async () => (opts.recipients ?? ['manager']).map((user_id) => ({ user_id })); return q }
  const service = new CpqCostExpiryService({
    em: em as never, featureTogglesService: toggles as never, emit: emit as never, batchSize: opts.batchSize,
    notify: { notificationService: { createBatch } as never, rbacService: rbacService as never },
  })
  return { service, em, emit, createBatch, ledger, data, toggles }
}
const run = (service: CpqCostExpiryService, today: string, extra: Row = {}) => service.run({ scope: SCOPE, today, now: NOW, ...extra })

describe('date helpers', () => {
  it('adds and diffs UTC calendar days', () => {
    expect(addDays('2026-11-06', 14)).toBe('2026-11-20')
    expect(daysBetween('2026-11-06', '2026-11-20')).toBe(14)
    expect(daysBetween('2026-11-20', '2026-11-18')).toBe(-2)
  })
})

describe('CpqCostExpiryService', () => {
  it('warns once per (line, valid_until) over two runs: one ledger row, one event, one notification', async () => {
    const t = setup()
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 1, reEmitted: 0 })
    expect(await run(t.service, '2026-11-07')).toEqual({ inserted: 0, reEmitted: 0 })
    expect(t.ledger).toHaveLength(1)
    expect(t.ledger[0]).toMatchObject({ validUntil: '2026-11-20', leadDays: 14, expired: false, emittedAt: NOW })
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.createBatch).toHaveBeenCalledTimes(1)
    expect(t.emit).toHaveBeenCalledWith('cpq.quote.cost_expiring', expect.objectContaining({
      tenantId: 'tenant', organizationId: 'org', warningId: 'w-1', quoteId: 'qc-1', quoteLineId: 'line-1', costLineId: 'cost-1', costKey: 'tail', chargeCode: 'mrc',
      validUntil: '2026-11-20', daysLeft: 14, expired: false, leadDays: 14,
    }), { persistent: true })
  })

  it('sends one batch to the cost managers with the quote link, never an amount or supplier', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    const [input, ctx] = t.createBatch.mock.calls[0] as unknown as [Record<string, any>, unknown]
    expect(input).toMatchObject({
      type: 'cpq.cost.expiring', recipientUserIds: ['manager'], linkHref: '/backend/cpq/quotes/qc-1#costs',
      titleVariables: { quoteNumber: 'Q-2026-1' }, bodyVariables: { costName: 'Tail circuit', validUntil: '2026-11-20' }, bodyKey: 'cpq.notifications.costExpiring.body',
    })
    expect(ctx).toEqual({ tenantId: 'tenant', organizationId: 'org' })
    const serialized = JSON.stringify([t.emit.mock.calls, t.createBatch.mock.calls])
    expect(serialized).not.toMatch(/7777|SecretSupplier|unitAmount|supplierName|amount/i)
  })

  it('catches up three missed days without duplicates, flagging already expired lines', async () => {
    const t = setup({ lines: [
      lineRow({ id: 'a', validUntil: '2026-11-03' }), lineRow({ id: 'b', validUntil: '2026-11-18' }), lineRow({ id: 'c', validUntil: '2026-11-19' }), lineRow({ id: 'late', validUntil: '2026-12-31' }),
    ] })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 3 })
    expect(t.ledger.map((row) => [row.quoteLineCostId, row.expired])).toEqual([['a', true], ['b', false], ['c', false]])
    expect(await run(t.service, '2026-11-09')).toMatchObject({ inserted: 0 })
    const expired = t.emit.mock.calls.map((call) => call[1] as Row).find((payload) => payload.costLineId === 'a')!
    expect(expired).toMatchObject({ expired: true, daysLeft: -3 })
    expect(t.createBatch.mock.calls.some((call) => (call[0] as Row).bodyKey === 'cpq.notifications.costExpiring.bodyExpired')).toBe(true)
  })

  it('warns again at the new due date after a validity extension', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    t.data.get(CpqQuoteLineCost)![0].validUntil = '2026-12-31'
    expect(await run(t.service, '2026-11-20')).toMatchObject({ inserted: 0 })
    expect(await run(t.service, '2026-12-17')).toMatchObject({ inserted: 1 })
    expect(t.ledger.map((row) => row.validUntil)).toEqual(['2026-11-20', '2026-12-31'])
    expect(t.emit).toHaveBeenCalledTimes(2)
  })

  it('excludes rejected and cancelled quotes (SQL status filter) and converted quotes, but includes accepted', async () => {
    const quote = (id: string, status: string) => ({ id, quoteId: 'sq-1', organizationId: 'org', tenantId: 'tenant', cpqStatus: status, deletedAt: null })
    const t = setup({
      quotes: [quote('q-rej', 'rejected'), quote('q-can', 'cancelled'), quote('q-acc', 'accepted'), quote('q-ord', 'accepted'), quote('q-sent', 'sent')],
      lines: [
        lineRow({ id: 'rej', quoteConfigurationId: 'q-rej' }), lineRow({ id: 'can', quoteConfigurationId: 'q-can' }), lineRow({ id: 'acc', quoteConfigurationId: 'q-acc' }),
        lineRow({ id: 'ord', quoteConfigurationId: 'q-ord' }), lineRow({ id: 'sent', quoteConfigurationId: 'q-sent' }),
      ],
      orders: [{ id: 'order-1', sourceQuoteId: 'q-ord', organizationId: 'org', tenantId: 'tenant', deletedAt: null }],
    })
    await run(t.service, '2026-11-06')
    expect(t.ledger.map((row) => row.quoteLineCostId).sort()).toEqual(['acc', 'sent'])
  })

  it('excludes margin-only, unconfirmed, deleted, no-validity and other-tenant lines', async () => {
    const t = setup({ lines: [
      lineRow({ id: 'm', role: 'margin_only' }), lineRow({ id: 'e', valueStatus: 'estimated' }), lineRow({ id: 'n', valueStatus: 'none' }),
      lineRow({ id: 'd', deletedAt: new Date() }), lineRow({ id: 'v', validUntil: null }), lineRow({ id: 'x', tenantId: 'other' }), lineRow({ id: 'o', organizationId: 'other-org' }),
      lineRow({ id: 'ok' }),
    ] })
    await run(t.service, '2026-11-06')
    expect(t.ledger.map((row) => row.quoteLineCostId)).toEqual(['ok'])
  })

  it('is a no-op when the cost-plus toggle is off', async () => {
    const t = setup({ toggle: false })
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 0, reEmitted: 0, disabled: true })
    expect(t.ledger).toHaveLength(0)
    expect(t.emit).not.toHaveBeenCalled()
  })

  it('reads the lead days from the tenant toggle unless given, and falls back to 14', async () => {
    const t = setup()
    t.toggles.getNumberConfig.mockResolvedValueOnce({ ok: true, value: 3 })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 0 })
    expect(t.toggles.getNumberConfig).toHaveBeenCalledWith('cpq.cost_expiry_lead_days', 'tenant')
    t.toggles.getNumberConfig.mockResolvedValueOnce({ ok: false } as never)
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 1 })
    expect(t.ledger[0].leadDays).toBe(14)
    expect(await run(t.service, '2026-11-06', { leadDays: 30 })).toMatchObject({ inserted: 0 })
  })

  it('re-emits a stale un-emitted row once, and leaves a fresh one alone', async () => {
    const stale = { id: 'w-old', organizationId: 'org', tenantId: 'tenant', quoteLineCostId: 'cost-1', quoteId: 'qc-1', quoteLineId: 'line-1', validUntil: '2026-11-20',
      leadDays: 14, expired: false, emittedAt: null, createdAt: new Date(NOW.getTime() - 11 * 60_000) }
    const fresh = { ...stale, id: 'w-new', quoteLineCostId: 'cost-2', createdAt: new Date(NOW.getTime() - 2 * 60_000) }
    const t = setup({ ledger: [stale, fresh], lines: [lineRow(), lineRow({ id: 'cost-2' })] })
    expect(await run(t.service, '2026-11-06')).toEqual({ inserted: 0, reEmitted: 1 })
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.emit.mock.calls[0][1]).toMatchObject({ warningId: 'w-old', costLineId: 'cost-1' })
    expect(stale.emittedAt).toEqual(NOW)
    expect(fresh.emittedAt).toBeNull()
    expect(await run(t.service, '2026-11-06')).toMatchObject({ reEmitted: 0 })
    expect(t.emit).toHaveBeenCalledTimes(1)
  })

  it('leaves a row un-stamped when delivery fails, so the next run retries it', async () => {
    const t = setup({ emitFails: true })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 1 })
    expect(t.ledger[0].emittedAt).toBeNull()
    const later = new Date(NOW.getTime() + 11 * 60_000)
    t.emit.mockImplementation(async () => undefined)
    expect(await t.service.run({ scope: SCOPE, today: '2026-11-06', now: later })).toEqual({ inserted: 0, reEmitted: 1 })
    expect(t.ledger[0].emittedAt).toEqual(later)
  })

  it('pages the candidates in bounded batches without skipping or repeating a line', async () => {
    const lines = ['a', 'b', 'c', 'd', 'e'].map((id, i) => lineRow({ id, validUntil: `2026-11-1${i}` }))
    const t = setup({ lines, batchSize: 2 })
    expect(await run(t.service, '2026-11-06')).toMatchObject({ inserted: 5 })
    expect(t.ledger.map((row) => row.quoteLineCostId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(t.em.find.mock.calls.filter((call: unknown[]) => call[0] === CpqQuoteLineCost).every((call: any[]) => call[2].limit === 2)).toBe(true)
  })

  it('scopes the candidate query to the tenant and organization and orders it for the partial index', async () => {
    const t = setup()
    await run(t.service, '2026-11-06')
    const call = t.em.find.mock.calls.find((c: unknown[]) => c[0] === CpqQuoteLineCost)!
    expect(call[1]).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null, role: 'price_basis', valueStatus: 'confirmed', validUntil: { $ne: null, $lte: '2026-11-20' } })
    expect(call[2].orderBy).toEqual([{ validUntil: 'asc' }, { id: 'asc' }])
  })

  it('dry run counts without writing, emitting or notifying', async () => {
    const t = setup()
    expect(await run(t.service, '2026-11-06', { dryRun: true })).toEqual({ inserted: 1, reEmitted: 0 })
    expect(t.ledger).toHaveLength(0)
    expect(t.emit).not.toHaveBeenCalled()
    expect(t.createBatch).not.toHaveBeenCalled()
  })

  it('emits without a notification when the notifications peer is absent', async () => {
    const t = setup()
    const service = new CpqCostExpiryService({ em: t.em as never, featureTogglesService: t.toggles as never, emit: t.emit as never, notify: null })
    await run(service, '2026-11-06')
    expect(t.emit).toHaveBeenCalledTimes(1)
    expect(t.ledger[0].emittedAt).toEqual(NOW)
  })
})
