import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import {
  COST_PLUS_TOGGLE,
  costElementContextError,
  costElementShapeError,
  cpqChargeCostElementCreateSchema,
  cpqChargeCostElementUpdateSchema,
  type ChargeCostElementInput,
  type ChargeCostElementPatch,
  type CostElementShape,
} from '../../data/costs'
import { CpqChargeCostElement, CpqPricingTable, CpqProductCharge } from '../../data/entities'
import { QuotingError } from '../cpqQuotingService'
import type { TenantScope } from '../types'

/**
 * Whether the engine can price `cost_plus` charges (shipped with the cost-plus
 * price step). Kept as a switch so the 422 gate below stays a one-line revert.
 */
export const COST_PLUS_PRICING_AVAILABLE = true

type Dependencies = {
  em: EntityManager
  featureTogglesService: Pick<FeatureTogglesService, 'getBoolConfig'>
}

type ChargeState = { id?: string; pricingMethod: string; isActive: boolean; deletedAt?: Date | null }

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const decimal = (value: number | null | undefined) => (value === undefined ? undefined : value === null ? null : String(value))

export function serializeCostElement(row: CpqChargeCostElement) {
  return {
    id: row.id,
    productChargeId: row.productChargeId,
    code: row.code,
    name: row.name,
    role: row.role,
    costType: row.costType,
    source: row.source,
    costModel: row.costModel,
    amount: row.amount,
    currencyCode: row.currencyCode,
    costTableId: row.costTableId,
    costColumnKey: row.costColumnKey,
    estimateAmount: row.estimateAmount,
    defaultSupplierId: row.defaultSupplierId,
    defaultSupplierName: row.defaultSupplierName,
    defaultValidityDays: row.defaultValidityDays,
    requiresSourcing: row.requiresSourcing,
    applicabilityCondition: row.applicabilityCondition,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
export type CostElementView = ReturnType<typeof serializeCostElement>

const isActivePriceBasis = (element: { role: string; isActive: boolean }) => element.isActive && element.role === 'price_basis'
const needsPriceBasis = (charge: ChargeState) => charge.pricingMethod === 'cost_plus' && charge.isActive && !charge.deletedAt

/**
 * Cost-plus catalog and quote-cost operations (App Spec §1.4). Registered in DI
 * as `cpqCostService`.
 */
export class CpqCostService {
  constructor(private readonly deps: Dependencies) {}

  /** Whether `cpq.cost_plus` is on for the tenant (R14). Missing / failing toggles count as off. */
  async enabled(tenantId: string): Promise<boolean> {
    const flag = await this.deps.featureTogglesService.getBoolConfig(COST_PLUS_TOGGLE, tenantId)
    return flag.ok && flag.value === true
  }

  /**
   * Gate for writing a charge as `cost_plus` (or changing its markup):
   * `422 COST_PLUS_DISABLED` with the toggle off (R14), then
   * `422 COST_PLUS_NOT_AVAILABLE` if the engine cannot price it.
   */
  async assertCostPlusChargeWritable(tenantId: string): Promise<void> {
    if (!(await this.enabled(tenantId))) throw new QuotingError(422, 'COST_PLUS_DISABLED')
    if (!COST_PLUS_PRICING_AVAILABLE) throw new QuotingError(422, 'COST_PLUS_NOT_AVAILABLE')
  }

  // ─── Charge-side rules ─────────────────────────────────────────

  /**
   * An active cost-plus charge needs ≥ 1 active price-basis element
   * (`422 NO_PRICE_BASIS_ELEMENT`). A new charge has none, so it is created
   * inactive, given elements, then activated.
   */
  async assertCostPlusChargeHasPriceBasis(em: EntityManager, charge: ChargeState, scope: TenantScope, excludeElementId?: string): Promise<void> {
    if (!needsPriceBasis(charge)) return
    const remaining = charge.id
      ? await em.count(CpqChargeCostElement, {
        ...scoped(scope), productChargeId: charge.id, role: 'price_basis', isActive: true,
        ...(excludeElementId ? { id: { $ne: excludeElementId } } : {}),
      })
      : 0
    if (remaining === 0) throw new QuotingError(422, 'NO_PRICE_BASIS_ELEMENT')
  }

  /**
   * A charge leaving `cost_plus` keeps its price-basis elements but deactivates
   * them (`price_basis` is only valid on cost-plus charges). Persisted by the
   * caller's flush.
   */
  async deactivatePriceBasisElements(em: EntityManager, chargeId: string, scope: TenantScope): Promise<number> {
    const rows = await em.find(CpqChargeCostElement, { ...scoped(scope), productChargeId: chargeId, role: 'price_basis', isActive: true })
    for (const row of rows) row.isActive = false
    return rows.length
  }

  /** Soft-deletes a deleted charge's elements. Persisted by the caller's flush. */
  async deleteChargeElements(em: EntityManager, chargeId: string, scope: TenantScope): Promise<void> {
    const rows = await em.find(CpqChargeCostElement, { ...scoped(scope), productChargeId: chargeId })
    const now = new Date()
    for (const row of rows) row.deletedAt = now
  }

  // ─── Cost elements ─────────────────────────────────────────────

  async listElements(productChargeId: string, scope: TenantScope, page: number, pageSize: number) {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const [rows, total] = await em.findAndCount(CpqChargeCostElement, { ...scoped(scope), productChargeId }, {
      limit: pageSize, offset: (page - 1) * pageSize, orderBy: { sortOrder: 'asc', code: 'asc' },
    })
    return { items: rows.map(serializeCostElement), total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  async createElement(input: ChargeCostElementInput, scope: TenantScope): Promise<CostElementView> {
    const parsed = cpqChargeCostElementCreateSchema.parse(input)
    return this.inChargeLock(parsed.productChargeId, scope, async (tx, charge) => {
      await this.validateElement(tx, parsed, charge, scope)
      // The code becomes the quote cost key, unique per quote line (I-1), so it must be
      // unique across every charge priced together on one line — not just this charge.
      const siblingChargeIds = await this.pricedTogetherChargeIds(tx, charge, scope)
      const duplicate = await tx.count(CpqChargeCostElement, { ...scoped(scope), productChargeId: { $in: siblingChargeIds }, code: parsed.code })
      if (duplicate > 0) throw new QuotingError(422, 'DUPLICATE_CODE')
      const row = tx.create(CpqChargeCostElement, {
        ...scope,
        productChargeId: charge.id,
        code: parsed.code,
        name: parsed.name,
        role: parsed.role,
        costType: parsed.costType,
        source: parsed.source,
        costModel: parsed.costModel,
        amount: decimal(parsed.amount) ?? null,
        currencyCode: parsed.currencyCode ?? null,
        costTableId: parsed.costTableId ?? null,
        costColumnKey: parsed.costColumnKey ?? null,
        estimateAmount: decimal(parsed.estimateAmount) ?? null,
        defaultSupplierId: parsed.defaultSupplierId ?? null,
        defaultSupplierName: parsed.defaultSupplierName ?? null,
        defaultValidityDays: parsed.defaultValidityDays ?? null,
        // App Spec §1.4.4: defaults to true for on_request (no-op until sourcing ships).
        requiresSourcing: parsed.requiresSourcing ?? parsed.source === 'on_request',
        applicabilityCondition: parsed.applicabilityCondition ?? null,
        sortOrder: parsed.sortOrder ?? 0,
        isActive: parsed.isActive ?? true,
      })
      tx.persist(row)
      await tx.flush()
      return serializeCostElement(row)
    })
  }

  async updateElement(input: ChargeCostElementPatch, scope: TenantScope): Promise<CostElementView> {
    const { id, ...patch } = cpqChargeCostElementUpdateSchema.parse(input)
    return this.inElementLock(id, scope, async (tx, row, charge) => {
      const merged = { ...row, ...patch, amount: patch.amount !== undefined ? patch.amount : row.amount,
        estimateAmount: patch.estimateAmount !== undefined ? patch.estimateAmount : row.estimateAmount }
      // Context rules bind active elements; a price-basis element deactivated
      // when its charge left cost-plus stays editable until reactivated.
      const shapeError = costElementShapeError(merged)
      if (shapeError) throw new QuotingError(422, shapeError)
      if (merged.isActive) await this.validateElement(tx, merged, charge, scope)
      if (isActivePriceBasis(row) && !isActivePriceBasis(merged)) {
        await this.assertCostPlusChargeHasPriceBasis(tx, charge, scope, row.id)
      }
      const { amount, estimateAmount, ...rest } = patch
      Object.assign(row, rest)
      if (amount !== undefined) row.amount = decimal(amount) ?? null
      if (estimateAmount !== undefined) row.estimateAmount = decimal(estimateAmount) ?? null
      await tx.flush()
      return serializeCostElement(row)
    })
  }

  async deleteElement(id: string, scope: TenantScope): Promise<void> {
    await this.inElementLock(id, scope, async (tx, row, charge) => {
      if (isActivePriceBasis(row)) await this.assertCostPlusChargeHasPriceBasis(tx, charge, scope, row.id)
      row.deletedAt = new Date()
      await tx.flush()
    })
  }

  /** §1.4.4 combination rules against the field shape, the charge and the cost table. */
  private async validateElement(em: EntityManager, element: CostElementShape, charge: CpqProductCharge, scope: TenantScope): Promise<void> {
    const shapeError = costElementShapeError(element)
    if (shapeError) throw new QuotingError(422, shapeError)
    const table = element.source === 'table' && element.costTableId
      ? await em.findOne(CpqPricingTable, { ...scoped(scope), id: element.costTableId })
      : null
    const contextError = costElementContextError(element, charge, table)
    if (contextError) throw new QuotingError(422, contextError)
  }

  /**
   * Charges a quote line prices together, mirroring `resolveProductCharges`: the
   * offering's charges for an offering charge, the product's charges otherwise.
   * Inactive charges count too — they can be reactivated. Concurrent creates on two
   * sibling charges are not serialized (only this charge is locked); cost resolution
   * keeps the first element per key deterministically as the fallback.
   */
  private async pricedTogetherChargeIds(tx: EntityManager, charge: CpqProductCharge, scope: TenantScope): Promise<string[]> {
    const siblings = await tx.find(CpqProductCharge, {
      ...scoped(scope),
      ...(charge.offeringId ? { offeringId: charge.offeringId } : { productId: charge.productId }),
    }, { fields: ['id'] })
    return [...new Set([charge.id, ...siblings.map((sibling) => sibling.id)])]
  }

  /**
   * Runs `execute` in a transaction holding a PESSIMISTIC_WRITE lock on the charge
   * row (re-read under the lock). Element writes and charge writes (activation,
   * leaving cost-plus) both serialize here, so two concurrent writes cannot each
   * pass the last-price-basis rule on their own snapshot. `404 Charge not found`
   * when the charge is gone.
   */
  async inChargeLock<T>(chargeId: string, scope: TenantScope, execute: (tx: EntityManager, charge: CpqProductCharge) => Promise<T>): Promise<T> {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    return em.transactional(async (tx) => {
      const charge = await tx.findOne(CpqProductCharge, { ...scoped(scope), id: chargeId }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!charge) throw new QuotingError(404, 'Charge not found')
      return execute(tx, charge)
    })
  }

  private async inElementLock<T>(id: string, scope: TenantScope, execute: (tx: EntityManager, row: CpqChargeCostElement, charge: CpqProductCharge) => Promise<T>): Promise<T> {
    const lookup = this.deps.em.fork({ clear: true, useContext: false })
    const found = await lookup.findOne(CpqChargeCostElement, { ...scoped(scope), id })
    if (!found) throw new QuotingError(404, 'Cost element not found')
    return this.inChargeLock(found.productChargeId, scope, async (tx, charge) => {
      // Re-read under the charge lock: the pre-lock read only located the charge.
      const row = await tx.findOne(CpqChargeCostElement, { ...scoped(scope), id })
      if (!row) throw new QuotingError(404, 'Cost element not found')
      return execute(tx, row, charge)
    })
  }
}
