import { CpqOrderLineConfiguration, CpqOrderLineCost } from '../../data/entities'
import { DefaultCpqOrderService, OrderError } from '../cpqOrderService'
import * as eventsModule from '../../events'
import type { TenantScope } from '../types'
import { ACTIVATION_SCOPE, createActivationHarness } from './_helpers/activationHarness'

interface MockEm {
  fork: jest.MockedFunction<() => MockEm>
  transactional: jest.MockedFunction<(callback: (em: MockEm) => Promise<unknown>) => Promise<unknown>>
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
  findAndCount: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<[unknown[], number]>
  >
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  persist: jest.MockedFunction<(entity: unknown) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
}

interface MockInventoryService {
  createSubscription: jest.MockedFunction<(input: unknown, scope: unknown) => Promise<unknown>>
  createSubscriptionWithCosts: jest.MockedFunction<(input: unknown, scope: unknown) => Promise<unknown>>
  createAsset: jest.MockedFunction<(input: unknown, scope: unknown) => Promise<unknown>>
}

interface MockNumberGenerator {
  generate: jest.MockedFunction<(input: unknown) => Promise<{ number: string }>>
}

function createMockEm(): MockEm {
  const em: MockEm = {
    fork: jest.fn(),
    transactional: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn(),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation((callback) => callback(em))
  return em
}

function createService(): {
  em: MockEm
  inventoryService: MockInventoryService
  numberGenerator: MockNumberGenerator
  service: DefaultCpqOrderService
} {
  const em = createMockEm()
  const inventoryService: MockInventoryService = {
    createSubscription: jest.fn(),
    createSubscriptionWithCosts: jest.fn(),
    createAsset: jest.fn(),
  }
  const numberGenerator: MockNumberGenerator = {
    generate: jest.fn().mockResolvedValue({ number: 'ORD-0001' }),
  }
  const service = new DefaultCpqOrderService({
    em: em as unknown as never,
    cpqInventoryService: inventoryService as unknown as never,
    salesDocumentNumberGenerator: numberGenerator as unknown as never,
  })
  return { em, inventoryService, numberGenerator, service }
}

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

describe('OrderError', () => {
  it('carries status code and message', () => {
    const err = new OrderError(409, 'Cannot transition')
    expect(err.status).toBe(409)
    expect(err.message).toBe('Cannot transition')
    expect(err.name).toBe('OrderError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('DefaultCpqOrderService.convertQuoteToOrder — guard rails', () => {
  it('throws 404 when neither id nor quoteId match', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce(null) // first lookup by id
    em.findOne.mockResolvedValueOnce(null) // fallback by quoteId

    await expect(service.convertQuoteToOrder('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Quote not found',
    })
  })

  it('throws 409 when quote is in cancelled status', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({
      id: 'q1',
      cpqStatus: 'cancelled',
      pricingSummary: null,
      currencyCode: 'USD',
      customerId: 'cust',
    })

    await expect(service.convertQuoteToOrder('q1', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: "Cannot convert a quote in 'cancelled' status",
    })
  })

  it('throws 409 when quote is in rejected status', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({
      id: 'q1',
      cpqStatus: 'rejected',
      pricingSummary: null,
      currencyCode: 'USD',
      customerId: 'cust',
    })

    await expect(service.convertQuoteToOrder('q1', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 422 when quote has no line items', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({
      id: 'q1',
      cpqStatus: 'accepted',
      pricingSummary: null,
      currencyCode: 'USD',
      customerId: 'cust',
    })
    em.find.mockResolvedValueOnce([]) // no lines

    await expect(service.convertQuoteToOrder('q1', SCOPE)).rejects.toMatchObject({
      status: 422,
      message: 'Cannot convert a quote with no line items',
    })
  })

  it('throws 409 when quote has already been converted (existing CpqOrderConfiguration)', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'q1',
        cpqStatus: 'accepted',
        pricingSummary: null,
        currencyCode: 'USD',
        customerId: 'cust',
      })
      // The guard: there's already an order for this quote
      .mockResolvedValueOnce({
        id: 'existing-order-config',
        orderId: 'existing-sales-order-id',
      })

    await expect(service.convertQuoteToOrder('q1', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('existing-sales-order-id'),
    })
    // Conversion never proceeds past the guard — no `find` for quote lines.
    expect(em.find).not.toHaveBeenCalled()
  })

  it('falls back to lookup-by-quoteId when lookup-by-id misses', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce(null) // id miss
    em.findOne.mockResolvedValueOnce({
      id: 'q1',
      cpqStatus: 'cancelled', // we re-throw so we don't have to mock the full happy path
      pricingSummary: null,
      currencyCode: 'USD',
      customerId: 'cust',
    })

    await expect(service.convertQuoteToOrder('quote-number-1', SCOPE)).rejects.toMatchObject({
      status: 409,
    })

    // Two lookups: by id, then by quoteId
    expect(em.findOne).toHaveBeenCalledTimes(2)
    const [, secondWhere] = em.findOne.mock.calls[1]
    expect(secondWhere).toMatchObject({ quoteId: 'quote-number-1' })
  })
})

