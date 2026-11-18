import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqOrderConfiguration, CpqOrderLineConfiguration, CpqOrderLineCost, CpqProductCharge, CpqQuoteLineConfiguration,
} from '../../data/entities'
import { cpqOrderLineCostReconfirmSchema, type OrderLineCostReconfirm } from '../../data/order-costs'
import { QuotingError } from '../cpqQuotingService'
import type { TenantScope } from '../types'
import { extendsValidity, type CostLockState } from './costLock'
import type { CpqCostService } from './costService'
import type { CpqFxRateResolver } from './fxRateResolver'
import { fullOrderCostView } from './orderCostView'
import { costInstanceAmount } from './quoteCostService'
import { costLineTotal } from './quoteMargin'
import { lockSourceQuote } from './sourceQuoteLock'

/**
 * Post-conversion cost re-confirmation (ARC costs spec Q-D13 / Q2 / Q12, App Spec R11). Between conversion and
 * activation a cost manager may change the value, currency, supplier, validity or supplier term of an order line cost
 * (the carrier confirms a lower tail). It moves MARGIN ONLY: the order's `charges`, line totals and order totals are
 * never touched, and no quote price changes (the cost lock stays exactly as it is). `total_amount` is recomputed with
 * the rule the conversion copy uses (`costLineTotal`: instance x fx_rate x quantity, one rounding), `reconfirmed_at` /
 * `reconfirmed_by_user_id` are set, and NO event is emitted: the activation that writes the value onto the item cost
 * emits its own `cost_changed` (amend / renew / activation).
 *
 * Serialization with activation: ONE forked transaction that takes `lockSourceQuote` FIRST and reads the order row
 * WITHOUT a lock afterwards. Activation locks the order row, then the quote row, then the subscriptions; a re-confirmation
 * that locked the order row before the quote row would invert that order and could deadlock. Reading the order unlocked
 * after owning the quote lock is safe: activation holds the quote lock until it commits, so once this transaction owns it
 * the order status it reads is the committed one (`409 ORDER_ACTIVATED` if activation won, nothing written).
 * The order row is read once before the transaction, unlocked and outside it, only to learn the (immutable) source quote id.
 */

type Dependencies = {
  em: EntityManager
  costService: Pick<CpqCostService, 'enabled'>
  fxRateResolver?: Pick<CpqFxRateResolver, 'resolve'>
}

/** What an action-log entry may carry of an order line cost: ids, statuses, roles and the cost key. Never an amount, supplier or note. */
export type OrderCostAudit = { id: string; orderLineId: string; costKey: string; role: string; origin: string; valueStatus: string; valueOrigin: string | null }
export type OrderCostReconfirmResult = {
  orderId: string
  cost: ReturnType<typeof fullOrderCostView>
  audit: { before: OrderCostAudit; after: OrderCostAudit }
}

export const orderCostAudit = (row: CpqOrderLineCost): OrderCostAudit => ({
  id: row.id, orderLineId: row.orderLineId, costKey: row.costKey, role: row.role, origin: row.origin,
  valueStatus: row.valueStatus, valueOrigin: row.valueOrigin ?? null,
})

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const clean = (value: string | null | undefined) => (value === undefined || value === null || value.trim() === '' ? null : value.trim())
const money = (value: number) => String(Math.round((value + Number.EPSILON) * 10_000) / 10_000)
const notFound = (what: string) => new QuotingError(404, what)
/** Statuses an order line cost may still be re-confirmed in. */
const OPEN_ORDER_STATUSES = ['draft', 'pending_activation']
const NO_FX = { fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null }

function lockState(row: CpqOrderLineCost): CostLockState {
  return {
    role: row.role, chargeCode: row.chargeCode ?? null, costType: row.costType, costModel: row.costModel, source: row.source,
    unitAmount: row.unitAmount, currencyCode: row.currencyCode ?? null, valueStatus: row.valueStatus,
    validUntil: row.validUntil, supplierTermEnd: row.supplierTermEnd, supplierMinTermMonths: row.supplierMinTermMonths,
  }
}

export class CpqOrderCostReconfirmService {
  constructor(private readonly deps: Dependencies) {}

