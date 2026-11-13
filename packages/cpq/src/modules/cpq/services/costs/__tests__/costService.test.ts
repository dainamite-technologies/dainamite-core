import { COST_PLUS_PRICING_AVAILABLE, CpqCostService } from '../costService'

function service(enabled: boolean) {
  return new CpqCostService({ em: {} as never, featureTogglesService: { getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: enabled }) } })
}

describe('CpqCostService.assertCostPlusChargeWritable', () => {
  it('refuses with 422 COST_PLUS_DISABLED when the tenant toggle is off', async () => {
    await expect(service(false).assertCostPlusChargeWritable('tenant')).rejects.toMatchObject({ status: 422, message: 'COST_PLUS_DISABLED' })
  })

  it('refuses with 422 COST_PLUS_NOT_AVAILABLE until the engine can price cost-plus charges', async () => {
    expect(COST_PLUS_PRICING_AVAILABLE).toBe(false)
    await expect(service(true).assertCostPlusChargeWritable('tenant')).rejects.toMatchObject({ status: 422, message: 'COST_PLUS_NOT_AVAILABLE' })
  })
})

// ─── Cost elements ─────────────────────────────────────────────────

import { LockMode } from '@mikro-orm/core'
import { CpqChargeCostElement, CpqPricingTable, CpqProductCharge } from '../../../data/entities'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const chargeId = '11111111-1111-4111-8111-111111111111'
const elementId = '33333333-3333-4333-8333-333333333333'
const tableId = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
/** Mock EM over in-memory rows, keyed by entity class; `fork` / `transactional` reuse it. */
function store(rows: { charges?: Row[]; elements?: Row[]; tables?: Row[] }) {
  const byEntity = new Map<unknown, Row[]>([
    [CpqProductCharge, rows.charges ?? []], [CpqChargeCostElement, rows.elements ?? []], [CpqPricingTable, rows.tables ?? []],
  ])
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== (value as { $ne: unknown }).$ne
    if (value && typeof value === 'object' && '$in' in value) return (value as { $in: unknown[] }).$in.includes(row[key])
    return (row[key] ?? null) === value
  })
  const em: Record<string, jest.Mock> = {
    fork: jest.fn((): unknown => em),
    transactional: jest.fn(async (cb: (tx: unknown) => unknown) => cb(em)),
    findOne: jest.fn(async (entity: unknown, where: Row) => byEntity.get(entity)!.find((row) => matches(row, where)) ?? null),
    find: jest.fn(async (entity: unknown, where: Row) => byEntity.get(entity)!.filter((row) => matches(row, where))),
    findAndCount: jest.fn(async (entity: unknown, where: Row) => {
      const found = byEntity.get(entity)!.filter((row) => matches(row, where))
      return [found, found.length]
    }),
    count: jest.fn(async (entity: unknown, where: Row) => byEntity.get(entity)!.filter((row) => matches(row, where)).length),
    create: jest.fn((entity: unknown, data: Row) => ({ id: elementId, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null, ...data })),
    persist: jest.fn((row: Row) => { byEntity.get(CpqChargeCostElement)!.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  return em
}
const costService = (em: unknown) => new CpqCostService({ em: em as never, featureTogglesService: { getBoolConfig: jest.fn() } })
const charge = (overrides: Row = {}) => ({ id: chargeId, ...SCOPE, deletedAt: null, productId: 'product-1', offeringId: 'offering-1', pricingMethod: 'cost_plus', chargeType: 'mrc', quantityAttributeCode: null, isActive: true, ...overrides })
const element = (overrides: Row = {}) => ({ id: elementId, ...SCOPE, deletedAt: null, productChargeId: chargeId, code: 'tail', name: 'Tail',
  role: 'price_basis', costType: 'mrc', source: 'on_request', costModel: 'flat', amount: null, currencyCode: null, costTableId: null,
  costColumnKey: null, estimateAmount: null, isActive: true, sortOrder: 0, ...overrides })
const input = { productChargeId: chargeId, code: 'tail', name: 'Tail', role: 'price_basis' as const, costType: 'mrc' as const, source: 'on_request' as const, costModel: 'flat' as const }

describe('CpqCostService.createElement', () => {
  it('creates an on_request element under a charge lock, defaulting requiresSourcing to true', async () => {
    const em = store({ charges: [charge()] })
    const item = await costService(em).createElement({ ...input, estimateAmount: 300, currencyCode: 'EUR' }, SCOPE)
    expect(item).toMatchObject({ code: 'tail', role: 'price_basis', estimateAmount: '300', requiresSourcing: true, isActive: true })
    expect(em.findOne).toHaveBeenCalledWith(CpqProductCharge, expect.objectContaining({ id: chargeId, ...SCOPE, deletedAt: null }), { lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(em.create).toHaveBeenCalledWith(CpqChargeCostElement, expect.objectContaining({ ...SCOPE, productChargeId: chargeId }))
    expect(em.flush).toHaveBeenCalled()
  })

  it('returns 404 for a charge outside the scope', async () => {
    const em = store({ charges: [charge({ tenantId: 'other' })] })
    await expect(costService(em).createElement(input, SCOPE)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a price-basis element on a fixed charge (PRICE_BASIS_REQUIRES_COST_PLUS)', async () => {
    const em = store({ charges: [charge({ pricingMethod: 'fixed' })] })
    await expect(costService(em).createElement(input, SCOPE)).rejects.toMatchObject({ status: 422, message: 'PRICE_BASIS_REQUIRES_COST_PLUS' })
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('refuses a table element referencing a price table (WRONG_TABLE_PURPOSE)', async () => {
    const em = store({ charges: [charge()], tables: [{ id: tableId, ...SCOPE, deletedAt: null, purpose: 'price', priceColumns: [{ key: 'mrc' }] }] })
    await expect(costService(em).createElement({ ...input, source: 'table', costTableId: tableId, costColumnKey: 'mrc' }, SCOPE))
      .rejects.toMatchObject({ status: 422, message: 'WRONG_TABLE_PURPOSE' })
  })

  it('accepts a table element on a scoped cost table', async () => {
    const em = store({ charges: [charge()], tables: [{ id: tableId, ...SCOPE, deletedAt: null, purpose: 'cost', priceColumns: [{ key: 'mrc' }] }] })
    const item = await costService(em).createElement({ ...input, source: 'table', costTableId: tableId, costColumnKey: 'mrc' }, SCOPE)
    expect(item).toMatchObject({ source: 'table', requiresSourcing: false })
  })

  it('refuses a duplicate code among non-deleted elements (DUPLICATE_CODE)', async () => {
    const em = store({ charges: [charge()], elements: [element()] })
    await expect(costService(em).createElement(input, SCOPE)).rejects.toMatchObject({ status: 422, message: 'DUPLICATE_CODE' })
  })

  it('refuses a code already used by another charge of the same offering (one quote line, I-1)', async () => {
    const sibling = charge({ id: 'sibling-charge', pricingMethod: 'fixed' })
    const em = store({ charges: [charge(), sibling], elements: [element({ id: 'other', productChargeId: 'sibling-charge', role: 'margin_only' })] })
    await expect(costService(em).createElement(input, SCOPE)).rejects.toMatchObject({ status: 422, message: 'DUPLICATE_CODE' })
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('allows the same code on a charge of another offering', async () => {
    const elsewhere = charge({ id: 'elsewhere-charge', offeringId: 'offering-2' })
    const em = store({ charges: [charge(), elsewhere], elements: [element({ id: 'other', productChargeId: 'elsewhere-charge' })] })
    await expect(costService(em).createElement(input, SCOPE)).resolves.toMatchObject({ code: 'tail' })
  })

  it('checks every charge of the product for a product-level charge', async () => {
    const productCharge = charge({ offeringId: null })
    const offeringCharge = charge({ id: 'offering-charge', offeringId: 'offering-9' })
    const em = store({ charges: [productCharge, offeringCharge], elements: [element({ id: 'other', productChargeId: 'offering-charge' })] })
    await expect(costService(em).createElement(input, SCOPE)).rejects.toMatchObject({ status: 422, message: 'DUPLICATE_CODE' })
  })

  it('reuses a code once the earlier element was deleted', async () => {
    const em = store({ charges: [charge()], elements: [element({ deletedAt: new Date() })] })
    await expect(costService(em).createElement(input, SCOPE)).resolves.toMatchObject({ code: 'tail' })
  })

  it('refuses the index source until the index feature ships', async () => {
    const em = store({ charges: [charge()] })
    await expect(costService(em).createElement({ ...input, source: 'index' }, SCOPE)).rejects.toMatchObject({ status: 422, message: 'SOURCE_NOT_AVAILABLE' })
  })
})

describe('CpqCostService last price-basis rule (NO_PRICE_BASIS_ELEMENT)', () => {
  it('refuses deactivating the only active price-basis element of an active cost-plus charge', async () => {
    const row = element()
    const em = store({ charges: [charge()], elements: [row] })
    await expect(costService(em).updateElement({ id: elementId, isActive: false }, SCOPE)).rejects.toMatchObject({ status: 422, message: 'NO_PRICE_BASIS_ELEMENT' })
    expect(row.isActive).toBe(true)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('refuses deleting it, and turning it margin-only', async () => {
    const row = element()
    const em = store({ charges: [charge()], elements: [row] })
    await expect(costService(em).deleteElement(elementId, SCOPE)).rejects.toMatchObject({ message: 'NO_PRICE_BASIS_ELEMENT' })
    await expect(costService(em).updateElement({ id: elementId, role: 'margin_only' }, SCOPE)).rejects.toMatchObject({ message: 'NO_PRICE_BASIS_ELEMENT' })
    expect(row.deletedAt).toBeNull()
  })

  it('allows it when another active price-basis element remains', async () => {
    const row = element()
    const em = store({ charges: [charge()], elements: [row, element({ id: 'other', code: 'router' })] })
    await costService(em).deleteElement(elementId, SCOPE)
    expect(row.deletedAt).toBeInstanceOf(Date)
  })

  it('allows it on an inactive cost-plus charge', async () => {
    const row = element()
    const em = store({ charges: [charge({ isActive: false })], elements: [row] })
    await expect(costService(em).updateElement({ id: elementId, isActive: false }, SCOPE)).resolves.toMatchObject({ isActive: false })
  })

  it('assertCostPlusChargeHasPriceBasis refuses activating a cost-plus charge without elements', async () => {
    const em = store({ charges: [charge()], elements: [element({ isActive: false })] })
    const service = costService(em)
    await expect(service.assertCostPlusChargeHasPriceBasis(em as never, { id: chargeId, pricingMethod: 'cost_plus', isActive: true }, SCOPE))
      .rejects.toMatchObject({ status: 422, message: 'NO_PRICE_BASIS_ELEMENT' })
    await expect(service.assertCostPlusChargeHasPriceBasis(em as never, { pricingMethod: 'cost_plus', isActive: true }, SCOPE))
      .rejects.toMatchObject({ message: 'NO_PRICE_BASIS_ELEMENT' })
    await expect(service.assertCostPlusChargeHasPriceBasis(em as never, { pricingMethod: 'cost_plus', isActive: false }, SCOPE)).resolves.toBeUndefined()
    await expect(service.assertCostPlusChargeHasPriceBasis(em as never, { id: chargeId, pricingMethod: 'fixed', isActive: true }, SCOPE)).resolves.toBeUndefined()
  })
})

describe('CpqCostService.updateElement', () => {
  it('updates amounts as numeric strings and keeps the code', async () => {
    const row = element({ role: 'margin_only', source: 'fixed', amount: '10', currencyCode: 'EUR' })
    const em = store({ charges: [charge({ pricingMethod: 'fixed' })], elements: [row] })
    const item = await costService(em).updateElement({ id: elementId, amount: 12.5, name: 'Router' }, SCOPE)
    expect(item).toMatchObject({ amount: '12.5', name: 'Router', code: 'tail' })
  })

  it('validates the merged shape (fixed without amount)', async () => {
    const row = element({ role: 'margin_only', source: 'fixed', amount: '10', currencyCode: 'EUR' })
    const em = store({ charges: [charge({ pricingMethod: 'fixed' })], elements: [row] })
    await expect(costService(em).updateElement({ id: elementId, amount: null }, SCOPE)).rejects.toMatchObject({ status: 422, message: 'AMOUNT_REQUIRED' })
  })

  it('keeps a deactivated price-basis element editable after its charge left cost-plus, and refuses reactivating it', async () => {
    const row = element({ isActive: false })
    const em = store({ charges: [charge({ pricingMethod: 'fixed' })], elements: [row] })
    await expect(costService(em).updateElement({ id: elementId, name: 'Renamed' }, SCOPE)).resolves.toMatchObject({ name: 'Renamed' })
    await expect(costService(em).updateElement({ id: elementId, isActive: true }, SCOPE)).rejects.toMatchObject({ message: 'PRICE_BASIS_REQUIRES_COST_PLUS' })
  })

  it('returns 404 for a missing element', async () => {
    const em = store({ charges: [charge()] })
    await expect(costService(em).updateElement({ id: elementId, name: 'x' }, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
})

describe('CpqCostService charge-side helpers', () => {
  it('lists scoped, non-deleted elements with pagination metadata', async () => {
    const em = store({ elements: [element(), element({ id: 'gone', deletedAt: new Date() }), element({ id: 'foreign', tenantId: 'x' })] })
    const result = await costService(em).listElements(chargeId, SCOPE, 1, 50)
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 50, totalPages: 1 })
    expect(result.items[0].id).toBe(elementId)
  })

  it('deactivates price-basis elements and soft-deletes all elements of a charge', async () => {
    const pb = element(), margin = element({ id: 'm', code: 'm', role: 'margin_only' })
    const em = store({ elements: [pb, margin] })
    await expect(costService(em).deactivatePriceBasisElements(em as never, chargeId, SCOPE)).resolves.toBe(1)
    expect([pb.isActive, margin.isActive]).toEqual([false, true])
    await costService(em).deleteChargeElements(em as never, chargeId, SCOPE)
    expect(pb.deletedAt).toBeInstanceOf(Date)
    expect(margin.deletedAt).toBeInstanceOf(Date)
  })
})
