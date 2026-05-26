import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import {
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteTargetSubscription,
  CpqInventorySubscription,
  CpqOrderConfiguration,
  CpqOrderLineConfiguration,
  CpqProductOffering,
  CpqProductSpecification,
  CpqInventorySubscriptionItem,
} from '../data/entities'
import type {
  ApplyArcResult,
  ApplyMergeRenewalResult,
  ArcLineChange,
  CreateSubscriptionItemInput,
  DefaultCpqInventoryService,
} from './cpqInventoryService'
import {
  CPQ_ORDER_TRANSITIONS,
  type CpqOrderStatus,
  type TenantScope,
} from './types'
import { emitCpqEvent } from '../events'

// ─── Types ──────────────────────────────────────────────────────

interface OrderListFilters {
  customerId?: string
  sourceQuoteId?: string
  salesOrderId?: string
  cpqStatus?: string | string[]
  currencyCode?: string
  search?: string
  sortField?: 'createdAt' | 'updatedAt' | 'cpqStatus' | 'activatedAt' | 'currencyCode'
  sortDir?: 'asc' | 'desc'
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
  /** XD-250 ARC: snapshot of the source subscription item's current state.
   * Null for non-ARC lines and for fresh `add` lines on amend quotes. */
  arcSource: {
    subscriptionItemId: string
    name: string
    mrcAmount: number
    nrcAmount: number
    quantity: number
  } | null
}

interface OrderResult {
  id: string
  orderId: string
  orderNumber: string
  customerId: string
  cpqStatus: string
  sourceQuoteId: string | null
  /** XD-250 ARC quote type carried over from the source quote — used by the
   * order detail page to render the AMEND / RENEW / CANCEL badge. */
  quoteType: string
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