  async reconfirm(orderId: string, orderLineCostId: string, input: OrderLineCostReconfirm, actor: string, scope: TenantScope): Promise<OrderCostReconfirmResult> {
    const patch = cpqOrderLineCostReconfirmSchema.parse(input)
    if (!(await this.deps.costService.enabled(scope.tenantId))) throw notFound('Not found')
    // Unlocked pre-read (outside the transaction) of the order, to learn its source quote.
    const reader = this.deps.em.fork({ clear: true, useContext: false })
    const known = await this.findOrder(reader, orderId, scope)
    if (!known) throw notFound('Order not found')
    // An isolated fork opens its own connection: inside another transaction it could not see that transaction's rows.
    if (this.deps.em.isInTransaction?.()) throw new Error('reconfirm must not run inside an existing transaction')
    const isolated = this.deps.em.fork({ clear: true, useContext: false })
    return isolated.transactional(async (tx) => {
      // 1. The quote lock FIRST (same helper and row as activation and withQuotePricingWrite).
      const quote = await lockSourceQuote(tx, known.sourceQuoteId, scope)
      // 2. The order row, UNLOCKED, re-read from the database: it holds the status activation committed, if it won.
      const order = await tx.findOne(CpqOrderConfiguration, { id: known.id, ...scoped(scope) }, { refresh: true })
      if (!order) throw notFound('Order not found')
      if (order.cpqStatus === 'cancelled') throw new QuotingError(409, 'ORDER_CANCELLED')
      if (!OPEN_ORDER_STATUSES.includes(order.cpqStatus)) throw new QuotingError(409, 'ORDER_ACTIVATED')
      const row = await tx.findOne(CpqOrderLineCost, { id: orderLineCostId, orderConfigurationId: order.id, ...scoped(scope) }, { refresh: true })
      if (!row) throw notFound('Order line cost not found')
      const orderLine = await tx.findOne(CpqOrderLineConfiguration, { orderLineId: row.orderLineId, orderConfigurationId: order.id, ...scoped(scope) })
      if (!orderLine) throw notFound('Order line not found')

      const before = lockState(row)
      const auditBefore = orderCostAudit(row)
      const amountGiven = patch.unitAmount !== undefined
      const amount = amountGiven ? patch.unitAmount as number : row.unitAmount === null ? null : Number(row.unitAmount)
      // No amount (stored or given): the stored currency stays as it is (re-confirming only a date is not a value change).
      // An amount needs a currency: the body's, else the stored one. Never a silent fall back to the order currency.
      if (amount !== null && amountGiven && !patch.currencyCode && !row.currencyCode) throw new QuotingError(422, 'CURRENCY_REQUIRED')
      const currency = amount === null ? row.currencyCode ?? null : patch.currencyCode ?? row.currencyCode ?? null
      const valueChanged = (before.unitAmount === null ? null : Number(before.unitAmount)) !== amount || before.currencyCode !== currency
      const next: CostLockState = {
        ...before, unitAmount: amount, currencyCode: currency,
        valueStatus: amount === null ? 'none' : 'confirmed',
        validUntil: patch.validUntil !== undefined ? patch.validUntil : row.validUntil,
        supplierTermEnd: patch.supplierTermEnd !== undefined ? patch.supplierTermEnd : row.supplierTermEnd,
        supplierMinTermMonths: patch.supplierMinTermMonths !== undefined ? patch.supplierMinTermMonths : row.supplierMinTermMonths,
      }
      // A changed value needs a reason: a NEW supplier quote reference, or a note. Extending a validity or term needs the same evidence.
      const note = clean(patch.note)
      const newRef = clean(patch.supplierQuoteRef)
      const hasEvidence = Boolean((newRef && newRef !== row.supplierQuoteRef) || note)
      if (valueChanged && !hasEvidence) throw new QuotingError(422, 'NOTE_REQUIRED')
      if (extendsValidity(before, next) && !hasEvidence) throw new QuotingError(422, 'VALIDITY_EVIDENCE_REQUIRED')

      // A changed value takes the dated rate at the write; an unchanged one keeps its stored snapshot. A foreign value
      // with no rate is refused: nothing is written (an order cost is never downgraded to `none`, and never 1:1).
      const foreign = amount !== null && currency !== null && currency !== order.currencyCode
      let fx: { fxRate: string | null; fxRateDate: string | null; fxRateSource: string | null; fxRateDerivation: string | null } | null = null
      if (foreign && (valueChanged || row.fxRate === null || row.fxRate === undefined)) {
        const resolved = this.deps.fxRateResolver ? await this.deps.fxRateResolver.resolve({ from: currency as string, to: order.currencyCode, scope }) : null
        if (!resolved?.ok) throw new QuotingError(422, 'CURRENCY_NO_RATE', undefined, { from: currency, to: order.currencyCode })
        fx = { fxRate: resolved.rate, fxRateDate: resolved.rateDate, fxRateSource: resolved.source, fxRateDerivation: resolved.derivation }
      } else if (!foreign && row.fxRate !== null && row.fxRate !== undefined) {
        fx = { ...NO_FX }
      }
      const instance = amount === null ? null : valueChanged || row.instanceAmount === null ? await this.instanceAmount(tx, quote, orderLine, row, amount, scope) : Number(row.instanceAmount)

      row.valueStatus = next.valueStatus
      // Untouched numbers keep their stored text (numeric(18,4)); only a given amount or a recomputed instance is rewritten.
      if (amountGiven) row.unitAmount = String(amount)
      if (instance !== null && (valueChanged || row.instanceAmount === null)) row.instanceAmount = money(instance)
      row.currencyCode = currency
      if (fx) Object.assign(row, fx)
      row.validUntil = next.validUntil ?? null
      row.supplierTermEnd = next.supplierTermEnd ?? null
      row.supplierMinTermMonths = next.supplierMinTermMonths ?? null
      if (patch.supplierId !== undefined) row.supplierId = patch.supplierId ?? null
      if (patch.supplierName !== undefined) row.supplierName = clean(patch.supplierName)
      if (patch.supplierQuoteRef !== undefined) row.supplierQuoteRef = clean(patch.supplierQuoteRef)
      if (patch.note !== undefined) row.note = note
      // A human entered the value: the origin of the value (not of the cost line) becomes manual.
      if (valueChanged) row.valueOrigin = 'manual'
      // Margin only: `total_amount` is the one derived figure; the order's charges and totals are not loaded, let alone written.
      const total = costLineTotal({ valueStatus: row.valueStatus, instanceAmount: row.instanceAmount, fxRate: row.fxRate }, Number(orderLine.quantity))
      row.totalAmount = total === null ? null : String(total)
      row.reconfirmedAt = new Date()
      row.reconfirmedByUserId = actor
      await tx.flush()
      return { orderId: order.id, cost: fullOrderCostView(row), audit: { before: auditBefore, after: orderCostAudit(row) } }
    }, { clear: true })
  }