describe('DefaultCpqOrderService.transitionOrderStatus — state machine guard', () => {
  it('throws 409 when target is not in CPQ_ORDER_TRANSITIONS for current status', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'oc1',
        orderId: 'o1',
        cpqStatus: 'draft',
        pricingSummary: null,
      })
      .mockResolvedValueOnce({ id: 'o1', status: 'draft' })

    await expect(service.transitionOrderStatus('oc1', 'fulfilled', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: "Cannot transition from 'draft' to 'fulfilled'",
    })
  })

  it('throws 409 from a terminal status (cancelled has empty transitions)', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({ id: 'oc1', orderId: 'o1', cpqStatus: 'cancelled' })
      .mockResolvedValueOnce({ id: 'o1', status: 'cancelled' })

    await expect(service.transitionOrderStatus('oc1', 'active', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 409 from fulfilled (also terminal)', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({ id: 'oc1', orderId: 'o1', cpqStatus: 'fulfilled' })
      .mockResolvedValueOnce({ id: 'o1', status: 'fulfilled' })

    await expect(service.transitionOrderStatus('oc1', 'active', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('persists draft → cancelled and maps the sales-order status', async () => {
    const { em, service } = createService()
    const orderConfig: { id: string; orderId: string; cpqStatus: string; pricingSummary: null; customerId: string; currencyCode: string; sourceQuoteId: null; activatedAt: null; createdAt: Date } = {
      id: 'oc1',
      orderId: 'o1',
      cpqStatus: 'draft',
      pricingSummary: null,
      customerId: 'cust',
      currencyCode: 'USD',
      sourceQuoteId: null,
      activatedAt: null,
      createdAt: new Date(),
    }
    const salesOrder: { id: string; status: string; orderNumber: string } = { id: 'o1', status: 'draft', orderNumber: 'ORD-0001' }

    em.findOne
      .mockResolvedValueOnce(orderConfig)
      .mockResolvedValueOnce(salesOrder)
    em.find.mockResolvedValueOnce([]) // no lines

    const result = await service.transitionOrderStatus('oc1', 'cancelled', SCOPE)

    expect(orderConfig.cpqStatus).toBe('cancelled')
    expect(salesOrder.status).toBe('cancelled')
    expect(em.flush).toHaveBeenCalled()
    expect(result.cpqStatus).toBe('cancelled')
  })

  it('persists draft → pending_activation', async () => {
    const { em, service } = createService()
    const orderConfig = {
      id: 'oc1',
      orderId: 'o1',
      cpqStatus: 'draft',
      pricingSummary: null,
      customerId: 'cust',
      currencyCode: 'USD',
      sourceQuoteId: null,
      activatedAt: null,
      createdAt: new Date(),
    }
    const salesOrder = { id: 'o1', status: 'draft', orderNumber: 'ORD-0001' }
    em.findOne.mockResolvedValueOnce(orderConfig).mockResolvedValueOnce(salesOrder)
    em.find.mockResolvedValueOnce([])

    const result = await service.transitionOrderStatus('oc1', 'pending_activation', SCOPE)

    expect(orderConfig.cpqStatus).toBe('pending_activation')
    expect(salesOrder.status).toBe('pending') // mapped via CPQ_TO_SALES_ORDER_STATUS
    expect(result.cpqStatus).toBe('pending_activation')
  })

  it('persists active → fulfilled and maps the sales-order status', async () => {
    const { em, service } = createService()
    const orderConfig = {
      id: 'oc1',
      orderId: 'o1',
      cpqStatus: 'active',
      pricingSummary: null,
      customerId: 'cust',
      currencyCode: 'USD',
      sourceQuoteId: null,
      activatedAt: new Date(),
      createdAt: new Date(),
    }
    const salesOrder = { id: 'o1', status: 'active', orderNumber: 'ORD-0001' }
    em.findOne.mockResolvedValueOnce(orderConfig).mockResolvedValueOnce(salesOrder)
    em.find.mockResolvedValueOnce([])

    const result = await service.transitionOrderStatus('oc1', 'fulfilled', SCOPE)

    expect(orderConfig.cpqStatus).toBe('fulfilled')
    expect(salesOrder.status).toBe('fulfilled')
    expect(result.cpqStatus).toBe('fulfilled')
  })

  it('throws 404 when order config lookup fails (both id and orderId)', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await expect(service.transitionOrderStatus('missing', 'cancelled', SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Order not found',
    })
  })
})

describe('DefaultCpqOrderService.activateOrder — guard rails', () => {
  it('throws 409 when current status is not draft or pending_activation', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({
      id: 'oc1',
      orderId: 'o1',
      cpqStatus: 'active',
    })

    await expect(service.activateOrder('oc1', SCOPE)).rejects.toMatchObject({
      status: 409,
      message: "Cannot activate order in 'active' status",
    })
  })

  it('throws 409 from cancelled', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({
      id: 'oc1',
      orderId: 'o1',
      cpqStatus: 'cancelled',
    })

    await expect(service.activateOrder('oc1', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('skips inventory creation when there are no eligible lines', async () => {
    const { em, inventoryService, service } = createService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'oc1',
        orderId: 'o1',
        cpqStatus: 'draft',
        pricingSummary: { nrcTotal: 0, mrcTotal: 0, currencyCode: 'USD' },
        customerId: 'cust',
        currencyCode: 'USD',
        sourceQuoteId: null,
        activatedAt: null,
        createdAt: new Date(),
      })
      .mockResolvedValueOnce({ id: 'o1', status: 'draft', orderNumber: 'ORD-1' })
    em.find.mockResolvedValueOnce([]) // no order lines (twice — initial + after activate)
    em.find.mockResolvedValueOnce([])

    const result = await service.activateOrder('oc1', SCOPE)

    expect(inventoryService.createSubscriptionWithCosts).not.toHaveBeenCalled()
    expect(inventoryService.createAsset).not.toHaveBeenCalled()
    expect(result.cpqStatus).toBe('active')
  })
})

describe('DefaultCpqOrderService.listOrders', () => {
  it('clamps pageSize to [1, 100]', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ pageSize: 500 }, SCOPE)
    const [, , options] = em.findAndCount.mock.calls[0]
    expect(options).toMatchObject({ limit: 100 })
  })

  it('clamps page to >= 1', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    const result = await service.listOrders({ page: -5 }, SCOPE)
    expect(result.page).toBe(1)
    const [, , options] = em.findAndCount.mock.calls[0]
    expect(options).toMatchObject({ offset: 0 })
  })

  it('uses default page=1 and pageSize=50 when not specified', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    const result = await service.listOrders({}, SCOPE)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
  })

  it('applies customerId filter', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ customerId: 'cust-1' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ customerId: 'cust-1' })
  })

  it('applies sourceQuoteId filter', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ sourceQuoteId: 'q-1' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ sourceQuoteId: 'q-1' })
  })

  it('maps salesOrderId filter to the orderId column on CpqOrderConfiguration', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ salesOrderId: 'sales-1' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ orderId: 'sales-1' })
  })

  it('passes a single cpqStatus as a scalar', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ cpqStatus: 'active' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ cpqStatus: 'active' })
  })

  it('translates an array cpqStatus into a $in filter', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listOrders({ cpqStatus: ['active', 'fulfilled'] }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ cpqStatus: { $in: ['active', 'fulfilled'] } })
  })

  it('looks up sales orders for the page and merges orderNumber into items', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([
      [
        { id: 'oc1', orderId: 'o1', cpqStatus: 'active' },
        { id: 'oc2', orderId: 'o2', cpqStatus: 'draft' },
      ],
      2,
    ])
    em.find.mockResolvedValueOnce([
      { id: 'o1', orderNumber: 'ORD-001' },
      { id: 'o2', orderNumber: 'ORD-002' },
    ])

    const result = await service.listOrders({}, SCOPE)
    expect(result.items[0]).toMatchObject({ orderNumber: 'ORD-001' })
    expect(result.items[1]).toMatchObject({ orderNumber: 'ORD-002' })
    expect(result.total).toBe(2)
    expect(result.totalPages).toBe(1)
  })

  it('returns null orderNumber when sales order is missing for a config', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([
      [{ id: 'oc1', orderId: 'o1', cpqStatus: 'active' }],
      1,
    ])
    em.find.mockResolvedValueOnce([]) // no sales orders matching

    const result = await service.listOrders({}, SCOPE)
    expect(result.items[0].orderNumber).toBeNull()
  })

  it('skips the sales-order lookup when no configs were returned', async () => {
    const { em, service } = createService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    const result = await service.listOrders({}, SCOPE)
    expect(em.find).not.toHaveBeenCalled()
    expect(result.items).toEqual([])
  })
})

describe('DefaultCpqOrderService.getOrder', () => {
  it('throws 404 when order config is not found', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await expect(service.getOrder('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Order not found',
    })
  })

  it('throws 404 when sales order is missing (orphan config)', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({ id: 'oc1', orderId: 'o-missing', cpqStatus: 'draft' })
      .mockResolvedValueOnce(null) // sales order missing

    await expect(service.getOrder('oc1', SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Sales order not found',
    })
  })

  it('builds an OrderResult and resolves offering names per line', async () => {
    const { em, service } = createService()
    const now = new Date('2026-04-01T00:00:00Z')
    em.findOne
      .mockResolvedValueOnce({
        id: 'oc1',
        orderId: 'o1',
        cpqStatus: 'active',
        customerId: 'cust',
        currencyCode: 'USD',
        sourceQuoteId: 'q1',
        pricingSummary: { nrcTotal: 100, mrcTotal: 50 },
        activatedAt: now,
        createdAt: now,
      })
      .mockResolvedValueOnce({ id: 'o1', orderNumber: 'ORD-0042' })
      // resolveOfferingInfo (called once per line):
      .mockResolvedValueOnce({ name: 'GIX Access Port', offeringType: 'simple' })

    em.find.mockResolvedValueOnce([
      {
        orderLineId: 'line-1',
        offeringId: 'off-1',
        productId: null,
        specId: 'spec-1',
        action: 'add',
        parentLineId: null,
        quantity: 2,
        configuration: { dc: 'eu' },
        startDate: null,
        termMonths: 12,
        endDate: null,
        nrcTotal: 100,
        mrcTotal: 50,
        charges: null,
        sourceQuoteLineId: 'ql-1',
      },
    ])

    const result = await service.getOrder('oc1', SCOPE)

    expect(result).toMatchObject({
      id: 'oc1',
      orderId: 'o1',
      orderNumber: 'ORD-0042',
      cpqStatus: 'active',
      customerId: 'cust',
      currencyCode: 'USD',
      pricingSummary: { nrcTotal: 100, mrcTotal: 50, currencyCode: 'USD' },
    })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      lineId: 'line-1',
      offeringId: 'off-1',
      offeringName: 'GIX Access Port',
      offeringType: 'simple',
      quantity: 2,
      termMonths: 12,
      nrcTotal: 100,
      mrcTotal: 50,
    })
  })

  it('falls back to "Configured Item" when offering is null on a line', async () => {
    const { em, service } = createService()
    em.findOne
      .mockResolvedValueOnce({
        id: 'oc1',
        orderId: 'o1',
        cpqStatus: 'draft',
        customerId: 'cust',
        currencyCode: 'USD',
        sourceQuoteId: null,
        pricingSummary: null,
        activatedAt: null,
        createdAt: new Date(),
      })
      .mockResolvedValueOnce({ id: 'o1', orderNumber: 'ORD-0001' })
    em.find.mockResolvedValueOnce([
      {
        orderLineId: 'line-1',
        offeringId: null,
        productId: null,
        specId: null,
        action: 'add',
        parentLineId: null,
        quantity: 1,
        configuration: {},
        startDate: null,
        termMonths: null,
        endDate: null,
        nrcTotal: 0,
        mrcTotal: 0,
        charges: null,
        sourceQuoteLineId: null,
      },
    ])

    const result = await service.getOrder('oc1', SCOPE)
    expect(result.lines[0].offeringName).toBe('Configured Item')
    expect(result.lines[0].offeringType).toBeNull()
  })
})


