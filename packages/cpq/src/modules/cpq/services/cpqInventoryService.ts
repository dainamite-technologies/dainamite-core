import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqInventoryAsset,
  CpqProductSpecification,
  CpqSubscriptionChangeLog,
} from '../data/entities'
import {
  INVENTORY_SUBSCRIPTION_TRANSITIONS,
  INVENTORY_ASSET_TRANSITIONS,
  getBaseCurrencyCode,
  type ChangeLogType,
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
  billingCycle?: string
  search?: string
  sortField?: 'createdAt' | 'updatedAt' | 'code' | 'name' | 'status' | 'startDate' | 'currentTermEnd'
  sortDir?: 'asc' | 'desc'
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
  search?: string
  sortField?: 'createdAt' | 'updatedAt' | 'code' | 'name' | 'status' | 'assetType' | 'purchasePrice'
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

interface CustomerInventoryFilters {
  status?: string | string[]
  productId?: string
  includeTerminated?: boolean
}

// ─── ARC (Amend / Renew / Cancel) — XD-250 input shapes ─────────

export type ArcLineAction = 'add' | 'modify' | 'cancel'

export interface ArcLineChange {
  /** Source quote line id (for traceability + sourceQuoteLineId on items). */
  quoteLineId?: string | null
  action: ArcLineAction
  /** Required for action ∈ {cancel, modify}. */
  sourceSubscriptionItemId?: string | null
  /** Required for action='add'. Used to materialize the new item. */
  itemInput?: Omit<CreateSubscriptionItemInput, 'name'> & { name: string }
  /** XD-250 ARC: source quote line's `parentLineId`. When set, applyLineChanges
   * resolves the resulting `parentItemId` on the new sub item — either from
   * the parent's `sourceSubscriptionItemId` (if parent is a modify line) or
   * from another `add` line's pre-generated id (if parent is also brand new
   * in this apply). Without this, bundle children added through ARC are
   * created as standalone sub items, not nested under the bundle. */
  parentQuoteLineId?: string | null
  /** Optional metadata for action='modify' — the configuration / pricing changes. */
  modifyPatch?: {
    configuration?: Record<string, unknown>
    charges?: Array<Record<string, unknown>>
    mrcAmount?: number
    nrcAmount?: number
    quantity?: number
  }
}

export interface ArcTermInput {
  newTermStart: Date | string
  newTermEnd: Date | string
  newTermMonths?: number | null
}

export interface ArcMergeMeta {
  newSubCode?: string | null
  newSubName?: string | null
}

export interface ApplyAmendmentInput {
  subscriptionId: string
  lineChanges: ArcLineChange[]
  sourceQuoteId: string
  sourceOrderId: string
  performedByUserId?: string | null
}

export interface ApplyRenewalInput extends ApplyAmendmentInput {
  term: ArcTermInput
}

export interface ApplyMergeRenewalInput {
  sourceIds: string[]
  term: ArcTermInput
  mergeMeta: ArcMergeMeta
  lineChanges: ArcLineChange[]
  sourceQuoteId: string
  sourceOrderId: string
  performedByUserId?: string | null
}

export interface ApplyCancelInput {
  subscriptionId: string
  sourceQuoteId: string
  sourceOrderId: string
  performedByUserId?: string | null
  etfAmount?: number | string | null
  etfCurrency?: string | null
  reasonCode?: string | null
  reasonText?: string | null
}

export interface ApplyArcResult {
  changeLog: CpqSubscriptionChangeLog
  /** Subscription as left after mutation (for amend / renew / cancel) or M (for merge-result). */
  subscription: CpqInventorySubscription
}

export interface ApplyMergeRenewalResult {
  /** The new merge sub M. */
  mergedSubscription: CpqInventorySubscription
  /** The merge-result ChangeLog row (on M). */
  mergeResultChangeLog: CpqSubscriptionChangeLog
  /** One per source — change_type='merge-source'. */
  sourceChangeLogs: CpqSubscriptionChangeLog[]
}

export interface CreateSubscriptionInput {
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

export interface CreateSubscriptionItemInput {
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
    if (filters.billingCycle) where.billingCycle = filters.billingCycle
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { $in: filters.status }
        : filters.status
    }

    const search = filters.search?.trim()
    if (search) {
      where.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
      ]
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

    const sortField = filters.sortField ?? 'createdAt'
    const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'

    const [items, total] = await this.em.findAndCount(
      CpqInventorySubscription,
      where,
      { limit: pageSize, offset, orderBy: { [sortField]: sortDir } },
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
    if (targetStatus === 'terminated' || targetStatus === 'superseded') {
      sub.terminatedAt = now
    }

    const items = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      status: { $nin: ['terminated', 'expired', 'superseded'] },
    })
    for (const item of items) {
      item.status = targetStatus
    }

    if (targetStatus === 'active' || targetStatus === 'terminated' || targetStatus === 'superseded') {
      const assetTargetStatus = targetStatus === 'active' ? 'active' : 'cancelled'
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

    const search = filters.search?.trim()
    if (search) {
      where.$or = [
        { code: { $ilike: `%${search}%` } },
        { name: { $ilike: `%${search}%` } },
      ]
    }

    const sortField = filters.sortField ?? 'createdAt'
    const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'

    const [items, total] = await this.em.findAndCount(
      CpqInventoryAsset,
      where,
      { limit: pageSize, offset, orderBy: { [sortField]: sortDir } },
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
  //  ARC (Amend / Renew / Cancel) — XD-250
  //
  //  Mutate-in-place primitives invoked by cpqOrderService.activateOrder
  //  per attached target subscription. Each method:
  //    • is idempotent on (sourceOrderId, subscriptionId), enforced via the
  //      DB-level UNIQUE on cpq_subscription_change_logs;
  //    • takes optimistic lock on subscription.version (MikroORM auto-bumps);
  //    • writes a CpqSubscriptionChangeLog row and updates
  //      subscription.lastChangeLogId.
  //
  //  Event emission is the caller's job (centralized in cpqOrderService
  //  AFTER the activation transaction commits).
  // ═══════════════════════════════════════════════════════════════

  async findExpiringSubscriptions(
    filters: {
      withinDays?: number
      customerId?: string
      billingCycle?: string
      status?: string
      page?: number
      pageSize?: number
    },
    scope: TenantScope,
  ): Promise<PaginatedResult<CpqInventorySubscription>> {
    const withinDays = Math.min(365, Math.max(1, filters.withinDays ?? 30))
    const status = filters.status ?? 'active'
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
    const offset = (page - 1) * pageSize

    const now = new Date()
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)

    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      status,
      currentTermEnd: { $gte: now, $lte: horizon },
    }
    if (filters.customerId) where.customerId = filters.customerId
    if (filters.billingCycle) where.billingCycle = filters.billingCycle

    const [items, total] = await this.em.findAndCount(
      CpqInventorySubscription,
      where,
      { limit: pageSize, offset, orderBy: { currentTermEnd: 'asc' } },
    )

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  async listChangeLog(
    subscriptionId: string,
    filters: { page?: number; pageSize?: number },
    scope: TenantScope,
  ): Promise<PaginatedResult<CpqSubscriptionChangeLog>> {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50))
    const offset = (page - 1) * pageSize

    const where = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      subscriptionId,
    }

    const [items, total] = await this.em.findAndCount(
      CpqSubscriptionChangeLog,
      where,
      { limit: pageSize, offset, orderBy: { createdAt: 'desc' } },
    )

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  async applyAmendment(input: ApplyAmendmentInput, scope: TenantScope): Promise<ApplyArcResult> {
    const idempotent = await this.findIdempotentChangeLog(
      input.sourceOrderId,
      input.subscriptionId,
      scope,
    )
    if (idempotent) {
      const sub = await this.requireSubscription(input.subscriptionId, scope)
      return { changeLog: idempotent, subscription: sub }
    }

    const sub = await this.requireSubscription(input.subscriptionId, scope)
    const beforeSnapshot = await this.snapshotSubscription(sub, scope)

    const { lineChangeSummary } = await this.applyLineChanges(
      sub,
      input.lineChanges,
      scope,
      null,
    )

    await this.recomputeSubscriptionAggregatesInPlace(sub, scope)

    await this.em.flush()

    const afterSnapshot = await this.snapshotSubscription(sub, scope)

    const log = this.createChangeLog({
      subscription: sub,
      changeType: 'amend',
      sourceQuoteId: input.sourceQuoteId,
      sourceOrderId: input.sourceOrderId,
      performedByUserId: input.performedByUserId,
      beforeSnapshot,
      afterSnapshot,
      lineChanges: lineChangeSummary,
    })

    sub.lastChangeLogId = log.id
    await this.em.flush()

    return { changeLog: log, subscription: sub }
  }

  async applyRenewal(input: ApplyRenewalInput, scope: TenantScope): Promise<ApplyArcResult> {
    const idempotent = await this.findIdempotentChangeLog(
      input.sourceOrderId,
      input.subscriptionId,
      scope,
    )
    if (idempotent) {
      const sub = await this.requireSubscription(input.subscriptionId, scope)
      return { changeLog: idempotent, subscription: sub }
    }

    const sub = await this.requireSubscription(input.subscriptionId, scope)
    const beforeSnapshot = await this.snapshotSubscription(sub, scope)
    const oldTermStart = sub.currentTermStart
    const oldTermEnd = sub.currentTermEnd
    const oldTermMonths = sub.termMonths

    const newStart = toDate(input.term.newTermStart)
    const newEnd = toDate(input.term.newTermEnd)
    sub.currentTermStart = newStart
    sub.currentTermEnd = newEnd
    if (input.term.newTermMonths != null) sub.termMonths = input.term.newTermMonths

    const { lineChangeSummary } = await this.applyLineChanges(
      sub,
      input.lineChanges,
      scope,
      null,
    )

    await this.recomputeSubscriptionAggregatesInPlace(sub, scope)

    await this.em.flush()

    const afterSnapshot = await this.snapshotSubscription(sub, scope)

    const log = this.createChangeLog({
      subscription: sub,
      changeType: 'renew',
      sourceQuoteId: input.sourceQuoteId,
      sourceOrderId: input.sourceOrderId,
      performedByUserId: input.performedByUserId,
      beforeSnapshot,
      afterSnapshot,
      lineChanges: lineChangeSummary,
      termChange: {
        oldTermStart: toIsoOrNull(oldTermStart),
        newTermStart: newStart.toISOString(),
        oldTermEnd: toIsoOrNull(oldTermEnd),
        newTermEnd: newEnd.toISOString(),
        oldTermMonths: oldTermMonths ?? null,
        newTermMonths: input.term.newTermMonths ?? oldTermMonths ?? null,
      },
    })

    sub.lastChangeLogId = log.id
    await this.em.flush()

    return { changeLog: log, subscription: sub }
  }

  async applyMergeRenewal(
    input: ApplyMergeRenewalInput,
    scope: TenantScope,
  ): Promise<ApplyMergeRenewalResult> {
    if (input.sourceIds.length < 2) {
      throw { status: 400, error: 'Merge requires at least two source subscriptions' }
    }

    // Idempotency: if every source already has a merge-source ChangeLog row
    // for this order, the merge has been applied — re-fetch and return.
    const existingSourceLogs = await this.em.find(CpqSubscriptionChangeLog, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      sourceOrderId: input.sourceOrderId,
      subscriptionId: { $in: input.sourceIds },
      changeType: 'merge-source',
    })
    if (existingSourceLogs.length === input.sourceIds.length) {
      const mergeResult = await this.em.findOne(CpqSubscriptionChangeLog, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        sourceOrderId: input.sourceOrderId,
        changeType: 'merge-result',
      })
      if (mergeResult) {
        const m = await this.requireSubscription(mergeResult.subscriptionId, scope)
        return {
          mergedSubscription: m,
          mergeResultChangeLog: mergeResult,
          sourceChangeLogs: existingSourceLogs,
        }
      }
    }

    // Validate sources: same customer/currency/billingCycle, all in {active, suspended}.
    const sources = await this.em.find(CpqInventorySubscription, {
      id: { $in: input.sourceIds },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (sources.length !== input.sourceIds.length) {
      throw { status: 404, error: 'One or more source subscriptions not found' }
    }
    const customers = new Set(sources.map((s) => s.customerId))
    const currencies = new Set(sources.map((s) => s.currencyCode))
    const cycles = new Set(sources.map((s) => s.billingCycle))
    if (customers.size > 1 || currencies.size > 1 || cycles.size > 1) {
      throw {
        status: 400,
        error: 'Merge sources must share customer, currency, and billing cycle',
      }
    }
    for (const s of sources) {
      if (s.status !== 'active' && s.status !== 'suspended') {
        throw {
          status: 409,
          error: `Source subscription ${s.id} is in '${s.status}' status — must be active or suspended to merge`,
        }
      }
    }

    const customerId = sources[0].customerId
    const currencyCode = sources[0].currencyCode
    const billingCycle = sources[0].billingCycle

    const beforeSnapshots = new Map<string, Record<string, unknown>>()
    for (const s of sources) {
      beforeSnapshots.set(s.id, await this.snapshotSubscription(s, scope))
    }

    // Create the new merge sub M.
    const newTermStart = toDate(input.term.newTermStart)
    const newTermEnd = toDate(input.term.newTermEnd)
    const code =
      input.mergeMeta.newSubCode ?? (await this.generateSubscriptionCode(scope))
    const name = input.mergeMeta.newSubName ?? `Merged contract`

    // Pre-generate id so child rows referenced before flush (carry-over items
    // FK to subscriptionId, asset migration FK update) don't depend on the
    // intervening flush() to populate it. Matches the createSubscription pattern.
    const newSubId = crypto.randomUUID()
    const m = this.em.create(CpqInventorySubscription, {
      id: newSubId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      customerId,
      code,
      name,
      status: 'active',
      billingCycle,
      currencyCode,
      mrcAmount: '0',
      nrcAmount: '0',
      currentTermStart: newTermStart,
      currentTermEnd: newTermEnd,
      termMonths: input.term.newTermMonths ?? null,
      autoRenew: true,
      activatedAt: new Date(),
      sourceQuoteId: input.sourceQuoteId,
      sourceOrderId: input.sourceOrderId,
    })
    this.em.persist(m)
    await this.em.flush()

    // Carry-over phase: clone every source's active items onto M.
    // Build sourceItemId → newItemIdOnM map for line resolution.
    const sourceItemToNewItem = new Map<string, string>()

    for (const source of sources) {
      const activeItems = await this.em.find(CpqInventorySubscriptionItem, {
        subscriptionId: source.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        status: { $nin: ['terminated', 'expired', 'superseded'] },
      })
      for (const item of activeItems) {
        // Pre-generate the cloned item id — `defaultRaw: 'gen_random_uuid()'`
        // only fires at INSERT, so without this `cloned.id` is undefined right
        // after em.create(). Then `sourceItemToNewItem.set(item.id, cloned.id)`
        // would store undefined and the line-change translation below would
        // fall back to the source-sub item id, which doesn't exist on the new
        // merged sub M → applyLineChanges throws 404 at activation.
        const clonedId = crypto.randomUUID()
        const cloned = this.em.create(CpqInventorySubscriptionItem, {
          id: clonedId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          subscriptionId: m.id,
          customerId,
          parentItemId: null,
          productId: item.productId ?? null,
          offeringId: item.offeringId ?? null,
          specId: item.specId ?? null,
          name: item.name,
          status: 'active',
          configuration: { ...item.configuration },
          charges: item.charges ? [...item.charges] : null,
          mrcAmount: item.mrcAmount,
          nrcAmount: item.nrcAmount,
          currencyCode: item.currencyCode,
          quantity: item.quantity,
          capacityTotal: item.capacityTotal,
          capacityUsed: item.capacityUsed,
          capacityUnit: item.capacityUnit,
          // Carry-over marker: sourceQuoteLineId stays null so the operator can
          // distinguish from operator-add lines later.
          sourceQuoteLineId: null,
          metadata: item.metadata,
          sortOrder: item.sortOrder,
        })
        this.em.persist(cloned)
        sourceItemToNewItem.set(item.id, clonedId)
      }
    }
    await this.em.flush()

    // Migrate assets: every source's assets switch FK to M (and to the new
    // item id mapped from the original source item id).
    for (const source of sources) {
      const assets = await this.em.find(CpqInventoryAsset, {
        subscriptionId: source.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        status: { $nin: ['returned', 'cancelled'] },
      })
      for (const asset of assets) {
        asset.subscriptionId = m.id
        if (asset.subscriptionItemId) {
          const newItemId = sourceItemToNewItem.get(asset.subscriptionItemId)
          if (newItemId) asset.subscriptionItemId = newItemId
        }
      }
    }
    await this.em.flush()

    // Operator-edit phase: apply lineChanges on M's combined item set.
    // For cancel/modify lines, sourceSubscriptionItemId references an item on
    // one of the source subs — translate to the corresponding new item on M.
    const translatedChanges: ArcLineChange[] = input.lineChanges.map((lc) => {
      if (
        (lc.action === 'cancel' || lc.action === 'modify') &&
        lc.sourceSubscriptionItemId
      ) {
        const newItemId = sourceItemToNewItem.get(lc.sourceSubscriptionItemId)
        return {
          ...lc,
          sourceSubscriptionItemId: newItemId ?? lc.sourceSubscriptionItemId,
        }
      }
      return lc
    })

    const { lineChangeSummary } = await this.applyLineChanges(
      m,
      translatedChanges,
      scope,
      null,
    )

    await this.recomputeSubscriptionAggregatesInPlace(m, scope)
    await this.em.flush()

    const afterSnapshot = await this.snapshotSubscription(m, scope)

    // Retire each source: status='superseded', mergedIntoSubscriptionId=M.id,
    // items cascaded to 'superseded'.
    const sourceLogs: CpqSubscriptionChangeLog[] = []
    const now = new Date()
    for (const source of sources) {
      const items = await this.em.find(CpqInventorySubscriptionItem, {
        subscriptionId: source.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        status: { $nin: ['terminated', 'expired', 'superseded'] },
      })
      for (const item of items) {
        item.status = 'superseded'
      }
      source.status = 'superseded'
      source.mergedIntoSubscriptionId = m.id
      source.terminatedAt = now
      // Recompute aggregates: source has no active items left.
      source.mrcAmount = '0'

      const sourceLog = this.createChangeLog({
        subscription: source,
        changeType: 'merge-source',
        sourceQuoteId: input.sourceQuoteId,
        sourceOrderId: input.sourceOrderId,
        performedByUserId: input.performedByUserId,
        beforeSnapshot: beforeSnapshots.get(source.id) ?? null,
        // afterSnapshot intentionally null — terminal state IS the meaningful "after".
        afterSnapshot: null,
        lineChanges: null,
        mergedIntoSubscriptionId: m.id,
      })
      source.lastChangeLogId = sourceLog.id
      sourceLogs.push(sourceLog)
    }

    const mergeResultLog = this.createChangeLog({
      subscription: m,
      changeType: 'merge-result',
      sourceQuoteId: input.sourceQuoteId,
      sourceOrderId: input.sourceOrderId,
      performedByUserId: input.performedByUserId,
      beforeSnapshot: null, // M is brand new — no "before" state.
      afterSnapshot,
      lineChanges: lineChangeSummary,
      termChange: {
        oldTermStart: null,
        newTermStart: newTermStart.toISOString(),
        oldTermEnd: null,
        newTermEnd: newTermEnd.toISOString(),
        oldTermMonths: null,
        newTermMonths: input.term.newTermMonths ?? null,
      },
      mergedFromSubscriptionIds: input.sourceIds,
    })
    m.lastChangeLogId = mergeResultLog.id

    await this.em.flush()

    return {
      mergedSubscription: m,
      mergeResultChangeLog: mergeResultLog,
      sourceChangeLogs: sourceLogs,
    }
  }

  async applyCancel(input: ApplyCancelInput, scope: TenantScope): Promise<ApplyArcResult> {
    const idempotent = await this.findIdempotentChangeLog(
      input.sourceOrderId,
      input.subscriptionId,
      scope,
    )
    if (idempotent) {
      const sub = await this.requireSubscription(input.subscriptionId, scope)
      return { changeLog: idempotent, subscription: sub }
    }

    const sub = await this.requireSubscription(input.subscriptionId, scope)
    if (sub.status !== 'active' && sub.status !== 'suspended') {
      throw {
        status: 409,
        error: `Cannot cancel subscription in '${sub.status}' status`,
      }
    }
    const beforeSnapshot = await this.snapshotSubscription(sub, scope)

    // Reuse the existing cascade. transitionSubscriptionStatus flushes; that's
    // fine — we'll snapshot again afterwards.
    await this.transitionSubscriptionStatus(sub.id, 'terminated', scope)

    const reload = await this.requireSubscription(input.subscriptionId, scope)
    const afterSnapshot = await this.snapshotSubscription(reload, scope)

    const log = this.createChangeLog({
      subscription: reload,
      changeType: 'cancel',
      sourceQuoteId: input.sourceQuoteId,
      sourceOrderId: input.sourceOrderId,
      performedByUserId: input.performedByUserId,
      beforeSnapshot,
      afterSnapshot,
      lineChanges: null,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      etfAmount: input.etfAmount != null ? String(input.etfAmount) : null,
      etfCurrency: input.etfCurrency ?? null,
    })

    reload.lastChangeLogId = log.id
    await this.em.flush()

    return { changeLog: log, subscription: reload }
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

  // ─── ARC private helpers (XD-250) ────────────────────────────────

  private async requireSubscription(
    id: string,
    scope: TenantScope,
  ): Promise<CpqInventorySubscription> {
    const sub = await this.em.findOne(CpqInventorySubscription, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    if (!sub) throw { status: 404, error: 'Subscription not found' }
    return sub
  }

  private async findIdempotentChangeLog(
    sourceOrderId: string | null | undefined,
    subscriptionId: string,
    scope: TenantScope,
  ): Promise<CpqSubscriptionChangeLog | null> {
    if (!sourceOrderId) return null
    return this.em.findOne(CpqSubscriptionChangeLog, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      sourceOrderId,
      subscriptionId,
    })
  }

  private async snapshotSubscription(
    sub: CpqInventorySubscription,
    scope: TenantScope,
  ): Promise<Record<string, unknown>> {
    const items = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    const assets = await this.em.find(CpqInventoryAsset, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    return {
      id: sub.id,
      code: sub.code,
      name: sub.name,
      status: sub.status,
      billingCycle: sub.billingCycle,
      currencyCode: sub.currencyCode,
      mrcAmount: sub.mrcAmount,
      nrcAmount: sub.nrcAmount,
      currentTermStart: toIsoOrNull(sub.currentTermStart),
      currentTermEnd: toIsoOrNull(sub.currentTermEnd),
      termMonths: sub.termMonths ?? null,
      version: sub.version,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        offeringId: i.offeringId,
        specId: i.specId,
        name: i.name,
        status: i.status,
        configuration: i.configuration,
        mrcAmount: i.mrcAmount,
        nrcAmount: i.nrcAmount,
        currencyCode: i.currencyCode,
        quantity: i.quantity,
        sourceQuoteLineId: i.sourceQuoteLineId,
      })),
      assets: assets.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        status: a.status,
        subscriptionItemId: a.subscriptionItemId,
        productId: a.productId,
      })),
    }
  }

  /**
   * Apply ARC line changes to a subscription's item set in place.
   * Returns a per-line summary ready to write into ChangeLog.line_changes.
   */
  private async applyLineChanges(
    sub: CpqInventorySubscription,
    lineChanges: ArcLineChange[],
    scope: TenantScope,
    _ignored: null,
  ): Promise<{ lineChangeSummary: Array<Record<string, unknown>> }> {
    void _ignored

    const summary: Array<Record<string, unknown>> = []
    if (lineChanges.length === 0) return { lineChangeSummary: summary }

    // Pre-load assetizable specs for new items to decide whether to materialize
    // assets on add lines.
    const specIdsForAdd = new Set<string>()
    for (const lc of lineChanges) {
      if (lc.action === 'add' && lc.itemInput?.specId) {
        specIdsForAdd.add(lc.itemInput.specId)
      }
    }
    const assetizableSpecs = new Map<string, boolean>()
    if (specIdsForAdd.size > 0) {
      const specs = await this.em.find(CpqProductSpecification, {
        id: { $in: Array.from(specIdsForAdd) },
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      for (const s of specs) assetizableSpecs.set(s.id, s.isAssetizable === true)
    }

    // XD-250 ARC: build quoteLineId → resulting subscriptionItemId map up-front
    // so `add` lines can resolve their parentItemId regardless of the order
    // their parent appears in `lineChanges`. For 'modify' the parent already
    // exists (its sourceSubscriptionItemId is the answer); for sibling 'add'
    // lines we pre-generate the new item id.
    const quoteLineToFinalItemId = new Map<string, string>()
    const preGeneratedAddIds = new Map<string, string>()
    for (const lc of lineChanges) {
      if (!lc.quoteLineId) continue
      if (lc.action === 'add') {
        const id = crypto.randomUUID()
        preGeneratedAddIds.set(lc.quoteLineId, id)
        quoteLineToFinalItemId.set(lc.quoteLineId, id)
      } else if (lc.action === 'modify' && lc.sourceSubscriptionItemId) {
        quoteLineToFinalItemId.set(lc.quoteLineId, lc.sourceSubscriptionItemId)
      }
    }

    for (const lc of lineChanges) {
      if (lc.action === 'add') {
        if (!lc.itemInput) {
          throw { status: 400, error: 'add line is missing itemInput' }
        }
        // Pre-generated id — `defaultRaw: 'gen_random_uuid()'` only fires at
        // INSERT, so without this `item.id` is undefined between em.create()
        // and em.flush(). That breaks: (a) the asset row that references
        // `subscriptionItemId: item.id`, (b) the change-log `itemId` (which
        // the UI joins against the after-snapshot to resolve names), and
        // (c) the parentItemId resolution for sibling `add` children.
        const newItemId = lc.quoteLineId
          ? preGeneratedAddIds.get(lc.quoteLineId) ?? crypto.randomUUID()
          : crypto.randomUUID()
        const parentItemId =
          lc.itemInput.parentItemId ??
          (lc.parentQuoteLineId
            ? quoteLineToFinalItemId.get(lc.parentQuoteLineId) ?? null
            : null)
        const item = this.em.create(CpqInventorySubscriptionItem, {
          id: newItemId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          parentItemId,
          productId: lc.itemInput.productId ?? null,
          offeringId: lc.itemInput.offeringId ?? null,
          specId: lc.itemInput.specId ?? null,
          name: lc.itemInput.name,
          status: 'active',
          configuration: lc.itemInput.configuration ?? {},
          charges: lc.itemInput.charges ?? null,
          mrcAmount: String(lc.itemInput.mrcAmount ?? 0),
          nrcAmount: String(lc.itemInput.nrcAmount ?? 0),
          currencyCode: lc.itemInput.currencyCode ?? sub.currencyCode,
          quantity: lc.itemInput.quantity ?? 1,
          capacityTotal:
            lc.itemInput.capacityTotal != null ? String(lc.itemInput.capacityTotal) : null,
          capacityUsed: null,
          capacityUnit: lc.itemInput.capacityUnit ?? null,
          sourceQuoteLineId: lc.quoteLineId ?? lc.itemInput.sourceQuoteLineId ?? null,
          metadata: lc.itemInput.metadata ?? null,
          sortOrder: lc.itemInput.sortOrder ?? 0,
        })
        this.em.persist(item)

        // Materialize a pending asset only when the spec is assetizable.
        if (lc.itemInput.specId && assetizableSpecs.get(lc.itemInput.specId)) {
          const code = await this.generateAssetCode(scope)
          const asset = this.em.create(CpqInventoryAsset, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            customerId: sub.customerId,
            subscriptionId: sub.id,
            subscriptionItemId: item.id,
            productId: lc.itemInput.productId ?? null,
            offeringId: lc.itemInput.offeringId ?? null,
            specId: lc.itemInput.specId,
            code,
            name: lc.itemInput.name,
            status: 'pending',
            assetType: 'one_time',
            currencyCode: lc.itemInput.currencyCode ?? sub.currencyCode,
            purchasePrice: String(lc.itemInput.nrcAmount ?? 0),
            quantity: lc.itemInput.quantity ?? 1,
            configuration: lc.itemInput.configuration ?? {},
            charges: lc.itemInput.charges ?? null,
            sourceOrderId: null,
            sourceQuoteLineId: lc.quoteLineId ?? null,
          })
          this.em.persist(asset)
        }

        summary.push({
          action: 'add',
          itemId: item.id,
          quoteLineId: lc.quoteLineId ?? null,
          mrcAmount: Number(item.mrcAmount),
          nrcAmount: Number(item.nrcAmount),
          quantity: item.quantity,
        })
      } else if (lc.action === 'cancel') {
        if (!lc.sourceSubscriptionItemId) {
          throw { status: 400, error: 'cancel line is missing sourceSubscriptionItemId' }
        }
        const item = await this.em.findOne(CpqInventorySubscriptionItem, {
          id: lc.sourceSubscriptionItemId,
          subscriptionId: sub.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
        if (!item) {
          throw {
            status: 404,
            error: `Subscription item ${lc.sourceSubscriptionItemId} not found on subscription ${sub.id}`,
          }
        }
        item.status = 'terminated'

        // Cancel any active assets attached to this item.
        const assets = await this.em.find(CpqInventoryAsset, {
          subscriptionItemId: item.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
          status: { $nin: ['returned', 'cancelled'] },
        })
        for (const asset of assets) asset.status = 'cancelled'

        summary.push({
          action: 'cancel',
          itemId: item.id,
          quoteLineId: lc.quoteLineId ?? null,
          mrcDelta: -Number(item.mrcAmount),
        })
      } else if (lc.action === 'modify') {
        if (!lc.sourceSubscriptionItemId) {
          throw { status: 400, error: 'modify line is missing sourceSubscriptionItemId' }
        }
        const item = await this.em.findOne(CpqInventorySubscriptionItem, {
          id: lc.sourceSubscriptionItemId,
          subscriptionId: sub.id,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
        if (!item) {
          throw {
            status: 404,
            error: `Subscription item ${lc.sourceSubscriptionItemId} not found on subscription ${sub.id}`,
          }
        }
        const oldMrc = Number(item.mrcAmount)
        if (lc.modifyPatch?.configuration !== undefined) {
          item.configuration = lc.modifyPatch.configuration
        }
        if (lc.modifyPatch?.charges !== undefined) {
          item.charges = lc.modifyPatch.charges
        }
        if (lc.modifyPatch?.mrcAmount !== undefined) {
          item.mrcAmount = String(lc.modifyPatch.mrcAmount)
        }
        if (lc.modifyPatch?.nrcAmount !== undefined) {
          item.nrcAmount = String(lc.modifyPatch.nrcAmount)
        }
        if (lc.modifyPatch?.quantity !== undefined) {
          item.quantity = lc.modifyPatch.quantity
        }
        const newMrc = Number(item.mrcAmount)
        if (newMrc !== oldMrc || lc.modifyPatch?.configuration || lc.modifyPatch?.charges) {
          summary.push({
            action: 'modify',
            itemId: item.id,
            quoteLineId: lc.quoteLineId ?? null,
            mrcDelta: newMrc - oldMrc,
          })
        }
      }
    }

    return { lineChangeSummary: summary }
  }

  private async recomputeSubscriptionAggregatesInPlace(
    sub: CpqInventorySubscription,
    scope: TenantScope,
  ): Promise<void> {
    const items = await this.em.find(CpqInventorySubscriptionItem, {
      subscriptionId: sub.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      status: { $nin: ['terminated', 'expired', 'superseded'] },
    })
    const mrcSum = items.reduce((s, i) => s + Number(i.mrcAmount), 0)
    const nrcSum = items.reduce((s, i) => s + Number(i.nrcAmount), 0)
    sub.mrcAmount = String(mrcSum)
    sub.nrcAmount = String(nrcSum)
  }

  private createChangeLog(args: {
    subscription: CpqInventorySubscription
    changeType: ChangeLogType
    sourceQuoteId?: string | null
    sourceOrderId?: string | null
    performedByUserId?: string | null
    beforeSnapshot: Record<string, unknown> | null
    afterSnapshot: Record<string, unknown> | null
    lineChanges: Array<Record<string, unknown>> | null
    termChange?: Record<string, unknown> | null
    mergedIntoSubscriptionId?: string | null
    mergedFromSubscriptionIds?: string[] | null
    reasonCode?: string | null
    reasonText?: string | null
    etfAmount?: string | null
    etfCurrency?: string | null
  }): CpqSubscriptionChangeLog {
    const log = this.em.create(CpqSubscriptionChangeLog, {
      organizationId: args.subscription.organizationId,
      tenantId: args.subscription.tenantId,
      subscriptionId: args.subscription.id,
      changeType: args.changeType,
      sourceQuoteId: args.sourceQuoteId ?? null,
      sourceOrderId: args.sourceOrderId ?? null,
      performedByUserId: args.performedByUserId ?? null,
      effectiveAt: new Date(),
      beforeSnapshot: args.beforeSnapshot,
      afterSnapshot: args.afterSnapshot,
      lineChanges: args.lineChanges,
      termChange: args.termChange ?? null,
      mergedIntoSubscriptionId: args.mergedIntoSubscriptionId ?? null,
      mergedFromSubscriptionIds: args.mergedFromSubscriptionIds ?? null,
      reasonCode: args.reasonCode ?? null,
      reasonText: args.reasonText ?? null,
      etfAmount: args.etfAmount ?? null,
      etfCurrency: args.etfCurrency ?? null,
    })
    this.em.persist(log)
    return log
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

// ─── Module-private helpers ─────────────────────────────────────

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * MikroORM `@Property({ type: 'date' })` columns hydrate as strings on
 * Postgres (YYYY-MM-DD) — calling `.toISOString()` on them throws. This
 * helper accepts either form.
 */
function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
