import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import {
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqOrderConfiguration,
  CpqOrderLineConfiguration,
  CpqProductOffering,
  CpqProductSpecification,
  CpqInventorySubscriptionItem,
} from '../data/entities'
import type { DefaultCpqInventoryService } from './cpqInventoryService'
import {
  CPQ_ORDER_TRANSITIONS,
  type CpqOrderStatus,
  type TenantScope,
} from './types'

// ─── Types ──────────────────────────────────────────────────────

interface OrderListFilters {
  customerId?: string
  sourceQuoteId?: string
  salesOrderId?: string
  cpqStatus?: string | string[]
  page?: number
  pageSize?: number
}

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface OrderLineResult {
  lineId: string
  offeringId: string | null
  offeringName: string
  offeringType: string | null
  productId: string | null
  specId: string | null
  action: string
  parentLineId: string | null
  quantity: number
  configuration: Record<string, unknown>
  startDate: string | null
  termMonths: number | null
  endDate: string | null
  nrcTotal: number
  mrcTotal: number
  charges: Array<Record<string, unknown>>
  sourceQuoteLineId: string | null
}

interface OrderResult {
  id: string
  orderId: string
  orderNumber: string
  customerId: string
  cpqStatus: string
  sourceQuoteId: string | null
  currencyCode: string
  pricingSummary: {
    nrcTotal: number
    mrcTotal: number
    currencyCode: string
  }
  activatedAt: string | null
  createdAt: string
  lines: OrderLineResult[]
}

interface OrderServiceDeps {
  em: EntityManager
  cpqInventoryService: DefaultCpqInventoryService
  salesDocumentNumberGenerator: SalesDocumentNumberGenerator
}

const CPQ_TO_SALES_ORDER_STATUS: Record<CpqOrderStatus, string> = {
  draft: 'draft',
  pending_activation: 'pending',
  active: 'active',
  cancelled: 'cancelled',
  fulfilled: 'fulfilled',
}

// ─── Service ────────────────────────────────────────────────────

export class DefaultCpqOrderService {
  private em: EntityManager
  private inventoryService: DefaultCpqInventoryService
  private numberGenerator: SalesDocumentNumberGenerator

  constructor(deps: OrderServiceDeps) {
    this.em = deps.em
    this.inventoryService = deps.cpqInventoryService
    this.numberGenerator = deps.salesDocumentNumberGenerator
  }

  // ─── Convert Quote to Order ─────────────────────────────────

