import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqInventoryAsset,
} from '../data/entities'
import {
  INVENTORY_SUBSCRIPTION_TRANSITIONS,
  INVENTORY_ASSET_TRANSITIONS,
  getBaseCurrencyCode,
  type InventorySubscriptionStatus,
  type InventoryAssetStatus,
  type TenantScope,
} from './types'

// ─── Filter / Input / Result types ───────────────────────────────

interface SubscriptionListFilters {
  customerId?: string
  sourceOrderId?: string
  status?: string | string[]
  productId?: string
  page?: number
  pageSize?: number
}

interface SubscriptionItemListFilters {
  subscriptionId?: string
  parentItemId?: string
  status?: string
}

interface AssetListFilters {
  customerId?: string
  status?: string | string[]
  assetType?: string
  productId?: string
  subscriptionId?: string
  subscriptionItemId?: string
  page?: number
  pageSize?: number
}

interface CustomerInventoryFilters {
  status?: string | string[]
  productId?: string
  includeTerminated?: boolean
}

interface CreateSubscriptionInput {
  customerId: string
  code?: string
  name: string
  description?: string
  billingCycle?: string
  currencyCode?: string
  startDate?: string
  termMonths?: number
  autoRenew?: boolean
  sourceQuoteId?: string
  sourceOrderId?: string
  metadata?: Record<string, unknown>
  items: CreateSubscriptionItemInput[]
}

interface CreateSubscriptionItemInput {
  parentItemId?: string
  productId?: string
  offeringId?: string
  specId?: string
  name: string
  configuration?: Record<string, unknown>
  charges?: Array<Record<string, unknown>>
  mrcAmount?: number
  nrcAmount?: number
  currencyCode?: string
  quantity?: number
  capacityTotal?: number
  capacityUnit?: string
  sourceQuoteLineId?: string
  metadata?: Record<string, unknown>
  sortOrder?: number
}

interface UpdateSubscriptionInput {
  name?: string
  description?: string
  billingCycle?: string
  autoRenew?: boolean
  termMonths?: number
  currentTermEnd?: string
  metadata?: Record<string, unknown>
}

interface UpdateSubscriptionItemInput {
  name?: string
  metadata?: Record<string, unknown>
  capacityTotal?: number
  capacityUsed?: number
  capacityUnit?: string
  sortOrder?: number
}

interface CreateAssetInput {
  customerId: string
  subscriptionId?: string
  subscriptionItemId?: string
  productId?: string
  offeringId?: string
  specId?: string
  code?: string
  name: string
  description?: string
  assetType?: string
  currencyCode?: string
  purchasePrice?: number
  quantity?: number
  purchaseDate?: string
  deliveryDate?: string
  configuration?: Record<string, unknown>
  charges?: Array<Record<string, unknown>>
  sourceQuoteId?: string
  sourceOrderId?: string
  sourceQuoteLineId?: string
  metadata?: Record<string, unknown>
}

interface UpdateAssetInput {
  name?: string
  description?: string
  assetType?: string
  deliveryDate?: string
  metadata?: Record<string, unknown>
}

interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface SubscriptionItemResultNode {
  id: string
  subscriptionId: string
  parentItemId: string | null
  productId: string | null
  offeringId: string | null
  specId: string | null
  name: string
  status: string
  configuration: Record<string, unknown>
  charges: Array<Record<string, unknown>> | null
  mrcAmount: number
  nrcAmount: number
  currencyCode: string
  quantity: number
  capacityTotal: number | null
  capacityUsed: number | null
  capacityUnit: string | null
  metadata: Record<string, unknown> | null
  sortOrder: number
  children: SubscriptionItemResultNode[]
}

// ─── Service implementation ──────────────────────────────────────

export class DefaultCpqInventoryService {
  private em: EntityManager

  constructor(em: EntityManager) {
    this.em = em
  }

  // ═══════════════════════════════════════════════════════════════
  //  Subscriptions
  // ═══════════════════════════════════════════════════════════════