describe('conversion stored-adjustment baseline', () => {
  it.each([false, true])('converts valid stored offers and refuses invalid snapshots (invalid=%s)', async (invalid) => {
    const { em, service } = createService()
    const charges = [{ chargeCode: 'fee', chargeType: 'mrc', pricingMethod: 'flat', quantity: 1, unitPrice: 80, totalPrice: 80,
      listUnitPrice: 120, listTotalPrice: 120, standardUnitPrice: 100, standardTotalPrice: 100, currencyCode: 'USD',
      adjustmentErrors: invalid ? [{ adjustmentId: 'a', quoteLineId: 'line', code: 'ABOVE_STANDARD' }] : [] }]
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 80 } })
      .mockResolvedValueOnce(null) // no existing order
    em.find.mockResolvedValueOnce([{ quoteLineId: 'line', quantity: 1, action: 'add', nrcTotal: '0', mrcTotal: '80', charges,
      configuration: { _arcPriceFrozen: true, _arcRepriced: true }, offeringId: null }]).mockResolvedValueOnce([])
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date(), ...values }))
    if (invalid) {
      await expect(service.convertQuoteToOrder('quote', SCOPE)).rejects.toMatchObject({ status: 422, message: 'ADJUSTMENT_INVALID', details: { lineId: 'line', code: 'ABOVE_STANDARD' } })
      expect(em.create).not.toHaveBeenCalled()
      return
    }
    await service.convertQuoteToOrder('quote', SCOPE)
    expect(em.create).toHaveBeenCalledWith(CpqOrderLineConfiguration, expect.objectContaining({ charges, mrcTotal: '80' }))
    const orderLine = em.create.mock.calls.find(([entity]) => entity === CpqOrderLineConfiguration)?.[1]
    expect(orderLine?.configuration).not.toHaveProperty('_arcPriceFrozen')
    expect(orderLine?.configuration).not.toHaveProperty('_arcRepriced')
  })
})

describe('conversion output shape (characterization before cost-plus guard)', () => {
  it('pins the created sales order, order configuration and order line payloads', async () => {
    const { em, service } = createService()
    const charges = [{ chargeCode: 'fee', chargeType: 'mrc', pricingMethod: 'flat', quantity: 1, unitPrice: 80, totalPrice: 80,
      listUnitPrice: 120, listTotalPrice: 120, standardUnitPrice: 100, standardTotalPrice: 100, currencyCode: 'USD', adjustmentErrors: [] }]
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer',
      pricingSummary: { nrcTotal: 10, mrcTotal: 80 } }).mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([{ quoteLineId: 'line', quantity: 2, action: 'add', nrcTotal: '10', mrcTotal: '80', charges,
      configuration: { a: 1 }, offeringId: null, productId: 'prod', specId: null, startDate: null, endDate: null, termMonths: 12 }]).mockResolvedValueOnce([])
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date(), ...values }))
    await service.convertQuoteToOrder('quote', SCOPE)
    const created = (entityName: string) => em.create.mock.calls.find(([entity]) => (entity as { name: string }).name === entityName)?.[1]
    expect(created('SalesOrder')).toMatchObject({
      orderNumber: 'ORD-0001', customerEntityId: 'customer', currencyCode: 'USD', status: 'draft',
      subtotalNetAmount: '90', grandTotalNetAmount: '90', grandTotalGrossAmount: '90', lineItemCount: 1,
      discountTotalAmount: '0', taxTotalAmount: '0', metadata: { sourceQuoteId: 'quote' },
    })
    expect(created('CpqOrderConfiguration')).toMatchObject({
      sourceQuoteId: 'quote', customerId: 'customer', cpqStatus: 'draft', currencyCode: 'USD',
      pricingSummary: { nrcTotal: 10, mrcTotal: 80, currencyCode: 'USD' },
    })
    expect(created('SalesOrderLine')).toMatchObject({
      lineNumber: 1, kind: 'product', quantity: '2', unitPriceNet: '45', totalNetAmount: '90',
      configuration: { offeringId: null, action: 'add', nrcTotal: 10, mrcTotal: 80, parentLineId: null },
    })
    expect(created('CpqOrderLineConfiguration')).toMatchObject({
      action: 'add', quantity: 2, charges, nrcTotal: '10', mrcTotal: '80', sourceQuoteLineId: 'line', termMonths: 12,
      configuration: { a: 1, offeringName: expect.any(String) },
    })
  })

  it('checks status, then existing order, then lines, then stored adjustments (guard order)', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', cpqStatus: 'ready', currencyCode: 'USD', pricingSummary: {} })
      .mockResolvedValueOnce({ orderId: 'existing' })
    await expect(service.convertQuoteToOrder('quote', SCOPE)).rejects.toMatchObject({ status: 409, message: 'Quote has already been converted to order existing' })
    expect(em.find).not.toHaveBeenCalled()
  })
})