  async convertQuoteToOrder(quoteId: string, scope: TenantScope): Promise<OrderResult> {
    const em = this.em

    const cpqConfig = await em.findOne(CpqQuoteConfiguration, {
      id: quoteId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!cpqConfig) {
      const byQuoteId = await em.findOne(CpqQuoteConfiguration, {
        quoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!byQuoteId) throw new OrderError(404, 'Quote not found')
      return this.convertFromConfig(byQuoteId, scope)
    }
    return this.convertFromConfig(cpqConfig, scope)
  }

  private async convertFromConfig(cpqConfig: CpqQuoteConfiguration, scope: TenantScope): Promise<OrderResult> {
    const em = this.em

    const blockedStatuses = ['cancelled', 'rejected']
    if (blockedStatuses.includes(cpqConfig.cpqStatus)) {
      throw new OrderError(409, `Cannot convert a quote in '${cpqConfig.cpqStatus}' status`)
    }

    const quoteLines = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    if (quoteLines.length === 0) {
      throw new OrderError(422, 'Cannot convert a quote with no line items')
    }

    const { number: orderNumber } = await this.numberGenerator.generate({
      kind: 'order',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    const salesOrderId = crypto.randomUUID()
    const pricingSummary = cpqConfig.pricingSummary as Record<string, unknown> | null
    const nrcTotal = Number(pricingSummary?.nrcTotal ?? 0)
    const mrcTotal = Number(pricingSummary?.mrcTotal ?? 0)
    const grandTotal = nrcTotal + mrcTotal

    const salesOrder = em.create(SalesOrder, {
      id: salesOrderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderNumber,
      customerEntityId: cpqConfig.customerId,
      currencyCode: cpqConfig.currencyCode,
      status: 'draft',
      subtotalNetAmount: String(grandTotal),
      subtotalGrossAmount: String(grandTotal),
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      shippingNetAmount: '0',
      shippingGrossAmount: '0',
      surchargeTotalAmount: '0',
      paidTotalAmount: '0',
      grandTotalNetAmount: String(grandTotal),
      grandTotalGrossAmount: String(grandTotal),
      lineItemCount: quoteLines.length,
      metadata: { sourceQuoteId: cpqConfig.id },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    em.persist(salesOrder)

    const cpqOrderConfigId = crypto.randomUUID()
    const cpqOrderConfig = em.create(CpqOrderConfiguration, {
      id: cpqOrderConfigId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      orderId: salesOrderId,
      sourceQuoteId: cpqConfig.id,
      customerId: cpqConfig.customerId,
      cpqStatus: 'draft',
      currencyCode: cpqConfig.currencyCode,
      pricingSummary: {
        nrcTotal,
        mrcTotal,
        currencyCode: cpqConfig.currencyCode,
      },
    })
    em.persist(cpqOrderConfig)

    const quoteLineIdToOrderLineId = new Map<string, string>()

    for (let i = 0; i < quoteLines.length; i++) {
      const ql = quoteLines[i]

      const perInstanceNrc = Number(ql.nrcTotal)
      const perInstanceMrc = Number(ql.mrcTotal)
      const unitPriceNet = (perInstanceNrc + perInstanceMrc) / ql.quantity
      const totalNet = perInstanceNrc + perInstanceMrc

      const orderLineId = crypto.randomUUID()
      quoteLineIdToOrderLineId.set(ql.quoteLineId, orderLineId)

      const offeringName = await this.resolveOfferingName(em, ql.offeringId, scope)

      const orderLine = em.create(SalesOrderLine, {
        id: orderLineId,
        order: salesOrder,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineNumber: i + 1,
        kind: 'product',
        productId: ql.productId ?? null,
        name: offeringName,
        quantity: String(ql.quantity),
        unitPriceNet: String(unitPriceNet),
        unitPriceGross: String(unitPriceNet),
        totalNetAmount: String(totalNet),
        totalGrossAmount: String(totalNet),
        discountAmount: '0',
        discountPercent: '0',
        taxRate: '0',
        taxAmount: '0',
        currencyCode: cpqConfig.currencyCode,
        configuration: {
          offeringId: ql.offeringId ?? null,
          action: ql.action,
          nrcTotal: perInstanceNrc,
          mrcTotal: perInstanceMrc,
          parentLineId: ql.parentLineId ?? null,
        },
        normalizedQuantity: String(ql.quantity),
        reservedQuantity: '0',
        fulfilledQuantity: '0',
        invoicedQuantity: '0',
        returnedQuantity: '0',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      em.persist(orderLine)
      const orderLineConfig = em.create(CpqOrderLineConfiguration, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        orderLineId,
        orderConfigurationId: cpqOrderConfig.id,
        offeringId: ql.offeringId ?? null,
        productId: ql.productId ?? null,
        specId: ql.specId ?? null,
        action: ql.action,
        parentLineId: null,
        startDate: ql.startDate,
        termMonths: ql.termMonths ?? null,
        endDate: ql.endDate,
        configuration: { ...ql.configuration, offeringName },
        quantity: ql.quantity,
        charges: ql.charges ? [...ql.charges] : null,
        nrcTotal: ql.nrcTotal,
        mrcTotal: ql.mrcTotal,
        sourceQuoteLineId: ql.quoteLineId,
      })
      em.persist(orderLineConfig)
    }

    await em.flush()

    // Resolve parent line references using the quote→order line ID map
    const orderLineConfigs = await em.find(CpqOrderLineConfiguration, {
      orderConfigurationId: cpqOrderConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    for (const olc of orderLineConfigs) {
      if (olc.sourceQuoteLineId) {
        const sourceQl = quoteLines.find((ql) => ql.quoteLineId === olc.sourceQuoteLineId)
        if (sourceQl?.parentLineId) {
          const mappedParent = quoteLineIdToOrderLineId.get(sourceQl.parentLineId)
          if (mappedParent) olc.parentLineId = mappedParent
        }
      }
    }

    await em.flush()

    return this.buildOrderResult(em, cpqOrderConfig, salesOrder, orderLineConfigs, scope)
  }

  // ─── Activate Order ─────────────────────────────────────────

  async activateOrder(orderId: string, scope: TenantScope): Promise<OrderResult> {
    const em = this.em

    const orderConfig = await this.loadOrderConfig(em, orderId, scope)

    const currentStatus = orderConfig.cpqStatus as CpqOrderStatus
    if (currentStatus !== 'draft' && currentStatus !== 'pending_activation') {
      throw new OrderError(409, `Cannot activate order in '${currentStatus}' status`)
    }

    const salesOrder = await this.loadSalesOrder(em, orderConfig.orderId, scope)
    const orderLines = await em.find(CpqOrderLineConfiguration, {
      orderConfigurationId: orderConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    await this.createInventoryFromOrder(orderConfig, orderLines, scope)

    orderConfig.cpqStatus = 'active'
    orderConfig.activatedAt = new Date()
    salesOrder.status = 'active'
    salesOrder.placedAt = new Date()

    await em.flush()

    return this.buildOrderResult(em, orderConfig, salesOrder, orderLines, scope)
  }

  // ─── Inventory Creation ─────────────────────────────────────

  private async createInventoryFromOrder(
    orderConfig: CpqOrderConfiguration,
    orderLines: CpqOrderLineConfiguration[],
    scope: TenantScope,
  ): Promise<void> {
    if (orderLines.length === 0) return

    const specIds = [...new Set(orderLines.map((l) => l.specId).filter(Boolean))] as string[]
    const specs = specIds.length > 0
      ? await this.em.find(CpqProductSpecification, {
          id: { $in: specIds },
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
      : []
    const specMap = new Map(specs.map((s) => [s.id, s]))

    const subscriptionLines = orderLines.filter((l) => {
      const spec = l.specId ? specMap.get(l.specId) : null
      return !spec?.isAssetizable
    })
    const assetLines = orderLines.filter((l) => {
      const spec = l.specId ? specMap.get(l.specId) : null
      return spec?.isAssetizable === true
    })

    const hasSubscriptionContent = subscriptionLines.some(
      (l) => Number(l.mrcTotal) > 0 || Number(l.nrcTotal) > 0,
    )
    if (!hasSubscriptionContent && assetLines.length === 0) return

    const subscriptionName = await this.buildSubscriptionName(orderConfig, orderLines, scope)

    const lineWithDates = orderLines.find((l) => l.startDate != null) ?? orderLines[0]
    const lineWithTerm = orderLines.find((l) => l.termMonths != null) ?? orderLines[0]
    const subscriptionItems = subscriptionLines.map((line) => ({
      productId: line.productId ?? undefined,
      offeringId: line.offeringId ?? undefined,
      specId: line.specId ?? undefined,
      name: this.getLineName(line),
      configuration: line.configuration ?? {},
      charges: (line.charges ?? []) as Array<Record<string, unknown>>,
      mrcAmount: Number(line.mrcTotal),
      nrcAmount: Number(line.nrcTotal),
      currencyCode: orderConfig.currencyCode,
      quantity: line.quantity,
      sourceQuoteLineId: line.sourceQuoteLineId ?? undefined,
      sortOrder: orderLines.indexOf(line),
    }))

    const subscription = await this.inventoryService.createSubscription(
      {
        customerId: orderConfig.customerId,
        name: subscriptionName,
        billingCycle: 'monthly',
        currencyCode: orderConfig.currencyCode,
        startDate: lineWithDates?.startDate?.toISOString?.() ?? undefined,
        termMonths: lineWithTerm?.termMonths ?? undefined,
        sourceQuoteId: orderConfig.sourceQuoteId ?? undefined,
        sourceOrderId: orderConfig.id,
        items: subscriptionItems.length > 0
          ? subscriptionItems
          : [{ name: subscriptionName, mrcAmount: 0, nrcAmount: 0 }],
      },
      scope,
    )

    const orderLineToSubItem = new Map<string, string>()
    const allSubItems = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: subscription.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, { orderBy: { sortOrder: 'asc' } })

    for (let i = 0; i < subscriptionLines.length && i < allSubItems.length; i++) {
      orderLineToSubItem.set(subscriptionLines[i].orderLineId, allSubItems[i].id)
    }

    for (let i = 0; i < subscriptionLines.length && i < allSubItems.length; i++) {
      const orderLine = subscriptionLines[i]
      if (orderLine.parentLineId) {
        const parentSubItemId = orderLineToSubItem.get(orderLine.parentLineId)
        if (parentSubItemId) {
          allSubItems[i].parentItemId = parentSubItemId
        }
      }
    }
    await this.em.flush()

    for (const line of assetLines) {
      let subscriptionItemId: string | undefined
      if (line.parentLineId) {
        subscriptionItemId = orderLineToSubItem.get(line.parentLineId) ?? undefined
      }

      await this.inventoryService.createAsset(
        {
          customerId: orderConfig.customerId,
          subscriptionId: subscription.id,
          subscriptionItemId,
          productId: line.productId ?? undefined,
          offeringId: line.offeringId ?? undefined,
          specId: line.specId ?? undefined,
          name: this.getLineName(line),
          assetType: 'one_time',
          currencyCode: orderConfig.currencyCode,
          purchasePrice: Number(line.nrcTotal),
          quantity: line.quantity,
          purchaseDate: new Date().toISOString().split('T')[0],
          configuration: line.configuration ?? {},
          charges: (line.charges ?? []) as Array<Record<string, unknown>>,
          sourceOrderId: orderConfig.id,
          sourceQuoteLineId: line.sourceQuoteLineId ?? undefined,
        },
        scope,
      )
    }
  }

  // ─── Get / List ─────────────────────────────────────────────

  async getOrder(orderId: string, scope: TenantScope): Promise<OrderResult> {
    const em = this.em
    const orderConfig = await this.loadOrderConfig(em, orderId, scope)
    const salesOrder = await this.loadSalesOrder(em, orderConfig.orderId, scope)
    const lines = await em.find(CpqOrderLineConfiguration, {
      orderConfigurationId: orderConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    return this.buildOrderResult(em, orderConfig, salesOrder, lines, scope)
  }

  async listOrders(filters: OrderListFilters, scope: TenantScope) {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
    const offset = (page - 1) * pageSize

    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    if (filters.customerId) where.customerId = filters.customerId
    if (filters.sourceQuoteId) where.sourceQuoteId = filters.sourceQuoteId
    if (filters.salesOrderId) where.orderId = filters.salesOrderId
    if (filters.cpqStatus) {
      where.cpqStatus = Array.isArray(filters.cpqStatus)
        ? { $in: filters.cpqStatus }
        : filters.cpqStatus
    }

    const [configs, total] = await this.em.findAndCount(
      CpqOrderConfiguration,
      where,
      { limit: pageSize, offset, orderBy: { createdAt: 'desc' } },
    )

    const orderIds = configs.map((c) => c.orderId)
    const salesOrders = orderIds.length > 0
      ? await this.em.find(SalesOrder, { id: { $in: orderIds } })
      : []
    const salesOrderMap = new Map(salesOrders.map((o) => [o.id, o]))

    const items = configs.map((c) => ({
      ...c,
      orderNumber: salesOrderMap.get(c.orderId)?.orderNumber ?? null,
    }))

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  // ─── Status Transition ──────────────────────────────────────

  async transitionOrderStatus(orderId: string, targetStatus: string, scope: TenantScope): Promise<OrderResult> {
    const em = this.em
    const orderConfig = await this.loadOrderConfig(em, orderId, scope)
    const salesOrder = await this.loadSalesOrder(em, orderConfig.orderId, scope)

    const currentStatus = orderConfig.cpqStatus as CpqOrderStatus
    const allowed = CPQ_ORDER_TRANSITIONS[currentStatus] ?? []

    if (!allowed.includes(targetStatus as CpqOrderStatus)) {
      throw new OrderError(409, `Cannot transition from '${currentStatus}' to '${targetStatus}'`)
    }

    if (targetStatus === 'active') {
      return this.activateOrder(orderId, scope)
    }

    orderConfig.cpqStatus = targetStatus
    salesOrder.status = CPQ_TO_SALES_ORDER_STATUS[targetStatus as CpqOrderStatus] ?? targetStatus

    await em.flush()

    const lines = await em.find(CpqOrderLineConfiguration, {
      orderConfigurationId: orderConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    return this.buildOrderResult(em, orderConfig, salesOrder, lines, scope)
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async loadOrderConfig(em: EntityManager, orderId: string, scope: TenantScope): Promise<CpqOrderConfiguration> {
    let config = await em.findOne(CpqOrderConfiguration, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!config) {
      config = await em.findOne(CpqOrderConfiguration, {
        orderId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
    }
    if (!config) throw new OrderError(404, 'Order not found')
    return config
  }

  private async loadSalesOrder(em: EntityManager, orderId: string, scope: TenantScope): Promise<SalesOrder> {
    const order = await em.findOne(SalesOrder, {
      id: orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (!order) throw new OrderError(404, 'Sales order not found')
    return order
  }

  private async resolveOfferingInfo(em: EntityManager, offeringId: string | null | undefined, scope: TenantScope): Promise<{ name: string; type: string | null }> {
    if (!offeringId) return { name: 'Configured Item', type: null }
    const offering = await em.findOne(CpqProductOffering, {
      id: offeringId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    return { name: offering?.name ?? 'Configured Item', type: offering?.offeringType ?? 'simple' }
  }

  private async resolveOfferingName(em: EntityManager, offeringId: string | null | undefined, scope: TenantScope): Promise<string> {
    const info = await this.resolveOfferingInfo(em, offeringId, scope)
    return info.name
  }

  private getLineName(line: CpqOrderLineConfiguration): string {
    const config = line.configuration as Record<string, unknown>
    return (config?.offeringName as string) ?? (config?.name as string) ?? 'Configured Item'
  }

  private async buildSubscriptionName(
    orderConfig: CpqOrderConfiguration,
    orderLines: CpqOrderLineConfiguration[],
    scope: TenantScope,
  ): Promise<string> {
    if (orderLines.length === 1 && orderLines[0].offeringId) {
      return this.resolveOfferingName(this.em, orderLines[0].offeringId, scope)
    }
    const names: string[] = []
    for (const line of orderLines.slice(0, 3)) {
      if (line.offeringId) {
        names.push(await this.resolveOfferingName(this.em, line.offeringId, scope))
      }
    }
    if (names.length > 0) {
      const suffix = orderLines.length > 3 ? ` (+${orderLines.length - 3} more)` : ''
      return names.join(', ') + suffix
    }
    return `Order ${orderConfig.orderId.slice(0, 8)}`
  }

  private async buildOrderResult(
    em: EntityManager,
    orderConfig: CpqOrderConfiguration,
    salesOrder: SalesOrder,
    lineConfigs: CpqOrderLineConfiguration[],
    scope: TenantScope,
  ): Promise<OrderResult> {
    const lines: OrderLineResult[] = []

    for (const lc of lineConfigs) {
      const offeringInfo = await this.resolveOfferingInfo(em, lc.offeringId, scope)
      lines.push({
        lineId: lc.orderLineId,
        offeringId: lc.offeringId ?? null,
        offeringName: offeringInfo.name,
        offeringType: offeringInfo.type,
        productId: lc.productId ?? null,
        specId: lc.specId ?? null,
        action: lc.action,
        parentLineId: lc.parentLineId ?? null,
        quantity: lc.quantity,
        configuration: lc.configuration ?? {},
        startDate: lc.startDate?.toISOString() ?? null,
        termMonths: lc.termMonths ?? null,
        endDate: lc.endDate?.toISOString() ?? null,
        nrcTotal: Number(lc.nrcTotal),
        mrcTotal: Number(lc.mrcTotal),
        charges: (lc.charges ?? []) as Array<Record<string, unknown>>,
        sourceQuoteLineId: lc.sourceQuoteLineId ?? null,
      })
    }

    const pricing = orderConfig.pricingSummary ?? {}

    return {
      id: orderConfig.id,
      orderId: orderConfig.orderId,
      orderNumber: salesOrder.orderNumber ?? '',
      customerId: orderConfig.customerId,
      cpqStatus: orderConfig.cpqStatus,
      sourceQuoteId: orderConfig.sourceQuoteId ?? null,
      currencyCode: orderConfig.currencyCode,
      pricingSummary: {
        nrcTotal: Number((pricing as Record<string, unknown>).nrcTotal ?? 0),
        mrcTotal: Number((pricing as Record<string, unknown>).mrcTotal ?? 0),
        currencyCode: orderConfig.currencyCode,
      },
      activatedAt: orderConfig.activatedAt?.toISOString() ?? null,
      createdAt: orderConfig.createdAt.toISOString(),
      lines,
    }
  }
}

// ─── Error class ──────────────────────────────────────────────────

export class OrderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'OrderError'
  }
}