    // Idempotency guard: a quote may only convert once. If an order with
    // this quote as its `sourceQuoteId` already exists, the UI should
    // surface "Go to order" instead of re-running conversion — return
    // 409 with the existing id so the caller can redirect.
    const existingOrder = await em.findOne(CpqOrderConfiguration, {
      sourceQuoteId: cpqConfig.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (existingOrder) {
      throw new OrderError(
        409,
        `Quote has already been converted to order ${existingOrder.orderId}`,
      )
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

      const offeringName = await this.resolveOfferingName(
        em,
        ql.offeringId,
        scope,
        ql.configuration as Record<string, unknown> | null,
      )

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

    // Branch on the source quote's quoteType. ARC quotes mutate existing
    // subscriptions; new-sale quotes materialize a fresh subscription.
    const sourceQuote = orderConfig.sourceQuoteId
      ? await em.findOne(CpqQuoteConfiguration, {
          id: orderConfig.sourceQuoteId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
      : null

    const quoteType = sourceQuote?.quoteType ?? 'new'
    const postCommitEvents: Array<() => Promise<void>> = []

    if (quoteType === 'new') {
      const inventory = await this.createInventoryFromOrder(orderConfig, orderLines, scope)
      if (inventory) {
        postCommitEvents.push(() => emitActivatedEvent(orderConfig, inventory, scope))
      }
    } else {
      postCommitEvents.push(
        ...(await this.applyArcOrder(orderConfig, sourceQuote!, orderLines, scope)),
      )
    }

    orderConfig.cpqStatus = 'active'
    orderConfig.activatedAt = new Date()
    salesOrder.status = 'active'
    salesOrder.placedAt = new Date()

    await em.flush()

    // Emit lifecycle events AFTER the activation transaction commits.
    for (const fire of postCommitEvents) {
      try {
        await fire()
      } catch (err) {
        // Don't roll back the activation just because a subscriber blew up —
        // events are best-effort once the DB state is committed.
        console.error('[cpq.arc] event emission failed', err)
      }
    }

    return this.buildOrderResult(em, orderConfig, salesOrder, orderLines, scope)
  }

  // ─── ARC activation branch (XD-250) ─────────────────────────
  //
  // Reads the source quote's targets + lines, then dispatches per target to
  // cpqInventoryService.apply* primitives. Returns the list of post-commit
  // event emissions so the caller can fire them outside the activation TX.
  private async applyArcOrder(
    orderConfig: CpqOrderConfiguration,
    sourceQuote: CpqQuoteConfiguration,
    orderLines: CpqOrderLineConfiguration[],
    scope: TenantScope,
  ): Promise<Array<() => Promise<void>>> {
    const em = this.em
    const quoteType = sourceQuote.quoteType as 'amend' | 'renew' | 'cancel'

    // Load attached targets.
    const targets = await em.find(CpqQuoteTargetSubscription, {
      quoteId: sourceQuote.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (targets.length === 0) {
      throw new OrderError(
        409,
        `ARC quote ${sourceQuote.id} has no target subscriptions to activate`,
      )
    }

    const inventory = this.inventoryService

    // Group order lines by target_subscription_id — ARC order lines mirror the
    // quote lines' ARC fields (target_subscription_id is preserved through
    // convertQuoteToOrder via line.configuration when needed).
    // Source quote lines are the source of truth for ARC line data because
    // CpqOrderLineConfiguration doesn't carry target/source-item fields.
    const sourceQuoteLines = await em.find(CpqQuoteLineConfiguration, {
      quoteConfigurationId: sourceQuote.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const linesByTarget = new Map<string | null, CpqQuoteLineConfiguration[]>()
    for (const line of sourceQuoteLines) {
      const key = line.targetSubscriptionId ?? null
      const list = linesByTarget.get(key) ?? []
      list.push(line)
      linesByTarget.set(key, list)
    }

    // Look up specs for `add` lines so we can build itemInput correctly.
    const specIds = [
      ...new Set(sourceQuoteLines.map((l) => l.specId).filter((x): x is string => Boolean(x))),
    ]
    const specs =
      specIds.length > 0
        ? await em.find(CpqProductSpecification, {
            id: { $in: specIds },
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            deletedAt: null,
          })
        : []
    const specMap = new Map(specs.map((s) => [s.id, s]))

    const events: Array<() => Promise<void>> = []
    const eventBaseEnvelope = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sourceQuoteId: sourceQuote.id,
      sourceOrderId: orderConfig.id,
    } as const

    if (quoteType === 'amend') {
      for (const target of targets) {
        const lines = linesByTarget.get(target.subscriptionId) ?? []
        const result = await inventory.applyAmendment(
          {
            subscriptionId: target.subscriptionId,
            sourceQuoteId: sourceQuote.id,
            sourceOrderId: orderConfig.id,
            performedByUserId: null,
            lineChanges: lines.map((l) => buildArcLineChange(l, specMap)),
          },
          scope,
        )
        events.push(() => emitAmendedEvent(result, eventBaseEnvelope))
      }
    } else if (quoteType === 'cancel') {
      for (const target of targets) {
        const result = await inventory.applyCancel(
          {
            subscriptionId: target.subscriptionId,
            sourceQuoteId: sourceQuote.id,
            sourceOrderId: orderConfig.id,
            performedByUserId: null,
            etfAmount: sourceQuote.arcEtfAmount ?? null,
            etfCurrency: sourceQuote.arcEtfCurrency ?? null,
            reasonCode: sourceQuote.arcReasonCode ?? null,
            reasonText: sourceQuote.arcReasonText ?? null,
          },
          scope,
        )
        events.push(() => emitCancelledEvent(result, eventBaseEnvelope))
      }
    } else if (quoteType === 'renew') {
      const standalone = targets.filter((t) => t.mergeAction === 'standalone')
      const absorb = targets.filter((t) => t.mergeAction === 'absorb')

      if (standalone.length > 0 && absorb.length === 0) {
        for (const target of standalone) {
          if (!target.newTermStart || !target.newTermEnd) {
            throw new OrderError(
              409,
              `Standalone renew target ${target.id} missing newTermStart/newTermEnd`,
            )
          }
          const lines = linesByTarget.get(target.subscriptionId) ?? []
          const result = await inventory.applyRenewal(
            {
              subscriptionId: target.subscriptionId,
              sourceQuoteId: sourceQuote.id,
              sourceOrderId: orderConfig.id,
              performedByUserId: null,
              term: {
                newTermStart: target.newTermStart,
                newTermEnd: target.newTermEnd,
                newTermMonths: target.newTermMonths ?? null,
              },
              lineChanges: lines.map((l) => buildArcLineChange(l, specMap)),
            },
            scope,
          )
          events.push(() => emitRenewedEvent(result, eventBaseEnvelope))
        }
      } else if (absorb.length >= 2 && standalone.length === 0) {
        if (!sourceQuote.arcMergeNewTermStart || !sourceQuote.arcMergeNewTermEnd) {
          throw new OrderError(
            409,
            `Merge renew quote ${sourceQuote.id} missing arc_merge_new_term_*`,
          )
        }
        // Lines targeting null are operator-edits on the new merge sub M.
        const mergeLines = linesByTarget.get(null) ?? []
        const merge = await inventory.applyMergeRenewal(
          {
            sourceIds: absorb.map((t) => t.subscriptionId),
            sourceQuoteId: sourceQuote.id,
            sourceOrderId: orderConfig.id,
            performedByUserId: null,
            term: {
              newTermStart: sourceQuote.arcMergeNewTermStart,
              newTermEnd: sourceQuote.arcMergeNewTermEnd,
              newTermMonths: sourceQuote.arcMergeNewTermMonths ?? null,
            },
            mergeMeta: {
              newSubCode: sourceQuote.arcMergeNewSubCode ?? null,
              newSubName: sourceQuote.arcMergeNewSubName ?? null,
            },
            lineChanges: mergeLines.map((l) => buildArcLineChange(l, specMap)),
          },
          scope,
        )

        // One event per source (`superseded`) + one for M (`merged`).
        const mergedFromSubscriptionIds = absorb.map((t) => t.subscriptionId)
        events.push(() =>
          emitMergedEvent(merge, eventBaseEnvelope, mergedFromSubscriptionIds),
        )
        for (const sourceLog of merge.sourceChangeLogs) {
          events.push(() =>
            emitSupersededEvent(
              sourceLog,
              iso10(merge.mergedSubscription.currentTermStart),
              eventBaseEnvelope,
            ),
          )
        }
      } else {
        throw new OrderError(
          409,
          `Inconsistent renew targets — must be either single standalone or ≥2 absorb`,
        )
      }
    } else {
      throw new OrderError(500, `Unknown quote_type '${quoteType}' for ARC activation`)
    }

    return events
  }

  // ─── Inventory Creation ─────────────────────────────────────

  private async createInventoryFromOrder(
    orderConfig: CpqOrderConfiguration,
    orderLines: CpqOrderLineConfiguration[],
    scope: TenantScope,
  ): Promise<ActivatedInventory | null> {
    if (orderLines.length === 0) return null

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
    if (!hasSubscriptionContent && assetLines.length === 0) return null

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

    // Pair each subscription line with its created subscription item —
    // input for the `cpq.subscription.activated` billing-onboarding event.
    const eventItems = subscriptionLines
      .slice(0, allSubItems.length)
      .map((line, i) => ({
        subscriptionItemId: allSubItems[i].id,
        productName: this.getLineName(line),
        mrcTotal: Number(line.mrcTotal),
        nrcTotal: Number(line.nrcTotal),
      }))
      // Only lines with a billable charge — a zero-value line yields
      // no Billing Item anyway; emitting it would just make the
      // connector create a needless shell account.
      .filter((it) => it.mrcTotal > 0 || it.nrcTotal > 0)
    return { subscriptionId: subscription.id, items: eventItems }
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
    if (filters.currencyCode) where.currencyCode = filters.currencyCode
    if (filters.cpqStatus) {
      where.cpqStatus = Array.isArray(filters.cpqStatus)
        ? { $in: filters.cpqStatus }
        : filters.cpqStatus
    }

    const search = filters.search?.trim()
    if (search) {
      where.$or = [
        { orderId: { $ilike: `%${search}%` } },
        { customerId: { $ilike: `%${search}%` } },
      ]
    }

    const sortField = filters.sortField ?? 'createdAt'
    const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'

    const [configs, total] = await this.em.findAndCount(
      CpqOrderConfiguration,
      where,
      { limit: pageSize, offset, orderBy: { [sortField]: sortDir } },
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

  private async resolveOfferingInfo(
    em: EntityManager,
    offeringId: string | null | undefined,
    scope: TenantScope,
    fallbackConfig?: Record<string, unknown> | null,
  ): Promise<{ name: string; type: string | null }> {
    if (offeringId) {
      const offering = await em.findOne(CpqProductOffering, {
        id: offeringId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (offering) return { name: offering.name, type: offering.offeringType ?? 'simple' }
    }
    const cfg = fallbackConfig ?? null
    const fallbackName =
      (cfg?._arcMirroredName as string | undefined) ??
      (cfg?.offeringName as string | undefined) ??
      'Configured Item'
    return { name: fallbackName, type: null }
  }

  private async resolveOfferingName(
    em: EntityManager,
    offeringId: string | null | undefined,
    scope: TenantScope,
    fallbackConfig?: Record<string, unknown> | null,
  ): Promise<string> {
    const info = await this.resolveOfferingInfo(em, offeringId, scope, fallbackConfig)
    return info.name
  }

  private getLineName(line: CpqOrderLineConfiguration): string {
    const config = line.configuration as Record<string, unknown> | null
    return (
      (config?._arcMirroredName as string | undefined) ??
      (config?.offeringName as string | undefined) ??
      (config?.name as string | undefined) ??
      'Configured Item'
    )
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

    // XD-250 ARC: batch-load source subscription items so we can render the
    // before/after diff per line on the order detail page.
    const arcItemIds = new Set<string>()
    for (const lc of lineConfigs) {
      const m = (lc.configuration as Record<string, unknown> | null)?._arcMirroredFromItemId
      if (typeof m === 'string') arcItemIds.add(m)
    }
    const arcItemMap = new Map<string, CpqInventorySubscriptionItem>()
    if (arcItemIds.size > 0) {
      const items = await em.find(CpqInventorySubscriptionItem, {
        id: { $in: Array.from(arcItemIds) },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      for (const it of items) arcItemMap.set(it.id, it)
    }

    for (const lc of lineConfigs) {
      const offeringInfo = await this.resolveOfferingInfo(
        em,
        lc.offeringId,
        scope,
        lc.configuration as Record<string, unknown> | null,
      )
      const arcSource = pickArcSourceFromConfig(lc.configuration as Record<string, unknown> | null, arcItemMap)
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
        arcSource,
      })
    }

    // Source quote's quoteType — surfaced to the order header so the UI can
    // render an AMEND / RENEW / CANCEL badge alongside the order number.
    // CpqOrderConfiguration.sourceQuoteId stores CpqQuoteConfiguration.id
    // (see convertFromConfig — sourceQuoteId: cpqConfig.id), NOT the
    // SalesQuote.id, so we look it up by `id` rather than by `quoteId`.
    let quoteType = 'new'
    if (orderConfig.sourceQuoteId) {
      const sourceCfg = await em.findOne(CpqQuoteConfiguration, {
        id: orderConfig.sourceQuoteId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (sourceCfg?.quoteType) quoteType = sourceCfg.quoteType
    }

    const pricing = orderConfig.pricingSummary ?? {}

    return {
      id: orderConfig.id,
      orderId: orderConfig.orderId,
      orderNumber: salesOrder.orderNumber ?? '',
      customerId: orderConfig.customerId,
      cpqStatus: orderConfig.cpqStatus,
      sourceQuoteId: orderConfig.sourceQuoteId ?? null,
      quoteType,
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

function pickArcSourceFromConfig(
  cfg: Record<string, unknown> | null,
  map: Map<string, CpqInventorySubscriptionItem>,
): OrderLineResult['arcSource'] {
  const m = cfg?._arcMirroredFromItemId
  if (typeof m !== 'string') return null
  const item = map.get(m)
  if (!item) return null
  return {
    subscriptionItemId: item.id,
    name: item.name,
    mrcAmount: Number(item.mrcAmount),
    nrcAmount: Number(item.nrcAmount),
    quantity: item.quantity,
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

// ─── ARC helpers (XD-250) ─────────────────────────────────────────

/**
 * Build a service-layer ArcLineChange from a CpqQuoteLineConfiguration.
 * For 'add' actions, materializes the itemInput from line + spec data.
 */
function buildArcLineChange(
  line: CpqQuoteLineConfiguration,
  specMap: Map<string, CpqProductSpecification>,
): ArcLineChange {
  const action = line.action as 'add' | 'modify' | 'cancel'
  if (action === 'add') {
    const itemInput: Omit<CreateSubscriptionItemInput, 'name'> & { name: string } = {
      productId: line.productId ?? undefined,
      offeringId: line.offeringId ?? undefined,
      specId: line.specId ?? undefined,
      name: resolveLineName(line, specMap),
      configuration: line.configuration ?? {},
      charges: (line.charges ?? null) as Array<Record<string, unknown>> | undefined,
      mrcAmount: Number(line.mrcTotal),
      nrcAmount: Number(line.nrcTotal),
      quantity: line.quantity,
      sourceQuoteLineId: line.quoteLineId,
    }
    return {
      quoteLineId: line.quoteLineId,
      action,
      itemInput,
      parentQuoteLineId: line.parentLineId ?? null,
    }
  }
  if (action === 'cancel') {
    return {
      quoteLineId: line.quoteLineId,
      action,
      sourceSubscriptionItemId: line.sourceSubscriptionItemId ?? null,
    }
  }
  // modify
  return {
    quoteLineId: line.quoteLineId,
    action,
    sourceSubscriptionItemId: line.sourceSubscriptionItemId ?? null,
    modifyPatch: {
      configuration: line.configuration ?? undefined,
      charges: (line.charges ?? undefined) as Array<Record<string, unknown>> | undefined,
      mrcAmount: Number(line.mrcTotal),
      nrcAmount: Number(line.nrcTotal),
      quantity: line.quantity,
    },
  }
}

function resolveLineName(
  line: CpqQuoteLineConfiguration,
  specMap: Map<string, CpqProductSpecification>,
): string {
  const cfg = line.configuration as Record<string, unknown> | null
  const cfgName = (cfg?._arcMirroredName as string | undefined) ?? null
  if (cfgName) return cfgName
  if (line.specId) {
    const spec = specMap.get(line.specId)
    if (spec?.name) return spec.name
  }
  return 'Configured Item'
}

interface ArcEventEnvelope {
  organizationId: string
  tenantId: string
  sourceQuoteId: string
  sourceOrderId: string
}

// ─── Subscription-activated event (new-sale billing onboarding) ──

type ActivatedInventory = {
  subscriptionId: string
  items: Array<{
    subscriptionItemId: string
    productName: string
    /** Line totals — CPQ pricing has already applied line quantity. */
    mrcTotal: number
    nrcTotal: number
  }>
}

/**
 * Emit `cpq.subscription.activated` after a new-sale order activation.
 *
 * Payload matches the `@dainamite/cpq-billing-connector`
 * `cpq-subscription-activated` subscriber contract: one CPQ charge per
 * non-zero MRC / NRC total on each subscription item. The connector
 * get-or-creates the Billing Account (keyed on `customerId`) and turns
 * each charge into a Billing Item.
 */
async function emitActivatedEvent(
  orderConfig: CpqOrderConfiguration,
  inventory: ActivatedInventory,
  scope: TenantScope,
): Promise<void> {
  const items = inventory.items.map((it) => ({
    subscriptionItemId: it.subscriptionItemId,
    productName: it.productName,
    // `mrcTotal` / `nrcTotal` are line totals — CPQ pricing already
    // applied the line quantity. Quantity is therefore 1 here so
    // `unitPrice × quantity` stays internally consistent no matter
    // how the connector treats the multiplier.
    quantity: 1,
    charges: [
      ...(it.mrcTotal > 0
        ? [{ type: 'recurring', unitPrice: it.mrcTotal, description: 'Recurring charge' }]
        : []),
      ...(it.nrcTotal > 0
        ? [{ type: 'one_time', amount: it.nrcTotal, description: 'One-time charge' }]
        : []),
    ],
  }))
  await emitCpqEvent('cpq.subscription.activated' as never, {
    subscriptionId: inventory.subscriptionId,
    customerId: orderConfig.customerId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    currencyCode: orderConfig.currencyCode,
    timestamp: new Date().toISOString(),
    activationDate: new Date().toISOString().slice(0, 10),
    sourceQuoteId: orderConfig.sourceQuoteId ?? null,
    sourceOrderId: orderConfig.id,
    items,
  } as never)
}

/** Coerce a Date or `date`-column string to a `YYYY-MM-DD` string. */
function iso10(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

type ArcChargeItem = {
  subscriptionItemId: string
  productName: string
  quantity: number
  charges: Array<Record<string, unknown>>
}

/**
 * Build the connector's `addedItems` from a change log's `add` line
 * changes. `mrcAmount` / `nrcAmount` are line totals (CPQ pricing has
 * already applied quantity) → emit `quantity: 1` with the totals as the
 * charge rate, exactly as `emitActivatedEvent`.
 */
function buildArcAddedItems(changeLog: ApplyArcResult['changeLog']): ArcChargeItem[] {
  const after = changeLog.afterSnapshot as
    | { items?: Array<{ id?: string; name?: string }> }
    | null
  const nameById = new Map(
    (after?.items ?? []).map((i) => [String(i.id), i.name ?? '']),
  )
  const summary = (changeLog.lineChanges ?? []) as Array<{
    action?: string
    itemId?: string
    mrcAmount?: unknown
    nrcAmount?: unknown
  }>
  const out: ArcChargeItem[] = []
  for (const change of summary) {
    if (change.action !== 'add' || typeof change.itemId !== 'string') continue
    const mrc = Number(change.mrcAmount)
    const nrc = Number(change.nrcAmount)
    out.push({
      subscriptionItemId: change.itemId,
      productName: nameById.get(change.itemId) || 'Configured item',
      quantity: 1,
      charges: [
        ...(mrc > 0
          ? [{ type: 'recurring', unitPrice: mrc, description: 'Recurring charge' }]
          : []),
        ...(nrc > 0
          ? [{ type: 'one_time', amount: nrc, description: 'One-time charge' }]
          : []),
      ],
    })
  }
  return out
}

/** Subscription-item ids removed by a change log's `cancel` line changes. */
function buildArcRemovedItemIds(changeLog: ApplyArcResult['changeLog']): string[] {
  const summary = (changeLog.lineChanges ?? []) as Array<{
    action?: string
    itemId?: string
  }>
  return summary
    .filter((c) => c.action === 'cancel' && typeof c.itemId === 'string')
    .map((c) => c.itemId as string)
}

async function emitAmendedEvent(
  result: ApplyArcResult,
  envelope: ArcEventEnvelope,
): Promise<void> {
  await emitCpqEvent('cpq.subscription.amended' as never, {
    tenantId: envelope.tenantId,
    organizationId: envelope.organizationId,
    subscriptionId: result.subscription.id,
    customerId: result.subscription.customerId,
    // No operator-chosen amend date today — the activation moment is
    // the effective date. The billing connector computes the mid-cycle
    // proration from this date + the account's billing cycle.
    effectiveDate: iso10(result.changeLog.effectiveAt),
    addedItems: buildArcAddedItems(result.changeLog),
    removedSubscriptionItemIds: buildArcRemovedItemIds(result.changeLog),
    sourceQuoteId: envelope.sourceQuoteId,
    sourceOrderId: envelope.sourceOrderId,
    timestamp: new Date().toISOString(),
  } as never)
}

async function emitRenewedEvent(
  result: ApplyArcResult,
  envelope: ArcEventEnvelope,
): Promise<void> {
  await emitCpqEvent('cpq.subscription.renewed' as never, {
    tenantId: envelope.tenantId,
    organizationId: envelope.organizationId,
    subscriptionId: result.subscription.id,
    customerId: result.subscription.customerId,
    newTermStart: iso10(result.subscription.currentTermStart),
    newTermEnd: iso10(result.subscription.currentTermEnd),
    addedItems: buildArcAddedItems(result.changeLog),
    sourceQuoteId: envelope.sourceQuoteId,
    sourceOrderId: envelope.sourceOrderId,
    timestamp: new Date().toISOString(),
  } as never)
}

async function emitCancelledEvent(
  result: ApplyArcResult,
  envelope: ArcEventEnvelope,
): Promise<void> {
  await emitCpqEvent('cpq.subscription.cancelled' as never, {
    tenantId: envelope.tenantId,
    organizationId: envelope.organizationId,
    subscriptionId: result.subscription.id,
    customerId: result.subscription.customerId,
    effectiveDate: iso10(result.changeLog.effectiveAt),
    sourceQuoteId: envelope.sourceQuoteId,
    sourceOrderId: envelope.sourceOrderId,
    timestamp: new Date().toISOString(),
  } as never)
}

async function emitMergedEvent(
  merge: ApplyMergeRenewalResult,
  envelope: ArcEventEnvelope,
  sourceSubscriptionIds: string[],
): Promise<void> {
  await emitCpqEvent('cpq.subscription.merged' as never, {
    tenantId: envelope.tenantId,
    organizationId: envelope.organizationId,
    mergedSubscriptionId: merge.mergedSubscription.id,
    sourceSubscriptionIds,
    sourceQuoteId: envelope.sourceQuoteId,
    sourceOrderId: envelope.sourceOrderId,
    timestamp: new Date().toISOString(),
  } as never)
}

async function emitSupersededEvent(
  sourceLog: { id: string; subscriptionId: string },
  effectiveDate: string | null,
  envelope: ArcEventEnvelope,
): Promise<void> {
  await emitCpqEvent('cpq.subscription.superseded' as never, {
    tenantId: envelope.tenantId,
    organizationId: envelope.organizationId,
    subscriptionId: sourceLog.subscriptionId,
    effectiveDate,
    sourceQuoteId: envelope.sourceQuoteId,
    sourceOrderId: envelope.sourceOrderId,
    timestamp: new Date().toISOString(),
  } as never)
}