  async listSubscriptions(filters: SubscriptionListFilters, scope: TenantScope): Promise<PaginatedResult<CpqInventorySubscription>> {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
    const offset = (page - 1) * pageSize

    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    if (filters.customerId) where.customerId = filters.customerId
    if (filters.sourceOrderId) where.sourceOrderId = filters.sourceOrderId
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { $in: filters.status }
        : filters.status
    }

    if (filters.productId) {
      const itemIds = await this.em.find(
        CpqInventorySubscriptionItem,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
          productId: filters.productId,
        },
        { fields: ['subscriptionId'] as const },
      )
      const subIds = [...new Set(itemIds.map((i) => i.subscriptionId))]
      if (subIds.length === 0) {
        return { items: [], total: 0, page, pageSize, totalPages: 0 }
      }
      where.id = { $in: subIds }
    }

    const [items, total] = await this.em.findAndCount(
      CpqInventorySubscription,
      where,
      { limit: pageSize, offset, orderBy: { createdAt: 'desc' } },
    )

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async getSubscription(subscriptionId: string, scope: TenantScope) {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id: subscriptionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }

    const allItems = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, { orderBy: { sortOrder: 'asc' } })

    const itemTree = this.buildItemTree(allItems)

    return { ...sub, items: itemTree }
  }

  async createSubscription(input: CreateSubscriptionInput, scope: TenantScope) {
    const code = input.code ?? await this.generateSubscriptionCode(scope)

    const subId = crypto.randomUUID()
    const sub = this.em.create(CpqInventorySubscription, {
      id: subId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      customerId: input.customerId,
      code,
      name: input.name,
      description: input.description ?? null,
      status: 'pending',
      billingCycle: input.billingCycle ?? 'monthly',
      currencyCode: input.currencyCode ?? await getBaseCurrencyCode(this.em, scope),
      mrcAmount: '0',
      nrcAmount: '0',
      startDate: input.startDate ? new Date(input.startDate) : null,
      termMonths: input.termMonths ?? null,
      autoRenew: input.autoRenew ?? true,
      sourceQuoteId: input.sourceQuoteId ?? null,
      sourceOrderId: input.sourceOrderId ?? null,
      metadata: input.metadata ?? null,
    })
    this.em.persist(sub)

    const items: CpqInventorySubscriptionItem[] = []
    for (const itemInput of input.items) {
      const item = this.em.create(CpqInventorySubscriptionItem, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        subscriptionId: sub.id,
        customerId: input.customerId,
        parentItemId: itemInput.parentItemId ?? null,
        productId: itemInput.productId ?? null,
        offeringId: itemInput.offeringId ?? null,
        specId: itemInput.specId ?? null,
        name: itemInput.name,
        status: 'pending',
        configuration: itemInput.configuration ?? {},
        charges: itemInput.charges ?? null,
        mrcAmount: String(itemInput.mrcAmount ?? 0),
        nrcAmount: String(itemInput.nrcAmount ?? 0),
        currencyCode: itemInput.currencyCode ?? input.currencyCode ?? await getBaseCurrencyCode(this.em, scope),
        quantity: itemInput.quantity ?? 1,
        capacityTotal: itemInput.capacityTotal != null ? String(itemInput.capacityTotal) : null,
        capacityUsed: null,
        capacityUnit: itemInput.capacityUnit ?? null,
        sourceQuoteLineId: itemInput.sourceQuoteLineId ?? null,
        metadata: itemInput.metadata ?? null,
        sortOrder: itemInput.sortOrder ?? 0,
      })
      this.em.persist(item)
      items.push(item)
    }

    const mrcSum = items.reduce((s, i) => s + Number(i.mrcAmount), 0)
    const nrcSum = items.reduce((s, i) => s + Number(i.nrcAmount), 0)
    sub.mrcAmount = String(mrcSum)
    sub.nrcAmount = String(nrcSum)

    await this.em.flush()
    return sub
  }

  async updateSubscription(id: string, updates: UpdateSubscriptionInput, scope: TenantScope) {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }

    if (updates.name !== undefined) sub.name = updates.name
    if (updates.description !== undefined) sub.description = updates.description
    if (updates.billingCycle !== undefined) sub.billingCycle = updates.billingCycle
    if (updates.autoRenew !== undefined) sub.autoRenew = updates.autoRenew
    if (updates.termMonths !== undefined) sub.termMonths = updates.termMonths
    if (updates.currentTermEnd !== undefined) sub.currentTermEnd = updates.currentTermEnd ? new Date(updates.currentTermEnd) : null
    if (updates.metadata !== undefined) sub.metadata = updates.metadata

    await this.em.flush()
    return sub
  }

  async deleteSubscription(id: string, scope: TenantScope) {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }

    sub.deletedAt = new Date()
    await this.em.flush()
    return { success: true }
  }

  async transitionSubscriptionStatus(id: string, targetStatus: string, scope: TenantScope) {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }

    const currentStatus = sub.status as InventorySubscriptionStatus
    const allowed = INVENTORY_SUBSCRIPTION_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(targetStatus as InventorySubscriptionStatus)) {
      throw { status: 409, error: `Cannot transition from '${sub.status}' to '${targetStatus}'` }
    }

    const now = new Date()

    if (targetStatus === 'active' && !sub.activatedAt) {
      sub.activatedAt = now
    }
    if (targetStatus === 'suspended') {
      sub.suspendedAt = now
    }
    if (currentStatus === 'suspended' && targetStatus === 'active') {
      sub.suspendedAt = null
    }
    if (targetStatus === 'terminated') {
      sub.terminatedAt = now
    }

    const items = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      status: { $nin: ['terminated', 'expired'] },
    })
    for (const item of items) {
      item.status = targetStatus
    }

    if (targetStatus === 'active' || targetStatus === 'terminated') {
      const assetTargetStatus = targetStatus === 'terminated' ? 'cancelled' : 'active'
      const excludeStatuses = targetStatus === 'active'
        ? ['returned']
        : ['returned', 'cancelled']
      const assets = await this.em.find(CpqInventoryAsset, {
        subscriptionId: sub.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        status: { $nin: excludeStatuses },
      })
      for (const asset of assets) {
        asset.status = assetTargetStatus
      }
    }

    sub.status = targetStatus
    await this.em.flush()
    return sub
  }

  // ═══════════════════════════════════════════════════════════════
  //  Subscription Items
  // ═══════════════════════════════════════════════════════════════

  async listSubscriptionItems(filters: SubscriptionItemListFilters, scope: TenantScope) {
    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    if (filters.subscriptionId) where.subscriptionId = filters.subscriptionId
    if (filters.parentItemId) where.parentItemId = filters.parentItemId
    if (filters.status) where.status = filters.status

    return this.em.find(CpqInventorySubscriptionItem, where, {
      orderBy: { sortOrder: 'asc' },
    })
  }

  async addSubscriptionItem(subscriptionId: string, input: CreateSubscriptionItemInput, scope: TenantScope) {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id: subscriptionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }

    if (input.parentItemId) {
      const parent = await this.em.findOne(CpqInventorySubscriptionItem, {
        id: input.parentItemId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!parent) throw { status: 404, error: 'Parent item not found' }
      if (parent.subscriptionId !== subscriptionId) {
        throw { status: 409, error: 'Parent item does not belong to this subscription' }
      }
    }

    const item = this.em.create(CpqInventorySubscriptionItem, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      subscriptionId,
      customerId: sub.customerId,
      parentItemId: input.parentItemId ?? null,
      productId: input.productId ?? null,
      offeringId: input.offeringId ?? null,
      specId: input.specId ?? null,
      name: input.name,
      status: 'pending',
      configuration: input.configuration ?? {},
      charges: input.charges ?? null,
      mrcAmount: String(input.mrcAmount ?? 0),
      nrcAmount: String(input.nrcAmount ?? 0),
      currencyCode: input.currencyCode ?? sub.currencyCode,
      quantity: input.quantity ?? 1,
      capacityTotal: input.capacityTotal != null ? String(input.capacityTotal) : null,
      capacityUsed: null,
      capacityUnit: input.capacityUnit ?? null,
      sourceQuoteLineId: input.sourceQuoteLineId ?? null,
      metadata: input.metadata ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    this.em.persist(item)

    await this.em.flush()
    await this.recomputeSubscriptionAggregates(subscriptionId, scope)

    return item
  }

  async updateSubscriptionItem(id: string, updates: UpdateSubscriptionItemInput, scope: TenantScope) {
    const item = await this.em.findOne(CpqInventorySubscriptionItem, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!item) throw { status: 404, error: 'Subscription item not found' }

    if (updates.name !== undefined) item.name = updates.name
    if (updates.metadata !== undefined) item.metadata = updates.metadata
    if (updates.capacityTotal !== undefined) item.capacityTotal = updates.capacityTotal != null ? String(updates.capacityTotal) : null
    if (updates.capacityUsed !== undefined) item.capacityUsed = updates.capacityUsed != null ? String(updates.capacityUsed) : null
    if (updates.capacityUnit !== undefined) item.capacityUnit = updates.capacityUnit
    if (updates.sortOrder !== undefined) item.sortOrder = updates.sortOrder

    await this.em.flush()
    return item
  }

  async deleteSubscriptionItem(id: string, scope: TenantScope) {
    const item = await this.em.findOne(CpqInventorySubscriptionItem, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!item) throw { status: 404, error: 'Subscription item not found' }

    item.deletedAt = new Date()
    await this.em.flush()
    await this.recomputeSubscriptionAggregates(item.subscriptionId, scope)

    return { success: true }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Assets
  // ═══════════════════════════════════════════════════════════════

  async listAssets(filters: AssetListFilters, scope: TenantScope): Promise<PaginatedResult<CpqInventoryAsset>> {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
    const offset = (page - 1) * pageSize

    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }

    if (filters.customerId) where.customerId = filters.customerId
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { $in: filters.status }
        : filters.status
    }
    if (filters.assetType) where.assetType = filters.assetType
    if (filters.productId) where.productId = filters.productId
    if (filters.subscriptionId) where.subscriptionId = filters.subscriptionId
    if (filters.subscriptionItemId) where.subscriptionItemId = filters.subscriptionItemId

    const [items, total] = await this.em.findAndCount(
      CpqInventoryAsset,
      where,
      { limit: pageSize, offset, orderBy: { createdAt: 'desc' } },
    )

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async getAsset(assetId: string, scope: TenantScope) {
    const asset = await this.em.findOne(CpqInventoryAsset, {
      id: assetId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!asset) throw { status: 404, error: 'Asset not found' }
    return asset
  }

  async createAsset(input: CreateAssetInput, scope: TenantScope) {
    const code = input.code ?? await this.generateAssetCode(scope)

    if (input.subscriptionId) {
      const sub = await this.em.findOne(CpqInventorySubscription, {
        id: input.subscriptionId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!sub) throw { status: 404, error: 'Subscription not found' }
    }

    if (input.subscriptionItemId) {
      const item = await this.em.findOne(CpqInventorySubscriptionItem, {
        id: input.subscriptionItemId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!item) throw { status: 404, error: 'Subscription item not found' }
    }

    const asset = this.em.create(CpqInventoryAsset, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId ?? null,
      subscriptionItemId: input.subscriptionItemId ?? null,
      productId: input.productId ?? null,
      offeringId: input.offeringId ?? null,
      specId: input.specId ?? null,
      code,
      name: input.name,
      description: input.description ?? null,
      status: 'pending',
      assetType: input.assetType ?? 'one_time',
      currencyCode: input.currencyCode ?? await getBaseCurrencyCode(this.em, scope),
      purchasePrice: String(input.purchasePrice ?? 0),
      quantity: input.quantity ?? 1,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
      deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
      configuration: input.configuration ?? {},
      charges: input.charges ?? null,
      sourceQuoteId: input.sourceQuoteId ?? null,
      sourceOrderId: input.sourceOrderId ?? null,
      sourceQuoteLineId: input.sourceQuoteLineId ?? null,
      metadata: input.metadata ?? null,
    })
    this.em.persist(asset)

    await this.em.flush()
    return asset
  }

  async updateAsset(id: string, updates: UpdateAssetInput, scope: TenantScope) {
    const asset = await this.em.findOne(CpqInventoryAsset, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!asset) throw { status: 404, error: 'Asset not found' }

    if (updates.name !== undefined) asset.name = updates.name
    if (updates.description !== undefined) asset.description = updates.description
    if (updates.assetType !== undefined) asset.assetType = updates.assetType
    if (updates.deliveryDate !== undefined) asset.deliveryDate = updates.deliveryDate ? new Date(updates.deliveryDate) : null
    if (updates.metadata !== undefined) asset.metadata = updates.metadata

    await this.em.flush()
    return asset
  }

  async deleteAsset(id: string, scope: TenantScope) {
    const asset = await this.em.findOne(CpqInventoryAsset, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!asset) throw { status: 404, error: 'Asset not found' }

    asset.deletedAt = new Date()
    await this.em.flush()
    return { success: true }
  }

  async transitionAssetStatus(id: string, targetStatus: string, scope: TenantScope) {
    const asset = await this.em.findOne(CpqInventoryAsset, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!asset) throw { status: 404, error: 'Asset not found' }

    const currentStatus = asset.status as InventoryAssetStatus
    const allowed = INVENTORY_ASSET_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(targetStatus as InventoryAssetStatus)) {
      throw { status: 409, error: `Cannot transition from '${asset.status}' to '${targetStatus}'` }
    }

    asset.status = targetStatus
    await this.em.flush()
    return asset
  }

  // ═══════════════════════════════════════════════════════════════
  //  Customer View
  // ═══════════════════════════════════════════════════════════════

  async getCustomerInventory(customerId: string, filters: CustomerInventoryFilters, scope: TenantScope) {
    const baseWhere: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      customerId,
    }

    const subTerminalStatuses = ['terminated', 'expired']
    const itemTerminalStatuses = ['terminated', 'expired']
    const assetTerminalStatuses = ['returned']

    const subWhere: Record<string, unknown> = { ...baseWhere }
    const itemWhere: Record<string, unknown> = { ...baseWhere }
    const assetWhere: Record<string, unknown> = { ...baseWhere }

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
      subWhere.status = { $in: statuses }
      itemWhere.status = { $in: statuses }
      assetWhere.status = { $in: statuses }
    } else if (!filters.includeTerminated) {
      subWhere.status = { $nin: subTerminalStatuses }
      itemWhere.status = { $nin: itemTerminalStatuses }
      assetWhere.status = { $nin: assetTerminalStatuses }
    }

    if (filters.productId) {
      subWhere.id = { $in: await this.subscriptionIdsForProduct(filters.productId, scope) }
      itemWhere.productId = filters.productId
      assetWhere.productId = filters.productId
    }

    const [subscriptions, subscriptionItems, assets] = await Promise.all([
      this.em.find(CpqInventorySubscription, subWhere, { orderBy: { createdAt: 'desc' } }),
      this.em.find(CpqInventorySubscriptionItem, itemWhere, { orderBy: { sortOrder: 'asc' } }),
      this.em.find(CpqInventoryAsset, assetWhere, { orderBy: { createdAt: 'desc' } }),
    ])

    const activeSubscriptions = subscriptions.filter((s) => s.status === 'active').length
    const totalMrc = subscriptions
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + Number(s.mrcAmount), 0)
    const activeAssets = assets.filter((a) => a.status === 'active').length
    const pendingItems = subscriptionItems.filter((i) => i.status === 'pending').length

    const currencyCode = subscriptions[0]?.currencyCode ?? assets[0]?.currencyCode ?? await getBaseCurrencyCode(this.em, scope)

    return {
      customerId,
      subscriptions,
      subscriptionItems,
      assets,
      summary: {
        activeSubscriptions,
        totalMrc,
        activeAssets,
        pendingItems,
        currencyCode,
      },
    }
  }

  async getCustomerParentItems(
    customerId: string,
    filters: { productId?: string; offeringId?: string },
    scope: TenantScope,
  ) {
    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      customerId,
      parentItemId: null,
      status: 'active',
    }

    if (filters.productId) where.productId = filters.productId
    if (filters.offeringId) where.offeringId = filters.offeringId

    return this.em.find(CpqInventorySubscriptionItem, where, {
      orderBy: { sortOrder: 'asc' },
    })
  }

  // ═══════════════════════════════════════════════════════════════
  //  Private helpers
  // ═══════════════════════════════════════════════════════════════

  private async recomputeSubscriptionAggregates(subscriptionId: string, scope: TenantScope) {
    const items = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })

    const mrcSum = items.reduce((s, i) => s + Number(i.mrcAmount), 0)
    const nrcSum = items.reduce((s, i) => s + Number(i.nrcAmount), 0)

    const sub = await this.em.findOne(CpqInventorySubscription, {
      id: subscriptionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (sub) {
      sub.mrcAmount = String(mrcSum)
      sub.nrcAmount = String(nrcSum)
      await this.em.flush()
    }
  }

  private buildItemTree(items: CpqInventorySubscriptionItem[]): SubscriptionItemResultNode[] {
    const nodeMap = new Map<string, SubscriptionItemResultNode>()

    for (const item of items) {
      nodeMap.set(item.id, {
        id: item.id,
        subscriptionId: item.subscriptionId,
        parentItemId: item.parentItemId ?? null,
        productId: item.productId ?? null,
        offeringId: item.offeringId ?? null,
        specId: item.specId ?? null,
        name: item.name,
        status: item.status,
        configuration: item.configuration ?? {},
        charges: item.charges ?? null,
        mrcAmount: Number(item.mrcAmount),
        nrcAmount: Number(item.nrcAmount),
        currencyCode: item.currencyCode,
        quantity: item.quantity,
        capacityTotal: item.capacityTotal != null ? Number(item.capacityTotal) : null,
        capacityUsed: item.capacityUsed != null ? Number(item.capacityUsed) : null,
        capacityUnit: item.capacityUnit ?? null,
        metadata: item.metadata ?? null,
        sortOrder: item.sortOrder,
        children: [],
      })
    }

    const roots: SubscriptionItemResultNode[] = []

    for (const node of nodeMap.values()) {
      if (node.parentItemId && nodeMap.has(node.parentItemId)) {
        nodeMap.get(node.parentItemId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return roots
  }

  private async generateSubscriptionCode(scope: TenantScope): Promise<string> {
    const year = new Date().getFullYear()
    const count = await this.em.count(CpqInventorySubscription, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const seq = String(count + 1).padStart(5, '0')
    return `SUB-${year}-${seq}`
  }

  private async generateAssetCode(scope: TenantScope): Promise<string> {
    const year = new Date().getFullYear()
    const count = await this.em.count(CpqInventoryAsset, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const seq = String(count + 1).padStart(5, '0')
    return `AST-${year}-${seq}`
  }

  private async subscriptionIdsForProduct(productId: string, scope: TenantScope): Promise<string[]> {
    const items = await this.em.find(
      CpqInventorySubscriptionItem,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        productId,
      },
      { fields: ['subscriptionId'] as const },
    )
    return [...new Set(items.map((i) => i.subscriptionId))]
  }
}
