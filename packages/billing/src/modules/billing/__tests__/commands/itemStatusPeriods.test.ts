import { BillingItem, BillingItemStatusPeriod } from '../../data/entities'
import {
  bulkStatusPeriodCommand,
  createStatusPeriodCommand,
  deleteStatusPeriodCommand,
  updateStatusPeriodCommand,
} from '../../commands/itemStatusPeriods'

/**
 * Line status period commands (L §4.3, contract C1): no overlaps, resume via
 * `toDate`, D6 read-only CPQ lines (system context allowed), undo, bulk.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
type Row = Record<string, unknown>

function env(options: { items?: Row[]; periods?: Row[]; auth?: unknown } = {}) {
  const items = options.items ?? [{ id: ITEM, tenantId: TENANT, organizationId: ORG, type: 'recurring', subscriptionId: null, billEndDate: null }]
  const periods = options.periods ?? []
  const created: Row[] = []
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '$in' in (value as object)) return ((value as { $in: unknown[] }).$in).includes(row[key])
      if (key === 'deletedAt' && value === null) return !row.deletedAt
      return row[key] === value
    })
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const pool = entity === BillingItem ? items : periods
      return pool.find((row) => match(row, where)) ?? null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const pool = entity === BillingItem ? items : [...periods, ...created]
      return pool.filter((row) => match(row, where))
    }),
    create: jest.fn((_entity: unknown, data: Row) => {
      const row = { ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    fork: jest.fn((): unknown => em),
  }
  const dataEngine = { markOrmEntityChange: jest.fn(), emitOrmEntityEvent: jest.fn() }
  const ctx = {
    container: { resolve: jest.fn((name: string) => (name === 'dataEngine' ? dataEngine : em)) },
    auth: options.auth === undefined ? { tenantId: TENANT, orgId: ORG, sub: 'user-1' } : options.auth,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    organizationScope: null,
  }
  return { ctx, created, periods, dataEngine }
}

const scope = { tenantId: TENANT, organizationId: ORG }

describe('billing.items.status_periods.create', () => {
  it('creates a pause with the default no_charge behaviour', async () => {
    const { ctx, created } = env()
    const result = await createStatusPeriodCommand.execute(
      { ...scope, billingItemId: ITEM, status: 'paused', fromDate: d('2027-01-10'), toDate: d('2027-01-19') } as never,
      ctx as never,
    )
    expect(created[0]).toMatchObject({ id: result.id, status: 'paused', fromDate: '2027-01-10', toDate: '2027-01-19', chargeBehavior: 'no_charge' })
  })

  it('defaults suspended and grace to charge', async () => {
    const { ctx, created } = env()
    await createStatusPeriodCommand.execute({ ...scope, billingItemId: ITEM, status: 'suspended', fromDate: d('2027-01-10') } as never, ctx as never)
    expect(created[0]).toMatchObject({ chargeBehavior: 'charge', toDate: null })
  })

  it('refuses an overlapping period', async () => {
    const { ctx } = env({
      periods: [{ id: 'open', billingItemId: ITEM, tenantId: TENANT, organizationId: ORG, status: 'paused', fromDate: '2027-01-01', toDate: null, deletedAt: null }],
    })
    await expect(
      createStatusPeriodCommand.execute({ ...scope, billingItemId: ITEM, status: 'suspended', fromDate: d('2027-03-01') } as never, ctx as never),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.status_period_overlap' } })
  })

  it('D6: a CPQ line is read-only for UI / REST callers, writable from the connector (auth null)', async () => {
    const cpqItem = { id: ITEM, tenantId: TENANT, organizationId: ORG, type: 'recurring', subscriptionId: 'sub-1' }
    const ui = env({ items: [cpqItem] })
    await expect(
      createStatusPeriodCommand.execute({ ...scope, billingItemId: ITEM, status: 'paused', fromDate: d('2027-01-10') } as never, ui.ctx as never),
    ).rejects.toMatchObject({ status: 422, body: { code: 'billing.item.status_period_read_only' } })
    const connector = env({ items: [cpqItem], auth: null })
    await createStatusPeriodCommand.execute({ ...scope, billingItemId: ITEM, status: 'paused', fromDate: d('2027-01-10') } as never, connector.ctx as never)
    expect(connector.created).toHaveLength(1)
  })

  it('undo of a create soft-deletes the row', async () => {
    const row = { id: '55555555-5555-4555-8555-555555555555', billingItemId: ITEM, tenantId: TENANT, organizationId: ORG, status: 'paused', fromDate: '2027-01-10', toDate: null, chargeBehavior: 'no_charge', deletedAt: null }
    const { ctx } = env({ periods: [row] })
    await createStatusPeriodCommand.undo!({
      input: {} as never,
      ctx: ctx as never,
      logEntry: { commandPayload: { undo: { after: { ...row, reason: null } } }, tenantId: TENANT, organizationId: ORG },
    })
    expect(row.deletedAt).toBeInstanceOf(Date)
  })
})

describe('billing.items.status_periods.update — resume', () => {
  const open = (): Row => ({ id: '55555555-5555-4555-8555-555555555555', billingItemId: ITEM, tenantId: TENANT, organizationId: ORG, status: 'paused', fromDate: '2027-01-10', toDate: null, chargeBehavior: 'no_charge', deletedAt: null })

  it('sets the end of the open period', async () => {
    const row = open()
    const { ctx } = env({ periods: [row] })
    await updateStatusPeriodCommand.execute({ ...scope, id: '55555555-5555-4555-8555-555555555555', toDate: d('2027-01-19') } as never, ctx as never)
    expect(row.toDate).toBe('2027-01-19')
  })

  it('refuses an end before the start and an overlap with a later period', async () => {
    const row = open()
    const later = { id: 'sp-2', billingItemId: ITEM, tenantId: TENANT, organizationId: ORG, status: 'suspended', fromDate: '2027-03-01', toDate: '2027-03-10', deletedAt: null }
    const { ctx } = env({ periods: [{ ...row, toDate: '2027-02-01' }, later] })
    await expect(updateStatusPeriodCommand.execute({ ...scope, id: '55555555-5555-4555-8555-555555555555', toDate: d('2027-01-01') } as never, ctx as never)).rejects.toMatchObject({
      body: { code: 'billing.item.status_period_end_before_start' },
    })
    await expect(updateStatusPeriodCommand.execute({ ...scope, id: '55555555-5555-4555-8555-555555555555', toDate: d('2027-03-05') } as never, ctx as never)).rejects.toMatchObject({
      body: { code: 'billing.item.status_period_overlap' },
    })
  })

  it('undo restores the before snapshot', async () => {
    const row = { ...open(), toDate: '2027-01-19' }
    const { ctx } = env({ periods: [row] })
    await updateStatusPeriodCommand.undo!({
      input: {} as never,
      ctx: ctx as never,
      logEntry: { commandPayload: { undo: { before: { ...open(), reason: null } } } },
    })
    expect(row.toDate).toBeNull()
  })

  it('delete soft-deletes', async () => {
    const row = open()
    const { ctx } = env({ periods: [row] })
    await deleteStatusPeriodCommand.execute({ ...scope, id: '55555555-5555-4555-8555-555555555555' } as never, ctx as never)
    expect(row.deletedAt).toBeInstanceOf(Date)
  })
})

describe('billing.items.status_periods.bulk_create', () => {
  it('suspends every live line, skipping CPQ lines, overlaps, ended and one-time lines', async () => {
    const base = { tenantId: TENANT, organizationId: ORG, billAccountId: ACCOUNT, isActive: true, deletedAt: null, billEndDate: null, subscriptionId: null }
    const items = [
      { ...base, id: 'a', type: 'recurring' },
      { ...base, id: 'b', type: 'usage' },
      { ...base, id: 'c', type: 'recurring', subscriptionId: 'sub-1' },
      { ...base, id: 'd', type: 'recurring', billEndDate: '2027-01-31' },
      { ...base, id: 'e', type: 'recurring' },
      { ...base, id: 'f', type: 'one_time' },
    ]
    const periods = [{ id: 'x', billingItemId: 'e', tenantId: TENANT, organizationId: ORG, status: 'paused', fromDate: '2027-02-10', toDate: null, deletedAt: null }]
    const { ctx, created } = env({ items, periods })
    const result = await bulkStatusPeriodCommand.execute(
      { ...scope, billAccountId: ACCOUNT, status: 'suspended', fromDate: d('2027-02-01'), chargeBehavior: 'no_charge', reason: 'Non-payment' } as never,
      ctx as never,
    )
    expect(result.created.map((c) => c.billingItemId)).toEqual(['a', 'b'])
    expect(result.skipped).toEqual([
      { billingItemId: 'c', reason: 'read_only' },
      { billingItemId: 'd', reason: 'ended' },
      { billingItemId: 'e', reason: 'overlap' },
    ])
    expect(created.every((row) => row.chargeBehavior === 'no_charge' && row.reason === 'Non-payment')).toBe(true)
  })

  it('undo soft-deletes the created rows', async () => {
    const row = { id: '55555555-5555-4555-8555-555555555555', tenantId: TENANT, organizationId: ORG, billingItemId: ITEM, deletedAt: null }
    const { ctx } = env({ periods: [row] })
    await bulkStatusPeriodCommand.undo!({
      input: {} as never,
      ctx: ctx as never,
      logEntry: { commandPayload: { undo: { createdIds: ['55555555-5555-4555-8555-555555555555'] } }, tenantId: TENANT, organizationId: ORG },
    })
    expect(row.deletedAt).toBeInstanceOf(Date)
  })
})

void BillingItemStatusPeriod
