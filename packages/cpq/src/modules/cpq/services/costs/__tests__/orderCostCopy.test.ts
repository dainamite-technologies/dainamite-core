import { CpqOrderLineCost, CpqQuoteLineCost } from '../../../data/entities'
import { copyQuoteCostsToOrder } from '../orderCostCopy'
import { costLineTotal } from '../quoteMargin'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
type Row = Record<string, any>

const quoteCost = (over: Row = {}): Row => ({
  id: 'qc-1', quoteLineId: 'ql-1', costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1', name: 'Tail', role: 'price_basis',
  costType: 'mrc', source: 'table', costModel: 'per_unit', valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '45.0000', instanceAmount: '90.0000',
  currencyCode: 'EUR', fxRate: '1.10000000', fxRateDate: '2026-11-01', indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X',
  supplierQuoteRef: 'Q-77', validUntil: '2999-01-01', supplierTermEnd: '2028-01-01', supplierMinTermMonths: 12, note: 'n', deletedAt: null, ...over,
})

function setup(rows: Row[]) {
  const created: Row[] = []
  const em: Row = {
    find: jest.fn(async (entity: unknown, where: Row) => {
      expect(entity).toBe(CpqQuoteLineCost)
      // tenant scoping + soft-delete filter are part of the contract
      expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant', deletedAt: null, quoteConfigurationId: 'q-1' })
      return rows.filter((row) => !row.deletedAt)
    }),
    create: jest.fn((entity: unknown, data: Row) => { expect(entity).toBe(CpqOrderLineCost); created.push(data); return data }),
    persist: jest.fn(),
  }
  return { em, created }
}

const run = (em: Row, lines = new Map([['ql-1', 'ol-1']]), quantities = new Map([['ql-1', 2]])) =>
  copyQuoteCostsToOrder(em as never, { id: 'q-1' }, 'oc-1', lines, quantities, SCOPE)

describe('copyQuoteCostsToOrder', () => {
  it('copies every value, FX / index / supplier / validity column and links the source cost line', async () => {
    const { em, created } = setup([quoteCost()])
    await run(em)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      organizationId: 'org', tenantId: 'tenant', orderConfigurationId: 'oc-1', orderLineId: 'ol-1', sourceQuoteLineCostId: 'qc-1',
      costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table',
      costModel: 'per_unit', valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '45.0000', instanceAmount: '90.0000', currencyCode: 'EUR',
      fxRate: '1.10000000', fxRateDate: '2026-11-01', indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X',
      supplierQuoteRef: 'Q-77', validUntil: '2999-01-01', supplierTermEnd: '2028-01-01', supplierMinTermMonths: 12, note: 'n',
    })
    expect(created[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(em.persist).toHaveBeenCalledTimes(1)
  })

  it('takes total_amount from the margin rule: instance amount x line quantity, null while the cost is unknown', async () => {
    const { em, created } = setup([
      quoteCost(),
      quoteCost({ id: 'qc-2', costKey: 'install', costType: 'nrc', role: 'margin_only', instanceAmount: '1500.5000' }),
      quoteCost({ id: 'qc-3', costKey: 'pending', valueStatus: 'none', unitAmount: null, instanceAmount: null }),
    ])
    await run(em)
    expect(created.map((row) => [row.costKey, row.totalAmount])).toEqual([['install', '3001'], ['pending', null], ['tail', '180']]) // loader order: by cost key
    expect(costLineTotal({ valueStatus: 'confirmed', instanceAmount: '90.0000' }, 2)).toBe(180)
    expect(costLineTotal({ valueStatus: 'none', instanceAmount: '90' }, 2)).toBeNull()
  })

  it('copies a cost with value_status none as-is (null amounts)', async () => {
    const { em, created } = setup([quoteCost({ valueStatus: 'none', unitAmount: null, instanceAmount: null, role: 'margin_only' })])
    await run(em)
    expect(created[0]).toMatchObject({ valueStatus: 'none', unitAmount: null, instanceAmount: null, totalAmount: null })
  })

  it('skips deleted cost lines (not loaded) and cost lines whose quote line has no order line', async () => {
    const { em, created } = setup([quoteCost({ id: 'gone', deletedAt: new Date() }), quoteCost({ id: 'orphan', quoteLineId: 'ql-deleted' }), quoteCost({ id: 'kept' })])
    await run(em)
    expect(created.map((row) => row.sourceQuoteLineCostId)).toEqual(['kept'])
  })

  it('reads the quote costs with one query however many lines there are', async () => {
    const { em } = setup([quoteCost(), quoteCost({ id: 'qc-2', quoteLineId: 'ql-2', costKey: 'x' })])
    await run(em, new Map([['ql-1', 'ol-1'], ['ql-2', 'ol-2']]), new Map([['ql-1', 1], ['ql-2', 1]]))
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('returns nothing and persists nothing for a quote without cost lines', async () => {
    const { em, created } = setup([])
    expect(await run(em)).toEqual([])
    expect(created).toEqual([])
    expect(em.persist).not.toHaveBeenCalled()
  })
})