describe('conversion cost guard (COSTS_NOT_CONFIRMED)', () => {
  const charges = [{ chargeCode: 'fee', chargeType: 'mrc', pricingMethod: 'cost_plus', quantity: 1, unitPrice: 80, totalPrice: 80,
    listUnitPrice: 80, listTotalPrice: 80, standardUnitPrice: 80, standardTotalPrice: 80, currencyCode: 'USD', adjustmentErrors: [] }]
  const lines = () => [{ quoteLineId: 'line', quantity: 1, action: 'add', nrcTotal: '0', mrcTotal: '80', charges, configuration: {}, offeringId: null }]
  const cost = (over: Record<string, unknown>) => ({ quoteLineId: 'line', costKey: 'tail', role: 'price_basis', valueStatus: 'confirmed', validUntil: null, ...over })

  async function convert(costs: Array<Record<string, unknown>>) {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 80 } })
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce(lines() as never).mockResolvedValueOnce(costs as never)
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date(), ...values }))
    return { em, run: () => service.convertQuoteToOrder('quote', SCOPE) }
  }

  it('refuses an estimated price-basis cost and names the line and key, creating nothing', async () => {
    const { em, run } = await convert([cost({ valueStatus: 'estimated' }), cost({ costKey: 'ok' })])
    await expect(run()).rejects.toMatchObject({ status: 422, message: 'COSTS_NOT_CONFIRMED', details: { lines: [{ quoteLineId: 'line', costKeys: ['tail'] }] } })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('refuses an unpriced (none) price-basis cost and an expired confirmed one', async () => {
    const none = await convert([cost({ valueStatus: 'none' })])
    await expect(none.run()).rejects.toMatchObject({ message: 'COSTS_NOT_CONFIRMED' })
    const expired = await convert([cost({ validUntil: '2000-01-01' })])
    await expect(expired.run()).rejects.toMatchObject({ message: 'COSTS_NOT_CONFIRMED', details: { lines: [{ quoteLineId: 'line', costKeys: ['tail'] }] } })
  })

  it('converts when every price-basis cost is confirmed and valid, margin-only costs never block', async () => {
    const { em, run } = await convert([cost({ validUntil: '2999-01-01' }), cost({ costKey: 'overhead', role: 'margin_only', valueStatus: 'estimated' })])
    await run()
    expect(em.create).toHaveBeenCalledWith(CpqOrderLineConfiguration, expect.anything())
  })

  async function convertArc(quoteType: string, quoteLines: Array<Record<string, unknown>>, costs: Array<Record<string, unknown>>) {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', quoteType, currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 80 } })
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce(quoteLines as never).mockResolvedValueOnce(costs as never)
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date(), ...values }))
    return { em, run: () => service.convertQuoteToOrder('quote', SCOPE) }
  }
  const mirror = (over: Record<string, unknown> = {}) => ({ ...lines()[0], action: 'modify', offeringId: 'off', configuration: { _arcMirroredFromItemId: 'item-1' }, ...over })

  it('a Renew mirror line binds: its estimated price-basis cost blocks, once confirmed the quote converts', async () => {
    const estimated = await convertArc('renew', [mirror()], [cost({ valueStatus: 'estimated' })])
    await expect(estimated.run()).rejects.toMatchObject({ status: 422, message: 'COSTS_NOT_CONFIRMED', details: { lines: [{ quoteLineId: 'line', costKeys: ['tail'] }] } })
    const confirmed = await convertArc('renew', [mirror()], [cost({ valueStatus: 'confirmed' })])
    await confirmed.run()
    expect(confirmed.em.create).toHaveBeenCalledWith(CpqOrderLineConfiguration, expect.anything())
  })

  it.each([
    ['an item removed on Renew', 'renew'],
    ['an item removed on Amend', 'amend'],
    ['a Cancel-quote line', 'cancel'],
  ])('ignores the costs of %s (an ARC cancel line sells nothing)', async (_label, quoteType) => {
    const kept = mirror({ quoteLineId: 'kept' })
    const removed = mirror({ action: 'cancel', charges: [], mrcTotal: '0' })
    const { em, run } = await convertArc(quoteType, quoteType === 'cancel' ? [removed] : [kept, removed],
      [cost({ valueStatus: 'estimated' }), cost({ quoteLineId: 'kept' })])
    await run()
    expect(em.create).toHaveBeenCalledWith(CpqOrderLineConfiguration, expect.anything())
  })

  // R7 never relies on cost rows existing: a cost-plus charge stored without a price blocks by itself.
  const unpriced = { ...charges[0], unitPrice: null, totalPrice: null, listUnitPrice: null, listTotalPrice: null, standardUnitPrice: null, standardTotalPrice: null }
  it.each([
    ['the toggle is off (stored unpriced as COST_PLUS_DISABLED, no cost lines)', [] as Array<Record<string, unknown>>],
    ['no price-basis element is applicable (NO_PRICE_BASIS_COST)', [cost({ costKey: 'noc', role: 'margin_only', valueStatus: 'confirmed' })]],
    ['the line was added to a cost-locked quote (never got cost lines)', [] as Array<Record<string, unknown>>],
  ])('refuses an unpriced cost-plus charge when %s', async (_label, costs) => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 0 } })
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([{ ...lines()[0], mrcTotal: '0', charges: [unpriced, { ...charges[0], chargeCode: 'setup', pricingMethod: 'flat' }] }] as never)
      .mockResolvedValueOnce(costs as never)
    await expect(service.convertQuoteToOrder('quote', SCOPE)).rejects.toMatchObject({
      status: 422, message: 'COSTS_NOT_CONFIRMED', details: { lines: [{ quoteLineId: 'line', costKeys: [], chargeCodes: ['fee'] }] },
    })
    expect(em.create).not.toHaveBeenCalled()
  })

  it('merges unconfirmed cost keys and unpriced charge codes per line, sorted by line', async () => {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 80 } })
      .mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([
      { ...lines()[0], quoteLineId: 'line-b', charges: [unpriced] },
      { ...lines()[0], quoteLineId: 'line-a' },
    ] as never).mockResolvedValueOnce([cost({ quoteLineId: 'line-b', valueStatus: 'estimated' }), cost({ quoteLineId: 'line-a', costKey: 'xc', valueStatus: 'none' })] as never)
    await expect(service.convertQuoteToOrder('quote', SCOPE)).rejects.toMatchObject({
      details: { lines: [{ quoteLineId: 'line-a', costKeys: ['xc'], chargeCodes: [] }, { quoteLineId: 'line-b', costKeys: ['tail'], chargeCodes: ['fee'] }] },
    })
  })

  it('an unpriced cost-plus charge on an ARC cancel line does not block', async () => {
    const { em, run } = await convertArc('renew', [mirror({ quoteLineId: 'kept' }), mirror({ action: 'cancel', charges: [unpriced] })], [cost({ quoteLineId: 'kept' })])
    await run()
    expect(em.create).toHaveBeenCalledWith(CpqOrderLineConfiguration, expect.anything())
  })

  it('only reads price-basis lines of the quote (margin-only rows are filtered out in the query)', async () => {
    const { em, run } = await convert([])
    await run()
    expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quoteConfigurationId: 'quote', role: 'price_basis' }))
  })
})


describe('conversion output for a costed quote (characterization: cost lines never alter order lines)', () => {
  const charges = [{ chargeCode: 'fee', chargeType: 'mrc', pricingMethod: 'cost_plus', quantity: 1, unitPrice: 80, totalPrice: 80,
    listUnitPrice: 80, listTotalPrice: 80, standardUnitPrice: 80, standardTotalPrice: 80, currencyCode: 'USD', adjustmentErrors: [] }]
  const quoteLine = () => ({ quoteLineId: 'line', quantity: 2, action: 'add', nrcTotal: '10', mrcTotal: '80', charges, configuration: { a: 1 },
    offeringId: null, productId: 'prod', specId: null, startDate: null, endDate: null, termMonths: 12 })
  const cost = (over: Record<string, unknown>) => ({ quoteLineId: 'line', costKey: 'tail', role: 'price_basis', valueStatus: 'confirmed',
    validUntil: '2999-01-01', unitAmount: '50', instanceAmount: '100', ...over })

  async function convertWith(costs: Array<Record<string, unknown>>) {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer',
      pricingSummary: { nrcTotal: 10, mrcTotal: 80 } }).mockResolvedValueOnce(null)
    em.find.mockResolvedValueOnce([quoteLine()] as never).mockResolvedValueOnce(costs as never)
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date('2026-01-01T00:00:00.000Z'), ...values }))
    await service.convertQuoteToOrder('quote', SCOPE)
    // generated ids and timestamps differ per run; normalize them away
    const normalize = (value: unknown) => JSON.parse(JSON.stringify(value)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
      .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>')) as Array<Record<string, unknown>>
    const strip = (entity: { name: string }) => normalize(em.create.mock.calls
      .filter(([created]) => (created as { name: string }).name === entity.name)
      .map(([, values]) => values))
    return {
      em,
      salesOrderLines: strip({ name: 'SalesOrderLine' }),
      orderLineConfigs: strip(CpqOrderLineConfiguration),
      createdEntityNames: em.create.mock.calls.map(([created]) => (created as { name: string }).name),
    }
  }

  it('creates the same order and order lines with or without cost lines on the quote, and writes no cost entity', async () => {
    const plain = await convertWith([])
    const costed = await convertWith([cost({}), cost({ costKey: 'overhead', role: 'margin_only', valueStatus: 'estimated', validUntil: null })])
    expect(costed.salesOrderLines).toEqual(plain.salesOrderLines)
    expect(costed.orderLineConfigs).toEqual(plain.orderLineConfigs)
    expect(costed.createdEntityNames).toEqual(plain.createdEntityNames)
    expect(costed.createdEntityNames.filter((name) => /Cost/.test(name))).toEqual([])
    // the order line carries prices and charges only; no cost keys leak into it
    expect(JSON.stringify(costed.orderLineConfigs)).not.toMatch(/instanceAmount|unitAmount|costKey|margin/i)
  })
})

