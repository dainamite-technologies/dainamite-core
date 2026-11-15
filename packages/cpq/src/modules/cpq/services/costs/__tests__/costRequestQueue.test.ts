import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqPricingTable, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../../data/entities'
import { cpqCostRequestListQuerySchema } from '../../../data/costRequests'
import { CpqCostRequestQueueService } from '../costRequestQueue'
import { overdueCutoff } from '../costSourcing'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const NOW = new Date('2026-11-17T10:00:00Z') // Tuesday
type Row = Record<string, any>

const costRow = (over: Row = {}): Row => ({
  id: 'cost-1', quoteId: 'sq-1', quoteConfigurationId: 'qc-1', quoteLineId: 'line-1', costKey: 'tail', name: 'Tail circuit', chargeCode: 'mrc',
  role: 'price_basis', origin: 'catalog', costElementId: 'el-1', sourcingStatus: 'requested', cancelReason: null, costRequestId: 'req-1', requestSeq: 1,
  requestedAt: new Date('2026-11-13T09:00:00Z'), requestSupplierId: 'sup-1', requestSupplierName: 'Acme', valueStatus: 'estimated', valueOrigin: 'catalog',
  unitAmount: '7777.7700', currencyCode: 'EUR', supplierId: 'sup-2', supplierName: 'SecretSupplier', supplierQuoteRef: 'Q-9', validUntil: '2027-01-01',
  proposedAmount: null, proposedAnswer: null, note: 'secret note', requestHistory: [{ costRequestId: 'old', outcome: 'cancelled' }], ...over,
})

function setup(opts: { rows?: Row[]; total?: number; threshold?: { ok: boolean; value?: number }; order?: Row | null } = {}) {
  const rows = opts.rows ?? [costRow()]
  const subquery: Row = {}
  subquery.select = jest.fn(() => subquery)
  subquery.where = jest.fn(() => subquery)
  const data = new Map<unknown, Row[]>([
    [CpqQuoteConfiguration, [{ id: 'qc-1', quoteId: 'sq-1', customerId: 'cust-1', cpqStatus: 'ready' }]],
    [SalesQuote, [{ id: 'sq-1', quoteNumber: 'Q-2026-1' }]],
    [CustomerEntity, [{ id: 'cust-1', displayName: 'Globex' }]],
    [SalesQuoteLine, [{ id: 'line-1', name: 'Ethernet 1G' }]],
    [CpqQuoteLineConfiguration, [{ quoteLineId: 'line-1', offeringId: 'off-1', configuration: { site: 'Berlin', bandwidth: 1000, unrelated: 'x' } }]],
    [CpqChargeCostElement, [{ id: 'el-1', costTableId: 'tbl-1', applicabilityCondition: { attribute: 'site' } }]],
    [CpqPricingTable, [{ id: 'tbl-1', dimensions: [{ key: 'bandwidth', label: 'BW' }] }]],
    [CpqOrderConfiguration, opts.order ? [opts.order] : []],
  ])
  const em: Row = {
    fork: jest.fn(() => em),
    find: jest.fn(async (entity: unknown) => data.get(entity) ?? []),
    findAndCount: jest.fn(async () => [rows, opts.total ?? rows.length]),
    findOne: jest.fn(async () => rows[0] ?? null),
    createQueryBuilder: jest.fn(() => subquery),
  }
  const getNumberConfig = jest.fn(async () => (opts.threshold ?? { ok: true, value: 5 }))
  const service = new CpqCostRequestQueueService({ em: em as never, featureTogglesService: { getNumberConfig } as never })
  return { service, em, subquery, getNumberConfig }
}
const query = (input: Record<string, string> = {}) => cpqCostRequestListQuerySchema.parse(input)
const whereOf = (em: Row) => em.findAndCount.mock.calls[0][1]

