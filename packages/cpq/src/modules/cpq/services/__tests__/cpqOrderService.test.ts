import { DefaultCpqOrderService, OrderError } from '../cpqOrderService'
import type { TenantScope } from '../types'

interface MockEm {
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
  createAsset: jest.MockedFunction<(input: unknown, scope: unknown) => Promise<unknown>>
}

interface MockNumberGenerator {
  generate: jest.MockedFunction<(input: unknown) => Promise<{ number: string }>>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
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

    expect(inventoryService.createSubscription).not.toHaveBeenCalled()
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