describe('activateOrder transaction boundary', () => {
  const line = (over: Record<string, unknown>) => ({ orderConfigurationId: 'oc-1', quantity: 1, configuration: {}, charges: [], parentLineId: null,
    startDate: null, termMonths: null, offeringId: null, productId: null, specId: null, sourceQuoteLineId: null, nrcTotal: '0', mrcTotal: '0', ...over })
  const newSaleFixture = {
    quoteType: 'new' as const,
    orderLines: [
      line({ orderLineId: 'ol-1', mrcTotal: '100', nrcTotal: '10', configuration: { offeringName: 'Hosting' } }),
      line({ orderLineId: 'ol-2', specId: 'spec-asset', nrcTotal: '500', parentLineId: 'ol-1', configuration: { offeringName: 'Server' } }),
    ],
    specs: [{ id: 'spec-asset', isAssetizable: true }],
    subscriptionItems: [{ id: 'item-1' }],
  }

  // MODIFIED by step 5: new-sale assets are created INSIDE createSubscription (before its `created`
  // snapshot), so the old separate `createAsset` call and its flush are gone from the transaction.
  it('new sale: forks the request EM and runs createSubscription (assets inside), the parent-link flush and the status flush in ONE transaction, bound to the tx EM', async () => {
    const h = createActivationHarness(newSaleFixture)

    const result = await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)

    expect(h.trace).toEqual([
      'tx:begin',
      'inventory.withEntityManager(tx)',
      'createSubscription',
      'flush[order=draft]',
      'flush[order=active]',
      'tx:commit',
    ])
    expect(h.em.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
    expect(h.txEm.transactional).toHaveBeenCalledTimes(1)
    expect(h.inventory.createSubscriptionWithCosts).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [expect.objectContaining({ parentItemIndex: 0, purchasePrice: 500, name: 'Server' })],
      }), ACTIVATION_SCOPE,
    )
    expect(h.salesOrder.status).toBe('active')
    expect(result.cpqStatus).toBe('active')
    expect(h.store.committed).toEqual(['subscription', 'item', 'itemCost', 'assetAndCosts', 'changeLog', 'order:active'])
    // the request EM was never read or written
    expect(h.em.find).not.toHaveBeenCalled()
    expect(h.em.flush).not.toHaveBeenCalled()
  })

  it.each([
    ['amend', 'applyAmendment', { mergeAction: 'standalone' }],
    ['cancel', 'applyCancel', { mergeAction: 'standalone' }],
    ['renew', 'applyRenewal', { mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }],
  ] as const)('%s: the inventory primitive (bound to the tx EM) and the final flush run inside one transaction', async (quoteType, primitive, targetExtra) => {
    const changeLog = { effectiveAt: new Date('2026-06-01T00:00:00.000Z'), afterSnapshot: { items: [] }, lineChanges: [] }
    const result = { changeLog, subscription: { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01'), currentTermEnd: new Date('2028-01-01') } }
    const h = createActivationHarness({
      quoteType,
      targets: [{ subscriptionId: 'sub-1', ...targetExtra }],
      quoteLines: [],
      inventory: { [primitive]: result },
    })

    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)

    expect(h.trace).toEqual(['tx:begin', 'inventory.withEntityManager(tx)', primitive, 'flush[order=active]', 'tx:commit'])
    expect(h.em.fork).toHaveBeenCalled()
  })

  it('merge renew: applyMergeRenewal then the final flush, inside one transaction', async () => {
    const h = createActivationHarness({
      quoteType: 'renew',
      quoteOver: { arcMergeNewTermStart: '2027-01-01', arcMergeNewTermEnd: '2028-01-01', arcMergeNewTermMonths: 12 },
      targets: [{ subscriptionId: 'sub-a', mergeAction: 'absorb' }, { subscriptionId: 'sub-b', mergeAction: 'absorb' }],
      inventory: { applyMergeRenewal: { mergedSubscription: { id: 'sub-m', currentTermStart: new Date('2027-01-01') }, mergeResultChangeLog: {}, sourceChangeLogs: [] } },
    })
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(h.trace).toEqual(['tx:begin', 'inventory.withEntityManager(tx)', 'applyMergeRenewal', 'flush[order=active]', 'tx:commit'])
  })

  it.each([
    ['createSubscription throws after the subscription, items, assets, costs and change log were flushed', { failInventory: 'createSubscription' as const }],
    ['the final order-status flush throws', { failFinalFlush: true }],
  ])('rolls everything back when %s', async (_label, failure) => {
    const h = createActivationHarness({ ...newSaleFixture, ...failure })
    const emitSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(h.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow()

    expect(h.trace).toContain('tx:rollback')
    expect(h.trace).not.toContain('tx:commit')
    // no subscription, item, asset, item cost, change-log row or order status change persisted
    expect(h.store.committed).toEqual([])
    expect(h.store.committedOrderStatus).toBe('draft')
    // the request EM was never touched: no pending change sets, nothing managed
    expect(h.em.find).not.toHaveBeenCalled()
    expect(h.em.findOne).not.toHaveBeenCalled()
    expect(h.em.persist).not.toHaveBeenCalled()
    expect(h.em.flush).not.toHaveBeenCalled()
    expect(h.em.getUnitOfWork().getChangeSets()).toEqual([])
    expect(h.em.getUnitOfWork().getIdentityMap().size).toBe(0)
    emitSpy.mockRestore()
  })

  it('emits no event on rollback and one activated event after commit', async () => {
    const failed = createActivationHarness({ ...newSaleFixture, failInventory: 'createSubscription' as const })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await expect(failed.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow()
    expect(emitSpy).not.toHaveBeenCalled()

    const ok = createActivationHarness(newSaleFixture)
    await ok.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy.mock.calls[0][0]).toBe('cpq.subscription.activated')
    emitSpy.mockRestore()
  })

  it('a retry after a rolled-back activation creates exactly one subscription', async () => {
    const h = createActivationHarness({ ...newSaleFixture, failInventory: 'createSubscription' as const })
    jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await expect(h.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow()
    expect(h.store.committed).toEqual([])

    // the transient failure is gone: the retry activates once
    h.inventory.createSubscriptionWithCosts.mockImplementation(async () => {
      h.store.pending.push('subscription')
      return { subscription: { id: 'sub-1' }, assets: [], inventoryCostChanges: [], inventoryCostLinks: [] }
    })
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)

    expect(h.store.committed.filter((row) => row === 'subscription')).toHaveLength(1)
    expect(h.store.committedOrderStatus).toBe('active')
    jest.restoreAllMocks()
  })

  it('refuses to run inside an existing transaction (the isolated fork could not see its rows)', async () => {
    const h = createActivationHarness(newSaleFixture)
    h.em.isInTransaction.mockReturnValue(true)
    await expect(h.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow(/existing transaction/)
    expect(h.em.fork).not.toHaveBeenCalled()
  })
})

describe('conversion copies quote costs to order line costs (MODIFIED by step 4)', () => {
  const charges = [{ chargeCode: 'fee', chargeType: 'mrc', pricingMethod: 'cost_plus', quantity: 1, unitPrice: 80, totalPrice: 80,
    listUnitPrice: 80, listTotalPrice: 80, standardUnitPrice: 80, standardTotalPrice: 80, currencyCode: 'USD', adjustmentErrors: [] }]
  const quoteLine = (id: string, over: Record<string, unknown> = {}) => ({ quoteLineId: id, quantity: 2, action: 'add', nrcTotal: '10', mrcTotal: '80', charges,
    configuration: {}, offeringId: null, productId: 'prod', specId: null, startDate: null, endDate: null, termMonths: 12, ...over })
  const quoteCost = (over: Record<string, unknown>) => ({ id: 'qc-1', quoteLineId: 'line', costKey: 'tail', chargeCode: 'fee', origin: 'catalog', name: 'Tail', role: 'price_basis',
    costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', validUntil: '2999-01-01', unitAmount: '50', instanceAmount: '135', supplierName: 'Carrier X', ...over })

  async function convert(lines: Array<Record<string, unknown>>, costs: Array<Record<string, unknown>>) {
    const { em, service } = createService()
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'customer', pricingSummary: { nrcTotal: 10, mrcTotal: 80 } })
      .mockResolvedValueOnce(null)
    // finds in order: quote lines, guard (price-basis costs), copy (all quote costs)
    em.find.mockResolvedValueOnce(lines as never).mockResolvedValueOnce(costs.filter((row) => row.role === 'price_basis') as never).mockResolvedValueOnce(costs as never)
    em.create.mockImplementation((_entity, values: Record<string, unknown>) => ({ createdAt: new Date(), ...values }))
    return { em, run: () => service.convertQuoteToOrder('quote', SCOPE) }
  }
  const costCreates = (em: ReturnType<typeof createService>['em']) => em.create.mock.calls.filter(([entity]) => entity === CpqOrderLineCost).map(([, values]) => values)

  it('copies every cost line to an order line cost on the mapped order line, keeping keys and values and total_amount = instance x quantity', async () => {
    const { em, run } = await convert([quoteLine('line')], [
      quoteCost({}), quoteCost({ id: 'qc-2', costKey: 'install', role: 'margin_only', costType: 'nrc', instanceAmount: '1500', valueStatus: 'estimated', validUntil: null }),
    ])
    await run()
    const orderLineId = (em.create.mock.calls.find(([entity]) => entity === CpqOrderLineConfiguration)?.[1] as { orderLineId: string }).orderLineId
    const copies = costCreates(em)
    expect(copies).toHaveLength(2)
    // the copy reads the quote's costs ordered by cost key
    expect(copies[0]).toMatchObject({ orderLineId, sourceQuoteLineCostId: 'qc-2', costKey: 'install', totalAmount: '3000', valueStatus: 'estimated' })
    expect(copies[1]).toMatchObject({ orderLineId, sourceQuoteLineCostId: 'qc-1', costKey: 'tail', instanceAmount: '135', totalAmount: '270', supplierName: 'Carrier X', valueStatus: 'confirmed' })
    const config = em.create.mock.calls.find(([entity]) => (entity as { name: string }).name === 'CpqOrderConfiguration')?.[1] as { id: string }
    expect(copies.every((copy) => (copy as { orderConfigurationId: string }).orderConfigurationId === config.id)).toBe(true)
    // costs are persisted before the flush that commits the order lines (same transaction)
    expect(em.persist.mock.calls.filter(([row]) => (row as { sourceQuoteLineCostId?: string }).sourceQuoteLineCostId)).toHaveLength(2)
  })

  it('skips cost lines of a quote line that has no order line (deleted line)', async () => {
    const { em, run } = await convert([quoteLine('line')], [quoteCost({}), quoteCost({ id: 'qc-x', quoteLineId: 'deleted-line' })])
    await run()
    expect(costCreates(em).map((row) => (row as { sourceQuoteLineCostId: string }).sourceQuoteLineCostId)).toEqual(['qc-1'])
  })

  it('leaves the order and order line payloads identical to a conversion without costs', async () => {
    const plain = await convert([quoteLine('line')], [])
    await plain.run()
    const costed = await convert([quoteLine('line')], [quoteCost({})])
    await costed.run()
    const strip = (em: ReturnType<typeof createService>['em']) => JSON.stringify(em.create.mock.calls.filter(([entity]) => entity !== CpqOrderLineCost).map(([, v]) => v))
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>')
    expect(strip(costed.em)).toBe(strip(plain.em))
  })

  it('a guard failure writes nothing: no order, order line or order line cost is created', async () => {
    const { em, run } = await convert([quoteLine('line')], [quoteCost({ valueStatus: 'estimated' })])
    await expect(run()).rejects.toMatchObject({ status: 422, message: 'COSTS_NOT_CONFIRMED' })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('a copy failure aborts the conversion transaction before the order lines are committed', async () => {
    const { em, run } = await convert([quoteLine('line')], [quoteCost({})])
    em.create.mockImplementation((entity, values: Record<string, unknown>) => {
      if (entity === CpqOrderLineCost) throw new Error('copy failed')
      return { createdAt: new Date(), ...values }
    })
    await expect(run()).rejects.toThrow('copy failed')
    // only the pricing-revision phase flushed; the order lines were never flushed, so the transaction rolls back
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})

describe('activateOrder writes inventory costs from the order line costs (step 5)', () => {
  const line = (over: Record<string, unknown>) => ({ orderConfigurationId: 'oc-1', quantity: 1, configuration: {}, charges: [], parentLineId: null,
    startDate: null, termMonths: null, offeringId: null, productId: null, specId: null, sourceQuoteLineId: null, nrcTotal: '0', mrcTotal: '0', ...over })
  const olc = (id: string, orderLineId: string, costKey: string, over: Record<string, unknown> = {}) => ({ id, orderLineId, orderConfigurationId: 'oc-1', costKey, chargeCode: 'mrc',
    origin: 'catalog', costElementId: null, name: costKey, role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'catalog',
    unitAmount: '270', instanceAmount: '270', totalAmount: '270', currencyCode: 'EUR', fxRate: null, fxRateDate: null, indexSnapshot: null, supplierId: null,
    supplierName: null, supplierQuoteRef: null, validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null, inventoryCostId: null, ...over })
  const fixture = () => ({
    quoteType: 'new' as const,
    orderLines: [
      line({ orderLineId: 'ol-1', mrcTotal: '400', nrcTotal: '10', configuration: { offeringName: 'Hosting' } }),
      line({ orderLineId: 'ol-2', specId: 'spec-asset', nrcTotal: '5000', parentLineId: 'ol-1', configuration: { offeringName: 'Server' } }),
      line({ orderLineId: 'ol-3', mrcTotal: '50', configuration: { offeringName: 'Support' } }),
    ],
    specs: [{ id: 'spec-asset', isAssetizable: true }],
    subscriptionItems: [{ id: 'item-1' }, { id: 'item-2' }],
    orderLineCosts: [
      olc('olc-1', 'ol-1', 'tail'), olc('olc-2', 'ol-1', 'install', { costType: 'nrc', totalAmount: '1500' }),
      olc('olc-3', 'ol-2', 'hardware', { costType: 'nrc' }), olc('olc-4', 'ol-2', 'licence', { totalAmount: '40' }),
    ],
  })
  const sentInput = (h: ReturnType<typeof createActivationHarness>) => h.inventory.createSubscriptionWithCosts.mock.calls[0][0] as {
    items: Array<{ name: string; costs: Array<{ orderLineCostId: string; costKey: string }> }>
    assets: Array<{ name: string; parentItemIndex?: number; purchasePrice: number; costs: Array<{ orderLineCostId: string; costKey: string }> }>
  }

  it('builds item seeds from the item line costs and asset seeds from the assetizable line costs, loading order line costs in one query', async () => {
    const h = createActivationHarness(fixture())
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const input = sentInput(h)
    expect(input.items.map((i) => [i.name, i.costs.map((c) => c.costKey)])).toEqual([['Hosting', ['tail', 'install']], ['Support', []]])
    expect(input.items[0].costs[0]).toMatchObject({ orderLineCostId: 'olc-1', totalAmount: '270', costType: 'mrc', origin: 'catalog' })
    expect(input.assets).toHaveLength(1)
    expect(input.assets[0]).toMatchObject({ name: 'Server', parentItemIndex: 0, purchasePrice: 5000 })
    expect(input.assets[0].costs.map((c) => c.costKey)).toEqual(['hardware', 'licence'])
    const costQueries = (h.txEm.find.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>).filter(([entity]) => entity === CpqOrderLineCost)
    expect(costQueries).toHaveLength(1)
    expect(costQueries[0][1]).toMatchObject({ orderConfigurationId: 'oc-1', organizationId: ACTIVATION_SCOPE.organizationId, tenantId: ACTIVATION_SCOPE.tenantId, deletedAt: null })
  })

  it('links every order line cost to the inventory cost it set (item and asset costs), in the activation transaction', async () => {
    const f = fixture()
    const h = createActivationHarness({ ...f, createdCosts: { inventoryCostLinks: [
      { orderLineCostId: 'olc-1', inventoryCostId: 'ic-1' }, { orderLineCostId: 'olc-2', inventoryCostId: 'ic-2' },
      { orderLineCostId: 'olc-3', inventoryCostId: 'ic-3' }, { orderLineCostId: 'olc-4', inventoryCostId: 'ic-4' },
    ] } })
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(f.orderLineCosts.map((row) => row.inventoryCostId)).toEqual(['ic-1', 'ic-2', 'ic-3', 'ic-4'])
    // the links are set before the parent-link flush, inside the transaction
    expect(h.trace.indexOf('createSubscription')).toBeLessThan(h.trace.indexOf('flush[order=draft]'))
    expect(h.trace.at(-1)).toBe('tx:commit')
  })

  it('writes costs whatever the cpq.cost_plus toggle says: the order service has no toggle dependency and always seeds', async () => {
    // Only quote-side pricing is toggled (R14). The activation has no toggle lookup at all, so item costs are
    // identical for a tenant with the toggle off; there is no config / cost-service read on the transaction EM.
    const h = createActivationHarness(fixture())
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(sentInput(h).items[0].costs).toHaveLength(2)
    const readEntities = h.txEm.find.mock.calls.map(([entity]) => (entity as { name: string }).name)
    expect(readEntities.filter((name) => /Config(uration)?$/.test(name) && !/Order|Quote/.test(name))).toEqual([])
  })

  it('threads the real inventory cost changes out of the transaction result (their events are covered in the step 7 block)', async () => {
    const changes = [{ inventoryCostId: 'ic-1', subscriptionId: 'sub-1', ownerType: 'subscription_item', subscriptionItemId: 'item-1', assetId: null, costKey: 'tail', supplierId: null, kind: 'created' }]
    const h = createActivationHarness({ ...fixture(), createdCosts: { inventoryCostChanges: changes } })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const transactionResult = await h.txEm.transactional.mock.results[0].value as { inventoryCostChanges: unknown[] }
    expect(transactionResult.inventoryCostChanges).toEqual(changes)
    expect(emitSpy.mock.calls.map(([event]) => event)).toEqual(['cpq.subscription.activated', 'cpq.subscription.cost_changed'])
    emitSpy.mockRestore()
  })

  it('seeds nothing for a quote without costs and warns (never fails) about costs of an unknown order line', async () => {
    const plain = createActivationHarness({ ...fixture(), orderLineCosts: [] })
    await plain.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(sentInput(plain).items.every((item) => item.costs.length === 0)).toBe(true)
    expect(sentInput(plain).assets[0].costs).toEqual([])

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stale = createActivationHarness({ ...fixture(), orderLineCosts: [olc('olc-9', 'ol-gone', 'tail')] })
    await expect(stale.service.activateOrder('oc-1', ACTIVATION_SCOPE)).resolves.toMatchObject({ cpqStatus: 'active' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ol-gone'))
    expect(sentInput(stale).items.every((item) => item.costs.length === 0)).toBe(true)
    warn.mockRestore()
  })

  it('an activation that fails after the costs were written rolls the costs back with it', async () => {
    const h = createActivationHarness({ ...fixture(), failInventory: 'createSubscription' })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(h.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow()
    expect(h.store.committed).toEqual([])
    expect(h.store.committedOrderStatus).toBe('draft')
    jest.restoreAllMocks()
  })
})

describe('cpq.subscription.cost_changed (step 7)', () => {
  const line = (over: Record<string, unknown>) => ({ orderConfigurationId: 'oc-1', quantity: 1, configuration: {}, charges: [], parentLineId: null,
    startDate: null, termMonths: null, offeringId: null, productId: null, specId: null, sourceQuoteLineId: null, nrcTotal: '0', mrcTotal: '0', ...over })
  const base = {
    quoteType: 'new' as const,
    orderLines: [line({ orderLineId: 'ol-1', mrcTotal: '100', configuration: { offeringName: 'Hosting' } })],
    specs: [],
    subscriptionItems: [{ id: 'item-1' }],
  }
  const change = (over: Record<string, unknown>) => ({ inventoryCostId: 'ic-1', subscriptionId: 'sub-1', ownerType: 'subscription_item', subscriptionItemId: 'item-1',
    assetId: null, costKey: 'tail', supplierId: 'sup-1', kind: 'created', changeLogId: 'log-1', effectiveDate: '2026-11-14', ...over })
  const costEvents = (spy: jest.SpyInstance) => spy.mock.calls.filter(([id]) => id === 'cpq.subscription.cost_changed').map(([, payload]) => payload as Record<string, unknown>)

  afterEach(() => jest.restoreAllMocks())

  it('emits one event per real change after the commit, with ids and keys only (no amount keys)', async () => {
    const changes = [
      change({}),
      change({ inventoryCostId: 'ic-2', ownerType: 'asset', subscriptionItemId: null, assetId: 'asset-1', costKey: 'licence', supplierId: null, kind: 'changed' }),
    ]
    const h = createActivationHarness({ ...base, createdCosts: { inventoryCostChanges: changes } })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)

    const payloads = costEvents(emitSpy)
    expect(payloads).toHaveLength(2)
    // emitted after the activated event, i.e. after the commit
    expect(emitSpy.mock.calls[0][0]).toBe('cpq.subscription.activated')
    expect(payloads[0]).toEqual({
      organizationId: ACTIVATION_SCOPE.organizationId, tenantId: ACTIVATION_SCOPE.tenantId, subscriptionId: 'sub-1',
      ownerType: 'subscription_item', subscriptionItemId: 'item-1', assetId: null, inventoryCostId: 'ic-1', changeLogId: 'log-1',
      costKey: 'tail', effectiveDate: '2026-11-14', supplierId: 'sup-1', sourceOrderId: 'oc-1', cause: 'activation', kind: 'created',
    })
    expect(payloads[1]).toMatchObject({ ownerType: 'asset', subscriptionItemId: null, assetId: 'asset-1', kind: 'changed' })
    for (const payload of payloads) {
      expect(Object.keys(payload).filter((key) => /amount|cost$|price|total|margin|fx/i.test(key))).toEqual([])
    }
  })

  it('emits no cost_changed when no row really changed (no-op rows are not in the change list)', async () => {
    const h = createActivationHarness({ ...base, createdCosts: { inventoryCostChanges: [] } })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(costEvents(emitSpy)).toEqual([])
  })

  it('emits nothing on rollback, and a failing dispatch never fails the committed activation', async () => {
    const failed = createActivationHarness({ ...base, failInventory: 'createSubscription' as const, createdCosts: { inventoryCostChanges: [change({})] } })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await expect(failed.service.activateOrder('oc-1', ACTIVATION_SCOPE)).rejects.toThrow()
    expect(emitSpy).not.toHaveBeenCalled()

    const ok = createActivationHarness({ ...base, createdCosts: { inventoryCostChanges: [change({})] } })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    emitSpy.mockImplementation(async (id) => { if (id === 'cpq.subscription.cost_changed') throw new Error('bus down') })
    await expect(ok.service.activateOrder('oc-1', ACTIVATION_SCOPE)).resolves.toMatchObject({ cpqStatus: 'active' })
  })
})

describe('ARC write-back wiring in activateOrder (step 13)', () => {
  const olc = (id: string, orderLineId: string, costKey: string) => ({ id, orderLineId, orderConfigurationId: 'oc-1', costKey, name: costKey, role: 'price_basis',
    costType: 'one_off', source: 'supplier', costModel: 'fixed', valueStatus: 'known', origin: 'catalog', totalAmount: '300' })
  const orderLine = (orderLineId: string, sourceQuoteLineId: string) => ({ orderLineId, orderConfigurationId: 'oc-1', sourceQuoteLineId, quantity: 1,
    configuration: {}, charges: [], parentLineId: null, mrcTotal: '0', nrcTotal: '0' })
  const quoteLine = (quoteLineId: string, action: string, configuration: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    quoteLineId, action, configuration, targetSubscriptionId: 'sub-1', sourceSubscriptionItemId: `item-${quoteLineId}`, quantity: 1, charges: [],
    mrcTotal: '0', nrcTotal: '0', parentLineId: null, ...over })
  const costChange = (over: Record<string, unknown>) => ({ inventoryCostId: 'ic-1', subscriptionId: 'sub-1', ownerType: 'subscription_item', subscriptionItemId: 'item-1',
    assetId: null, costKey: 'tail', supplierId: null, kind: 'changed', changeLogId: 'log-1', effectiveDate: '2026-11-14', ...over })
  const subscription = { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01'), currentTermEnd: new Date('2028-01-01') }
  const arcResult = (inventoryCostChanges: unknown[]) => ({ changeLog: { effectiveAt: new Date('2026-06-01'), afterSnapshot: { items: [] }, lineChanges: [] }, subscription, inventoryCostChanges })
  const fixture = (quoteType: 'amend' | 'renew' | 'cancel', primitive: string, changes: unknown[]) => ({
    quoteType,
    targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }],
    orderLines: [orderLine('ol-re', 'ql-re'), orderLine('ol-plain', 'ql-plain'), orderLine('ol-add', 'ql-add')],
    orderLineCosts: [olc('c-re', 'ol-re', 'tail'), olc('c-plain', 'ol-plain', 'tail'), olc('c-add', 'ol-add', 'tail')],
    quoteLines: [
      quoteLine('ql-re', 'modify', { _arcMirroredFromItemId: 'i', _arcReconfigured: true }),
      quoteLine('ql-plain', 'modify', { _arcMirroredFromItemId: 'i', _arcPriceFrozen: true }),
      quoteLine('ql-add', 'add', {}, { sourceSubscriptionItemId: null }),
    ],
    inventory: { [primitive]: arcResult(changes) },
  })
  const costEvents = (spy: jest.SpyInstance) => spy.mock.calls.filter(([id]) => id === 'cpq.subscription.cost_changed').map(([, payload]) => payload as Record<string, unknown>)
  afterEach(() => jest.restoreAllMocks())

  it('seeds only the reconfigured mirror line (marker read from the source quote line) and add lines; plain mirrors carry no costSync', async () => {
    const h = createActivationHarness(fixture('amend', 'applyAmendment', []))
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const [input] = h.inventory.applyAmendment.mock.calls[0] as [{ lineChanges: Array<Record<string, unknown>> }]
    const [reconfigured, plain, added] = input.lineChanges as Array<{ costSync?: { mode: string; seeds: Array<{ orderLineCostId: string }> } }>
    expect(reconfigured.costSync?.mode).toBe('replace')
    expect(reconfigured.costSync?.seeds.map((seed) => seed.orderLineCostId)).toEqual(['c-re'])
    expect(plain.costSync).toBeUndefined()
    expect(added.costSync?.mode).toBe('create')
    expect(added.costSync?.seeds.map((seed) => seed.orderLineCostId)).toEqual(['c-add'])
  })

  it.each([
    ['amend', 'applyAmendment'],
    ['renew', 'applyRenewal'],
    ['cancel', 'applyCancel'],
  ] as const)('%s: one cost_changed per real change after the commit, with cause %s and the change kind', async (quoteType, primitive) => {
    const changes = [costChange({}), costChange({ inventoryCostId: 'ic-2', kind: quoteType === 'cancel' ? 'ended' : 'created', costKey: 'install' })]
    const h = createActivationHarness(fixture(quoteType, primitive, changes))
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const payloads = costEvents(emitSpy)
    expect(payloads.map((p) => [p.cause, p.kind, p.inventoryCostId, p.sourceOrderId, p.changeLogId])).toEqual([
      [quoteType, 'changed', 'ic-1', 'oc-1', 'log-1'],
      [quoteType, quoteType === 'cancel' ? 'ended' : 'created', 'ic-2', 'oc-1', 'log-1'],
    ])
    // emitted after the transaction committed
    expect(h.trace.at(-1)).toBe('tx:commit')
  })

  it('merge: re-pointed costs are emitted after the commit with cause merge and kind repointed', async () => {
    const changes = [costChange({ kind: 'repointed' }), costChange({ inventoryCostId: 'ic-2', kind: 'repointed', costKey: 'install' })]
    const h = createActivationHarness({
      quoteType: 'renew',
      quoteOver: { arcMergeNewTermStart: '2027-01-01', arcMergeNewTermEnd: '2028-01-01', arcMergeNewTermMonths: 12 },
      targets: [{ subscriptionId: 'sub-a', mergeAction: 'absorb' }, { subscriptionId: 'sub-b', mergeAction: 'absorb' }],
      inventory: { applyMergeRenewal: { mergedSubscription: { id: 'sub-m', currentTermStart: new Date('2027-01-01') }, mergeResultChangeLog: { id: 'log-m' }, sourceChangeLogs: [], inventoryCostChanges: changes } },
    })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(costEvents(emitSpy).map((p) => [p.cause, p.kind, p.inventoryCostId])).toEqual([['merge', 'repointed', 'ic-1'], ['merge', 'repointed', 'ic-2']])
    expect(h.trace.at(-1)).toBe('tx:commit')
  })

  describe('links order line costs to the inventory costs the ARC step created / updated (review1-a)', () => {
    const links = [{ orderLineCostId: 'c-re', inventoryCostId: 'ic-re' }, { orderLineCostId: 'c-add', inventoryCostId: 'ic-add' }]
    const withLinks = (primitive: string, quoteType: 'amend' | 'renew') => {
      const f = fixture(quoteType, primitive, [])
      f.inventory[primitive] = { ...f.inventory[primitive], inventoryCostLinks: links } as never
      return f
    }
    const linked = (f: ReturnType<typeof fixture>) => Object.fromEntries(f.orderLineCosts.map((row) => [row.id, (row as { inventoryCostId?: string }).inventoryCostId ?? null]))

    it.each([['amend', 'applyAmendment'], ['renew', 'applyRenewal']] as const)('%s: reconfigured mirror line (replace) and add line get inventory_cost_id; untouched lines stay unlinked', async (quoteType, primitive) => {
      const f = withLinks(primitive, quoteType)
      const h = createActivationHarness(f)
      await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
      expect(linked(f)).toEqual({ 'c-re': 'ic-re', 'c-plain': null, 'c-add': 'ic-add' })
    })

    it('merge renew: operator-edit costs on M are linked', async () => {
      const f = {
        quoteType: 'renew' as const,
        quoteOver: { arcMergeNewTermStart: '2027-01-01', arcMergeNewTermEnd: '2028-01-01', arcMergeNewTermMonths: 12 },
        targets: [{ subscriptionId: 'sub-a', mergeAction: 'absorb' }, { subscriptionId: 'sub-b', mergeAction: 'absorb' }],
        orderLines: [orderLine('ol-add', 'ql-add')],
        orderLineCosts: [olc('c-add', 'ol-add', 'tail')],
        quoteLines: [quoteLine('ql-add', 'add', {}, { sourceSubscriptionItemId: null, targetSubscriptionId: null })],
        inventory: { applyMergeRenewal: { mergedSubscription: { id: 'sub-m', currentTermStart: new Date('2027-01-01') }, mergeResultChangeLog: { id: 'log-m' }, sourceChangeLogs: [], inventoryCostChanges: [], inventoryCostLinks: [links[1]] } },
      }
      const h = createActivationHarness(f)
      await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
      expect(linked(f as never)).toEqual({ 'c-add': 'ic-add' })
    })
  })

  it('emits no cost_changed when the ARC step wrote nothing (frozen / no-op)', async () => {
    const h = createActivationHarness(fixture('renew', 'applyRenewal', []))
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    expect(costEvents(emitSpy)).toEqual([])
  })
})
