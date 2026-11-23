import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { CpqCostExpiryWarning, CpqOrderConfiguration, CpqQuoteConfiguration, CpqQuoteLineCost } from '../../../../data/entities'
import { CpqCostExpiryService } from '../../costExpiryService'

/** In-memory harness for costExpiryService tests: filter-matching em, ledger kysely, event / notification mocks. */
export type Row = Record<string, any>
export const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
export const NOW = new Date('2026-11-06T06:00:00Z')

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

export function lineRow(over: Row = {}): Row {
  return {
    id: 'cost-1', organizationId: 'org', tenantId: 'tenant', quoteConfigurationId: 'qc-1', quoteId: 'sq-1', quoteLineId: 'line-1',
    costKey: 'tail', chargeCode: 'mrc', name: 'Tail circuit', role: 'price_basis', valueStatus: 'confirmed', validUntil: '2026-11-20',
    deletedAt: null, supplierName: 'SecretSupplier', unitAmount: '7777.7700', ...over,
  }
}

export function setup(opts: { lines?: Row[]; quotes?: Row[]; orders?: Row[]; ledger?: Row[]; toggle?: boolean; recipients?: string[]; batchSize?: number; emitFails?: boolean } = {}) {
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
export const run = (service: CpqCostExpiryService, today: string, extra: Row = {}) => service.run({ scope: SCOPE, today, now: NOW, ...extra })