  private findOrder(em: EntityManager, orderId: string, scope: TenantScope) {
    return em.findOne(CpqOrderConfiguration, { id: orderId, ...scoped(scope) })
      .then((byId) => byId ?? em.findOne(CpqOrderConfiguration, { orderId, ...scoped(scope) }))
  }

  /** Per-instance amount: flat is the unit amount; `per_unit` multiplies by the charge's quantity attribute of the source quote line (frozen since conversion). */
  private async instanceAmount(
    tx: EntityManager, quote: Awaited<ReturnType<typeof lockSourceQuote>>, orderLine: CpqOrderLineConfiguration, row: CpqOrderLineCost, unit: number, scope: TenantScope,
  ): Promise<number> {
    if (row.costModel !== 'per_unit') return unit
    const quoteLine = quote && orderLine.sourceQuoteLineId
      ? await tx.findOne(CpqQuoteLineConfiguration, { quoteLineId: orderLine.sourceQuoteLineId, quoteConfigurationId: quote.id, ...scoped(scope) })
      : null
    if (!quote || !quoteLine) throw new QuotingError(422, 'LINE_NOT_ELIGIBLE')
    const owner = quoteLine.offeringId ? { offeringId: quoteLine.offeringId } : { productId: quoteLine.productId }
    const charge = row.chargeCode ? await tx.findOne(CpqProductCharge, { ...scoped(scope), ...owner, code: row.chargeCode }) : null
    return costInstanceAmount(tx, quote, quoteLine, charge?.quantityAttributeCode ?? null, 'per_unit', unit)
  }
}