describe('list', () => {
  it('queries tenant-scoped, non-deleted rows of live quotes only, defaulting to the open queue', async () => {
    const { service, em, subquery } = setup()
    await service.list(SCOPE, query(), NOW)
    const where = whereOf(em)
    expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null })
    expect(where.$and).toContainEqual({ sourcingStatus: 'requested' })
    // Deleted CPQ or sales quotes: nested semi-join, no bound ids.
    expect(where.$and[0].quoteConfigurationId.$in).toBe(subquery)
    expect(em.createQueryBuilder).toHaveBeenCalledWith(SalesQuote, 'sq')
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null })
    expect(subquery.where).toHaveBeenCalledWith({ ...SCOPE, deletedAt: null, quoteId: { $in: subquery } })
  })

  it('paginates with the page size capped at 100 and returns the paging envelope', async () => {
    const { service, em } = setup({ total: 101 })
    const result = await service.list(SCOPE, query({ page: '2', pageSize: '100' }), NOW)
    expect(em.findAndCount.mock.calls[0][2]).toMatchObject({ limit: 100, offset: 100, orderBy: { requestedAt: 'asc', id: 'asc' } })
    expect(result).toMatchObject({ total: 101, totalPages: 2, page: 2, pageSize: 100, overdueThresholdWorkingDays: 5 })
    expect(() => query({ pageSize: '101' })).toThrow()
    expect(() => query({ status: 'bogus' })).toThrow()
  })

  it('projects each row from batched lookups (one find per entity, no N+1)', async () => {
    const rows = [costRow(), costRow({ id: 'cost-2' }), costRow({ id: 'cost-3' })]
    const { service, em } = setup({ rows, order: { id: 'order-1', sourceQuoteId: 'qc-1' } })
    const result = await service.list(SCOPE, query(), NOW)
    expect(em.find).toHaveBeenCalledTimes(8)
    expect(result.items[0]).toMatchObject({
      costId: 'cost-1', quoteNumber: 'Q-2026-1', customerName: 'Globex', productName: 'Ethernet 1G', offeringId: 'off-1',
      costKey: 'tail', costName: 'Tail circuit', keyAttributes: { site: 'Berlin', bandwidth: 1000 }, sourcingStatus: 'requested',
      requestSeq: 1, requestedAt: '2026-11-13T09:00:00.000Z', ageWorkingDays: 2, overdue: false, requestSupplierName: 'Acme',
      valueStatus: 'estimated', hasAnswerPending: false, cpqStatus: 'ready', orderId: 'order-1',
    })
    expect(result.items).toHaveLength(3)
  })

  it('never exposes an amount, a supplier answer or the note (I-4)', async () => {
    const { service } = setup({ rows: [costRow({ proposedAmount: '8888.00', proposedAnswer: { unitAmount: '8888.00' } })] })
    const result = await service.list(SCOPE, query(), NOW)
    const text = JSON.stringify(result)
    for (const secret of ['7777.77', '8888', 'SecretSupplier', 'secret note', 'Q-9']) expect(text).not.toContain(secret)
    expect(result.items[0].hasAnswerPending).toBe(true)
  })

  it('overdue filter: open requests strictly older than the working-day cutoff (exactly N days is not overdue)', async () => {
    const { service, em } = setup()
    await service.list(SCOPE, query({ overdue: 'true' }), NOW)
    const cutoff = whereOf(em).$and.find((c: Row) => c.requestedAt)
    expect(cutoff).toEqual({ sourcingStatus: 'requested', requestedAt: { $lt: overdueCutoff(NOW, 5) } })
    expect(cutoff.requestedAt.$lt.toISOString()).toBe('2026-11-10T00:00:00.000Z')
  })

  it('overdue filter follows the tenant threshold and falls back to the default when the toggle is unusable', async () => {
    const custom = setup({ threshold: { ok: true, value: 2 } })
    const first = await custom.service.list(SCOPE, query({ overdue: 'true' }), NOW)
    expect(first.overdueThresholdWorkingDays).toBe(2)
    expect(whereOf(custom.em).$and.find((c: Row) => c.requestedAt).requestedAt.$lt).toEqual(overdueCutoff(NOW, 2))
    for (const threshold of [{ ok: false }, { ok: true, value: -1 }, { ok: true, value: Number.NaN }]) {
      expect((await setup({ threshold }).service.list(SCOPE, query(), NOW)).overdueThresholdWorkingDays).toBe(5)
    }
  })

  it('flags overdue per row with the same threshold: a Monday request is overdue on Tuesday, a Friday one is not', async () => {
    const { service } = setup({ rows: [
      costRow({ id: 'monday', requestedAt: new Date('2026-11-09T09:00:00Z') }),
      costRow({ id: 'friday', requestedAt: new Date('2026-11-13T09:00:00Z') }),
      costRow({ id: 'boundary', requestedAt: new Date('2026-11-10T09:00:00Z') }),
      costRow({ id: 'closed', sourcingStatus: 'answered', requestedAt: new Date('2026-10-01T09:00:00Z') }),
    ] })
    const items = (await service.list(SCOPE, query(), NOW)).items
    expect(items.map((item) => [item.costId, item.ageWorkingDays, item.overdue])).toEqual([
      ['monday', 6, true], ['friday', 2, false], ['boundary', 5, false], ['closed', null, false],
    ])
  })

  it('overdue with a closed status filter is empty without querying', async () => {
    const { service, em } = setup()
    expect((await service.list(SCOPE, query({ overdue: 'true', status: 'answered' }), NOW)).items).toEqual([])
    expect(em.findAndCount).not.toHaveBeenCalled()
  })

  it('status all drops the status condition; cancelReason, supplier and quote narrow the rows', async () => {
    const { service, em } = setup()
    await service.list(SCOPE, query({ status: 'cancelled', cancelReason: 'quote_closed', supplierId: '11111111-1111-4111-8111-111111111111', quoteId: '22222222-2222-4222-8222-222222222222' }), NOW)
    expect(whereOf(em).$and).toEqual(expect.arrayContaining([
      { sourcingStatus: 'cancelled' }, { cancelReason: 'quote_closed' },
      { requestSupplierId: '11111111-1111-4111-8111-111111111111' }, { quoteId: '22222222-2222-4222-8222-222222222222' },
    ]))
    const all = setup()
    await all.service.list(SCOPE, query({ status: 'all' }), NOW)
    expect(JSON.stringify(whereOf(all.em).$and)).not.toContain('sourcingStatus')
  })

  it('search matches cost name, quote number and customer with an escaped pattern', async () => {
    const { service, em } = setup()
    await service.list(SCOPE, query({ search: '50%_x' }), NOW)
    const or = whereOf(em).$and.find((c: Row) => c.$or).$or
    expect(or[0]).toEqual({ name: { $ilike: '%50\\%\\_x%' } })
    expect(or).toHaveLength(3)
  })

  it('empty page: no lookups', async () => {
    const { service, em } = setup({ rows: [], total: 0 })
    expect(await service.list(SCOPE, query(), NOW)).toMatchObject({ items: [], total: 0, totalPages: 0 })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('shows cancelReason only on cancelled rows', async () => {
    const { service } = setup({ rows: [costRow({ sourcingStatus: 'cancelled', cancelReason: 'quote_closed' }), costRow({ id: 'b', cancelReason: 'stale' })] })
    expect((await service.list(SCOPE, query({ status: 'all' }), NOW)).items.map((item) => item.cancelReason)).toEqual(['quote_closed', null])
  })
})

describe('detail', () => {
  it('returns the row expansion for a live quote', async () => {
    const { service, em } = setup({ rows: [costRow({ proposedAmount: '8888.0000', proposedAnswer: { unitAmount: '8888.00' } })] })
    const detail = await service.detail('cost-1', SCOPE, NOW)
    expect(em.findOne.mock.calls[0][1]).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null, id: 'cost-1' })
    expect(detail).toMatchObject({
      costId: 'cost-1', quoteNumber: 'Q-2026-1', lineConfiguration: { site: 'Berlin', bandwidth: 1000 }, note: 'secret note',
      requestHistory: [{ costRequestId: 'old', outcome: 'cancelled' }], hasAnswerPending: true,
      current: { valueStatus: 'estimated', valueOrigin: 'catalog', unitAmount: '7777.7700', currencyCode: 'EUR', supplierName: 'SecretSupplier', supplierQuoteRef: 'Q-9', validUntil: '2027-01-01' },
      proposedAnswer: { unitAmount: '8888.00' },
    })
  })

  it('null when the cost line is missing, foreign or on a deleted quote', async () => {
    const { service } = setup({ rows: [] })
    expect(await service.detail('missing', SCOPE, NOW)).toBeNull()
  })
})
