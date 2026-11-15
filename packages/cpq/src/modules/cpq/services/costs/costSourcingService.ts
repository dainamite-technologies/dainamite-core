import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqChargeCostElement,
  CpqOrderConfiguration,
  CpqProductCharge,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
} from '../../data/entities'
import {
  cpqCostAnswerSchema,
  cpqCostApplyAnswerSchema,
  cpqCostCancelRequestSchema,
  cpqCostDeclineSchema,
  cpqCostRequestSchema,
  type CostAnswerInput,
  type CostAnswerOutcome,
  type CostApplyAnswerInput,
  type CostCancelRequestInput,
  type CostDeclineInput,
  type CostRequestInput,
  type CostRequestResponse,
} from '../../data/cost-sourcing'
import { QuotingError, type DefaultCpqQuotingService } from '../cpqQuotingService'
import { withQuotePricingWrite, type QuotePricingWriteOptions } from '../priceAdjustments/quotePricingWrite'
import type { QuoteWriteEvents } from '../priceAdjustments/quotePricingEvents'
import type { TenantScope } from '../types'
import { COST_CLOSED_STATUSES } from './costLock'
import type { CpqCostService } from './costService'
import { isQuoteCostLocked } from './costResolution'
import { cancelRequestPatch, isRequestOpen, openRequestPatch } from './costRequestState'
import { cancelOpenRequests as cancelOpenCostRequests } from './costRequestCancel'
import {
  appendRequestHistory, buildHistoryEntry, classifyAnswer, costLineEligibility, declineEffect, hashAnswer, normalizeAnswer,
  type AnswerVerdict, type CancelReason, type NormalizedAnswer,
} from './costSourcing'
import { createMarginTracker } from './quoteMarginTracker'
import { costInstanceAmount } from './quoteCostService'
import { fullCostView, type FullCostView } from './quoteCostView'
import { lineReady, sourcingCostRef, type SourcingSignal, type SourcingSignalPublisher } from './sourcingSignals'

type Dependencies = {
  em: EntityManager
  costService: Pick<CpqCostService, 'enabled'>
  /** Re-prices the quote inside the write that applied an answer (the same pricing write a manual value uses). */
  quotingService: Pick<DefaultCpqQuotingService, 'recalculateLockedQuote'>
  /** Publishes the signals of a committed write (the sourcing events, step 12). Absent = nothing is published. */
  publisher?: SourcingSignalPublisher
}

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })

/** What an action-log entry may carry of a sourcing write: ids, statuses, sequence numbers, reasons. Never an amount, supplier or note. */
export type SourcingAudit = { id: string; quoteLineId: string; costKey: string; sourcingStatus: string; costRequestId: string | null; requestSeq: number | null; reason?: string }

export interface CostRequestWriteResult {
  response: CostRequestResponse
  audit: { before: SourcingAudit; after: SourcingAudit }
  /** What the write opened / cancelled; already handed to the publisher after commit. */
  signals: SourcingSignal[]
}

export interface CostAnswerWriteResult {
  response: { outcome: CostAnswerOutcome; cost: FullCostView; lineReady: boolean; pricingRevision: number }
  audit: { before: SourcingAudit; after: SourcingAudit }
  signals: SourcingSignal[]
}
export interface CostDeclineWriteResult {
  response: { outcome: 'declined'; cost: FullCostView; pricingRevision: number }
  audit: { before: SourcingAudit; after: SourcingAudit }
  signals: SourcingSignal[]
}
export interface CostApplyAnswerWriteResult {
  /** The quote result (as the status route returns it) plus the cost line. */
  response: Record<string, unknown> & { cost: FullCostView; pricingRevision: number }
  audit: { before: SourcingAudit; after: SourcingAudit }
  signals: SourcingSignal[]
}

type AnswerPayload = Omit<NormalizedAnswer, 'costRequestId'>
const money = (value: number) => String(Math.round((value + Number.EPSILON) * 10_000) / 10_000)
const today = () => new Date().toISOString().slice(0, 10)
const sameNumber = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b))

/** The stored shape of a proposal (`proposed_answer`, Q2): the answer without its request id. */
const proposalOf = (answer: NormalizedAnswer): AnswerPayload => {
  const { costRequestId: _requestId, ...payload } = answer
  return payload
}

const audit = (row: CpqQuoteLineCost, reason?: string): SourcingAudit => ({
  id: row.id, quoteLineId: row.quoteLineId, costKey: row.costKey, sourcingStatus: row.sourcingStatus,
  costRequestId: row.costRequestId ?? null, requestSeq: row.requestSeq ?? null, ...(reason ? { reason } : {}),
})

/**
 * The common refusals of every sourcing write, in the defined order (feature spec §API Contracts): a rejected /
 * cancelled quote or a deleted sales quote is `409 QUOTE_CLOSED`, a quote with an order is
 * `409 QUOTE_CONVERTED { orderId }`. Reads only; throws before anything is written.
 */
export async function assertQuoteOpenForSourcing(em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope): Promise<void> {
  const sales = await findOneWithDecryption(em, SalesQuote, { id: quote.quoteId, ...scoped(scope) }, undefined, scope)
  if (!sales || COST_CLOSED_STATUSES.includes(quote.cpqStatus as never)) throw new QuotingError(409, 'QUOTE_CLOSED')
  const order = await em.findOne(CpqOrderConfiguration, { sourceQuoteId: quote.id, ...scoped(scope) })
  if (order) throw new QuotingError(409, 'QUOTE_CONVERTED', undefined, { orderId: order.id })
}

/**
 * Supplier cost requests on quote cost lines (feature spec `2026-11-12-cpq-cost-plus-supplier-sourcing`, Q1, Q8,
 * Q14, I-13). A request is STATE of the cost line; every change goes through `withQuotePricingWrite`, so the
 * aggregate lock and the revision apply, and a quote's other writers serialize against it. Registered in DI as
 * `cpqCostSourcingService`.
 */
export class CpqCostSourcingService {
  constructor(private readonly deps: Dependencies) {}

  /**
   * Opens a request on an eligible cost line (Q14); an open one is closed first as `cancelled (re_requested)`.
   * Allowed on locked quotes (a request prices nothing). Toggle off -> 404.
   */
  async request(quoteId: string, costId: string, input: CostRequestInput, actor: string, scope: TenantScope): Promise<CostRequestWriteResult> {
    const parsed = cpqCostRequestSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote, signals) => {
      await assertQuoteOpenForSourcing(em, quote, scope)
      const row = await this.requireCost(em, quote, costId, scope)
      const line = await em.findOne(CpqQuoteLineConfiguration, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId: row.quoteLineId })
      if (!line) throw new QuotingError(404, 'Quote line not found')
      const eligibility = costLineEligibility(line, row, quote.quoteType)
      if (!eligibility.eligible) throw new QuotingError(422, 'LINE_NOT_ELIGIBLE', undefined, { reason: eligibility.reason })
      // The target supplier defaults from the catalog element (Q-D3); an explicit one wins.
      const element = row.costElementId ? await em.findOne(CpqChargeCostElement, { id: row.costElementId, organizationId: scope.organizationId, tenantId: scope.tenantId }) : null
      const supplierId = parsed.supplierId ?? (parsed.supplierName ? null : element?.defaultSupplierId ?? null)
      const supplierName = parsed.supplierName?.trim() || (parsed.supplierId ? null : element?.defaultSupplierName ?? null)

      const before = audit(row)
      const now = new Date()
      let state: CpqQuoteLineCost = row
      if (isRequestOpen(row)) {
        const cancel = cancelRequestPatch(row, { reason: 're_requested', now, closedByUserId: actor })
        state = { ...row, ...cancel } as CpqQuoteLineCost
        signals.push({ ...sourcingCostRef(row), kind: 'request_cancelled', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq ?? 1, reason: 're_requested' })
        Object.assign(row, cancel)
      }
      const open = openRequestPatch(state, { now, requestedByUserId: actor, supplierId, supplierName })
      Object.assign(row, open)
      signals.push({
        ...sourcingCostRef(row), kind: 'requested', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq as number,
        supplierId: row.requestSupplierId ?? null, requestedByUserId: actor, auto: false,
      })
      return this.result(row, before, quote, signals)
    })
  }

  /** Manual cancel of the current open request (Q8, reason `cancelled_by_user`). Allowed on locked quotes. Toggle off -> 404. */
  async cancelRequest(quoteId: string, costId: string, input: CostCancelRequestInput, actor: string, scope: TenantScope): Promise<CostRequestWriteResult> {
    const parsed = cpqCostCancelRequestSchema.parse(input)
    await this.requireEnabled(scope)
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote, signals) => {
      await assertQuoteOpenForSourcing(em, quote, scope)
      const row = await this.requireCost(em, quote, costId, scope)
      // I-13: only the current request id can be cancelled; a replaced one is superseded, a closed one is not open.
      if (!row.costRequestId || row.costRequestId !== parsed.costRequestId) throw new QuotingError(409, 'COST_REQUEST_SUPERSEDED')
      if (!isRequestOpen(row)) throw new QuotingError(409, 'REQUEST_NOT_OPEN')
      const before = audit(row)
      Object.assign(row, cancelRequestPatch(row, { reason: 'cancelled_by_user', now: new Date(), closedByUserId: actor }))
      signals.push({ ...sourcingCostRef(row), kind: 'request_cancelled', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq ?? 1, reason: 'cancelled_by_user' })
      return this.result(row, before, quote, signals, 'cancelled_by_user')
    })
  }

  /**
   * Supplier answer (Q9, Proposed Solution 2). Takes the quote lock itself (no `expectedRevision`). Every refusal and
   * the idempotent no-op run in `shortCircuit` (no write, no revision, no event), in the defined check order:
   * cost line 404 -> QUOTE_CLOSED -> QUOTE_CONVERTED -> COST_PLUS_DISABLED (409, retryable) -> LINE_NOT_ELIGIBLE ->
   * stale request id / inactive element (COST_REQUEST_SUPERSEDED) -> same ref + same hash (200 noop) -> same ref +
   * different hash (SUPPLIER_QUOTE_REF_CONFLICT) -> REQUEST_NOT_OPEN. Then: unlocked (or margin-only, lock-exempt R11)
   * applies the value and re-prices; locked + same amount and currency confirms; locked + different stores a proposal.
   */
  async answer(quoteId: string, costId: string, input: CostAnswerInput, actor: string, scope: TenantScope): Promise<CostAnswerWriteResult> {
    const parsed = cpqCostAnswerSchema.parse(input)
    // ISO 4217 FORMAT only (Q15); no read of the currencies module.
    if (!/^[A-Z]{3}$/.test(parsed.currencyCode)) throw new QuotingError(422, 'INVALID_CURRENCY_CODE')
    const normalized = normalizeAnswer(parsed)
    const signals: SourcingSignal[] = []
    let verdict: AnswerVerdict | undefined
    let locked = false
    const result = (quote: CpqQuoteConfiguration, row: CpqQuoteLineCost, outcome: CostAnswerOutcome, before: SourcingAudit): CostAnswerWriteResult => ({
      response: { outcome, cost: fullCostView(row), lineReady: lineReady(quote, row.quoteLineId), pricingRevision: quote.pricingRevision ?? 0 },
      audit: { before, after: audit(row, outcome) }, signals,
    })
    return this.write(quoteId, scope, undefined, actor, async (em, quote) => {
      const row = await this.requireCost(em, quote, costId, scope)
      const line = await em.findOne(CpqQuoteLineConfiguration, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId: row.quoteLineId })
      if (!line) throw new QuotingError(404, 'Quote line not found')
      const before = audit(row)
      const prior = { valueStatus: row.valueStatus, unitAmount: row.unitAmount ?? null, currencyCode: row.currencyCode ?? null }
      const now = new Date()
      const payload = proposalOf(normalized)
      const history = this.closedHistory(row, 'answered', now, actor, { supplierQuoteRef: normalized.supplierQuoteRef, supplierId: normalized.supplierId })
      const closed = {
        sourcingStatus: 'answered', answeredAt: now, answeredByUserId: actor, lastAnswerHash: hashAnswer(normalized), cancelReason: null, ...history,
      }
      const reprice = !locked
      await this.persistAndPrice(em, quote, scope, reprice, signals, actor, async () => {
        if (verdict === 'proposed') {
          Object.assign(row, closed, { proposedAmount: normalized.unitAmount, proposedAnswer: payload })
        } else if (verdict === 'confirmed_unchanged') {
          Object.assign(row, closed, { proposedAmount: null, proposedAnswer: null }, this.supplierFields(row, payload),
            payload.valueStatus === 'confirmed' ? { valueStatus: 'confirmed', valueOrigin: 'supplier' } : {})
        } else {
          Object.assign(row, closed, { proposedAmount: null, proposedAnswer: null }, await this.valuePatch(em, quote, line, row, payload, scope))
        }
        this.confirmRenegotiation(row, payload.valueStatus)
      })
      this.valuedSignal(signals, row, quote, 'answer', prior, now)
      return result(quote, row, verdict as CostAnswerOutcome, before)
    }, {
      marginTracker: true, events: { pricingCause: 'cost', actorUserId: actor },
      shortCircuit: async (em, quote) => {
        const row = await this.requireCost(em, quote, costId, scope)
        await assertQuoteOpenForSourcing(em, quote, scope)
        if (!(await this.deps.costService.enabled(scope.tenantId))) throw new QuotingError(409, 'COST_PLUS_DISABLED')
        const line = await em.findOne(CpqQuoteLineConfiguration, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId: row.quoteLineId })
        if (!line) throw new QuotingError(404, 'Quote line not found')
        const eligibility = costLineEligibility(line, row, quote.quoteType)
        if (!eligibility.eligible) throw new QuotingError(422, 'LINE_NOT_ELIGIBLE', undefined, { reason: eligibility.reason })
        locked = await isQuoteCostLocked(em, quote, scope)
        verdict = classifyAnswer({
          answer: parsed, elementActive: await this.elementActive(em, row, scope), locked,
          cost: {
            sourcingStatus: row.sourcingStatus, costRequestId: row.costRequestId ?? null, lastAnswerHash: row.lastAnswerHash ?? null,
            supplierQuoteRef: row.supplierQuoteRef ?? null, unitAmount: row.unitAmount ?? null, currencyCode: row.currencyCode ?? null,
            proposedAnswer: row.proposedAnswer as { supplierQuoteRef?: string | null } | null, role: row.role,
          },
        })
        if (verdict === 'superseded') throw new QuotingError(409, 'COST_REQUEST_SUPERSEDED')
        if (verdict === 'conflict') throw new QuotingError(409, 'SUPPLIER_QUOTE_REF_CONFLICT')
        if (verdict === 'not_open') throw new QuotingError(409, 'REQUEST_NOT_OPEN')
        if (verdict === 'noop') return result(quote, row, 'noop', audit(row))
        if (normalized.validUntil && normalized.validUntil < today()) throw new QuotingError(422, 'VALID_UNTIL_IN_PAST')
        return undefined
      },
    })
  }

  /**
   * Decline (Q3): `declined` + reason; unlocked quote: the value goes to `none` (the estimate moves into the note) and
   * the quote re-prices; locked quote: the amount is kept (price unchanged, I-5) and the status is downgraded to
   * `estimated`. A margin-only cost is lock-exempt (R11) and follows the unlocked rule. Takes the lock itself.
   */
  async decline(quoteId: string, costId: string, input: CostDeclineInput, actor: string, scope: TenantScope): Promise<CostDeclineWriteResult> {
    const parsed = cpqCostDeclineSchema.parse(input)
    const signals: SourcingSignal[] = []
    return this.write(quoteId, scope, undefined, actor, async (em, quote) => {
      const row = await this.requireCost(em, quote, costId, scope)
      const locked = await isQuoteCostLocked(em, quote, scope)
      const before = audit(row)
      const prior = { valueStatus: row.valueStatus, unitAmount: row.unitAmount ?? null, currencyCode: row.currencyCode ?? null }
      const effect = declineEffect({ unitAmount: row.unitAmount ?? null, valueStatus: row.valueStatus, note: row.note ?? null, role: row.role }, locked)
      const now = new Date()
      const history = this.closedHistory(row, 'declined', now, actor, { declineReason: parsed.reason })
      await this.persistAndPrice(em, quote, scope, !locked, signals, actor, () => {
        Object.assign(row, {
          sourcingStatus: 'declined', declineReason: parsed.reason, answeredAt: now, answeredByUserId: actor, cancelReason: null,
          proposedAmount: null, proposedAnswer: null, lastAnswerHash: null, valueStatus: effect.valueStatus, note: effect.note, ...history,
          // A cleared value stays an entered one: the catalog resolver must not bring its estimate back.
          ...(effect.clearAmount ? { unitAmount: null, instanceAmount: null, valueOrigin: 'supplier', errorCode: null } : {}),
        })
      })
      this.valuedSignal(signals, row, quote, 'decline', prior, now)
      return {
        response: { outcome: 'declined' as const, cost: fullCostView(row), pricingRevision: quote.pricingRevision ?? 0 },
        audit: { before, after: audit(row, 'declined') }, signals,
      }
    }, {
      marginTracker: true, events: { pricingCause: 'cost', actorUserId: actor },
      shortCircuit: async (em, quote) => {
        const row = await this.requireCost(em, quote, costId, scope)
        await assertQuoteOpenForSourcing(em, quote, scope)
        if (!(await this.deps.costService.enabled(scope.tenantId))) throw new QuotingError(409, 'COST_PLUS_DISABLED')
        if (!row.costRequestId || row.costRequestId !== parsed.costRequestId || !(await this.elementActive(em, row, scope))) throw new QuotingError(409, 'COST_REQUEST_SUPERSEDED')
        if (!isRequestOpen(row)) throw new QuotingError(409, 'REQUEST_NOT_OPEN')
        return undefined
      },
    })
  }

  /**
   * Reopen and apply the supplier answer (#22a): ONE write that moves the quote to `ready`, applies the stored
   * proposal under the same request id (`value_origin = supplier`), clears it and re-prices (the status settles to
   * `ready` or `incomplete`). `expectedRevision` is required; `status_changed (manual)` fires when the status moved.
   * Toggle off -> 404 like the other management routes.
   */
  async applyAnswer(quoteId: string, costId: string, input: CostApplyAnswerInput, actor: string, scope: TenantScope): Promise<CostApplyAnswerWriteResult> {
    const parsed = cpqCostApplyAnswerSchema.parse(input)
    await this.requireEnabled(scope)
    const signals: SourcingSignal[] = []
    return this.write(quoteId, scope, parsed.expectedRevision, actor, async (em, quote) => {
      const row = await this.requireCost(em, quote, costId, scope)
      await assertQuoteOpenForSourcing(em, quote, scope)
      const proposal = row.proposedAnswer as AnswerPayload | null
      if (row.proposedAmount === null || row.proposedAmount === undefined || !proposal) throw new QuotingError(409, 'NO_PENDING_ANSWER')
      const line = await em.findOne(CpqQuoteLineConfiguration, { ...scoped(scope), quoteConfigurationId: quote.id, quoteLineId: row.quoteLineId })
      if (!line) throw new QuotingError(404, 'Quote line not found')
      const before = audit(row)
      const prior = { valueStatus: row.valueStatus, unitAmount: row.unitAmount ?? null, currencyCode: row.currencyCode ?? null }
      let quoteResult: Record<string, unknown> = {}
      await this.persistAndPrice(em, quote, scope, true, signals, actor, async () => {
        quote.cpqStatus = 'ready'
        Object.assign(row, { proposedAmount: null, proposedAnswer: null }, await this.valuePatch(em, quote, line, row, proposal, scope))
        this.confirmRenegotiation(row, proposal.valueStatus)
      }, (value) => { quoteResult = value as unknown as Record<string, unknown> })
      this.valuedSignal(signals, row, quote, 'apply_answer', prior, new Date())
      return {
        response: { ...quoteResult, cpqStatus: quote.cpqStatus, pricingRevision: quote.pricingRevision ?? 0, cost: fullCostView(row) },
        audit: { before, after: audit(row, 'apply_answer') }, signals,
      }
    }, { marginTracker: true, events: { pricingCause: 'cost', statusCause: 'manual', actorUserId: actor } })
  }

  /**
   * The single cancellation helper of every cause that runs inside a quote write (line removal, quote closing,
   * conversion, deletion, a manual value): cancels the open requests of the quote (optionally of given cost lines or
   * quote lines), appends the history, clears proposals and returns the signals (also pushed to `signals`). It does
   * NOT flush and does not check the toggle: stored state is always cleaned (spec §Edge Cases, toggle off).
   */
  async cancelOpenRequests(
    em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id'>, scope: TenantScope, reason: CancelReason,
    options: { actorUserId?: string | null; costIds?: string[]; quoteLineIds?: string[]; signals?: SourcingSignal[] } = {},
  ): Promise<SourcingSignal[]> {
    return cancelOpenCostRequests(em, quote, scope, reason, options)
  }

  /**
   * Element deactivation fan-out (Q4). Called AFTER the catalog write committed: finds the quotes holding an open
   * request on one of `elementIds` and cancels those requests (`element_deactivated`), each quote in its OWN
   * `withQuotePricingWrite`, best effort. A quote whose write fails is logged and skipped (the others still run);
   * R1a on the quote's next saved recalculation and the answer-side inactive-element check back it up. Never throws.
   */
  async cancelRequestsForElements(elementIds: string[], scope: TenantScope, actorUserId: string | null = null): Promise<{ quotes: number; cancelled: number; failed: number }> {
    const summary = { quotes: 0, cancelled: 0, failed: 0 }
    if (elementIds.length === 0) return summary
    const costIdsByQuote = new Map<string, string[]>()
    try {
      let after: string | undefined
      for (;;) {
        const rows: CpqQuoteLineCost[] = await this.deps.em.find(CpqQuoteLineCost, {
          ...scoped(scope), costElementId: { $in: elementIds }, sourcingStatus: 'requested', ...(after ? { id: { $gt: after } } : {}),
        }, { limit: 500, orderBy: { id: 'asc' } })
        for (const row of rows) costIdsByQuote.set(row.quoteConfigurationId, [...(costIdsByQuote.get(row.quoteConfigurationId) ?? []), row.id])
        if (rows.length < 500) break
        after = rows[rows.length - 1].id
      }
    } catch (error) {
      console.error('[cpq] cost request fan-out: reading the open requests failed', error)
      return { ...summary, failed: 1 }
    }
    for (const [quoteId, costIds] of costIdsByQuote) {
      summary.quotes += 1
      try {
        const result = await this.write(quoteId, scope, undefined, actorUserId ?? '', async (em, quote, signals) => ({
          cancelled: (await this.cancelOpenRequests(em, quote, scope, 'element_deactivated', { actorUserId, costIds, signals })).length,
        }), {
          // Someone else already closed them (answer, R1a, ...): nothing to write, no revision bump.
          shortCircuit: async (em) => {
            const open = await em.count(CpqQuoteLineCost, { ...scoped(scope), id: { $in: costIds }, sourcingStatus: 'requested' })
            return open === 0 ? { cancelled: 0 } : undefined
          },
        })
        summary.cancelled += result.cancelled
      } catch (error) {
        summary.failed += 1
        console.error(`[cpq] cost request fan-out: cancelling the requests of quote ${quoteId} failed`, error)
      }
    }
    return summary
  }

  /**
   * A quote deleted through the SALES module (Q7, `sales.quote.deleted`): cancels the open requests of the CPQ quote
   * that wraps it (`quote_closed`) in one quote write. Idempotent (nothing open: no write, no revision bump) and a
   * no-op for a sales quote without a live CPQ quote. Returns the number of cancelled requests; errors propagate so
   * the persistent subscriber is retried.
   */
  async cancelRequestsForSalesQuote(salesQuoteId: string, scope: TenantScope): Promise<number> {
    const quote = await this.deps.em.findOne(CpqQuoteConfiguration, { ...scoped(scope), quoteId: salesQuoteId })
    if (!quote) return 0
    const result = await this.write(quote.id, scope, undefined, '', async (em, locked, signals) => ({
      cancelled: (await this.cancelOpenRequests(em, locked, scope, 'quote_closed', { signals })).length,
    }), {
      shortCircuit: async (em, locked) => {
        const open = await em.count(CpqQuoteLineCost, { ...scoped(scope), quoteConfigurationId: locked.id, sourcingStatus: 'requested' })
        return open === 0 ? { cancelled: 0 } : undefined
      },
    })
    return result.cancelled
  }

  // ─── Internals ─────────────────────────────────────────────────

  private result(row: CpqQuoteLineCost, before: SourcingAudit, quote: CpqQuoteConfiguration, signals: SourcingSignal[], reason?: string): CostRequestWriteResult {
    return {
      response: {
        costId: row.id, sourcingStatus: row.sourcingStatus as CostRequestResponse['sourcingStatus'],
        costRequestId: row.costRequestId ?? null, requestSeq: row.requestSeq ?? null,
        // The revision this write commits (withQuotePricingWrite bumped it before `execute`).
        pricingRevision: quote.pricingRevision ?? 0,
      },
      audit: { before, after: audit(row, reason) }, signals,
    }
  }

  /**
   * One sourcing write: aggregate lock + revision through `withQuotePricingWrite`, signals published after commit.
   * Requests and cancellations price nothing (no margin tracker); answers, declines and apply-answer pass
   * `marginTracker` because they can move a price-basis cost.
   */
  private write<T>(
    quoteId: string, scope: TenantScope, expectedRevision: number | undefined, actor: string,
    execute: (em: EntityManager, quote: CpqQuoteConfiguration, signals: SourcingSignal[]) => Promise<T>,
    extra: { events?: QuoteWriteEvents; marginTracker?: boolean; shortCircuit?: QuotePricingWriteOptions<T>['shortCircuit'] } = {},
  ): Promise<T> {
    const signals: SourcingSignal[] = []
    const publisher = this.deps.publisher
    return withQuotePricingWrite(this.deps.em, quoteId, scope, (em, quote) => execute(em, quote, signals),
      (status, message) => new QuotingError(status, message), {
        expectedRevision, events: extra.events ?? { pricingCause: 'cost', actorUserId: actor }, shortCircuit: extra.shortCircuit,
        marginTracker: extra.marginTracker ? createMarginTracker({ scope, isEnabled: (tenantId) => this.deps.costService.enabled(tenantId), force: true }) : undefined,
        afterCommit: publisher ? async (result, quote) => {
          const published = (result as { signals?: SourcingSignal[] }).signals ?? signals
          if (published.length > 0) await publisher(published, quote)
        } : undefined,
      })
  }

  /**
   * Persists a sourcing value change, then re-prices through the saved recalculation while the quote is unlocked (a
   * locked quote only receives price-neutral writes, and re-pricing it would re-read the catalog). The recalculation
   * shares this write's signal sink, so a cancellation it causes is published with the rest.
   */
  private async persistAndPrice(
    em: EntityManager, quote: CpqQuoteConfiguration, scope: TenantScope, reprice: boolean, signals: SourcingSignal[], actor: string,
    persist: () => void | Promise<void>, onResult?: (result: unknown) => void,
  ): Promise<void> {
    await withAtomicFlush(em, [
      persist,
      async () => {
        if (!reprice) return
        const repriced = await this.deps.quotingService.recalculateLockedQuote(em, quote, scope, true, undefined, { actorUserId: actor, signals })
        onResult?.(repriced)
      },
    ])
  }

  private async elementActive(em: EntityManager, row: CpqQuoteLineCost, scope: TenantScope): Promise<boolean> {
    if (row.origin !== 'catalog' || !row.costElementId) return true
    return Boolean(await em.findOne(CpqChargeCostElement, { id: row.costElementId, isActive: true, ...scoped(scope) }))
  }

  /** History entry (and capped list) of the request an answer / decline closes. Never carries an amount. */
  private closedHistory(row: CpqQuoteLineCost, outcome: 'answered' | 'declined', now: Date, actor: string, over: { supplierQuoteRef?: string | null; supplierId?: string | null; declineReason?: string | null }) {
    const entry = buildHistoryEntry({
      cost: {
        costRequestId: row.costRequestId ?? null, requestSeq: row.requestSeq ?? null, requestedAt: row.requestedAt ?? null,
        requestedByUserId: row.requestedByUserId ?? null, requestSupplierId: row.requestSupplierId ?? null,
        supplierId: over.supplierId ?? row.supplierId ?? null, supplierQuoteRef: over.supplierQuoteRef ?? null, declineReason: over.declineReason ?? null,
      },
      outcome, closedAt: now, closedByUserId: actor,
    })
    return entry ? { requestHistory: appendRequestHistory(row.requestHistory as Array<Record<string, unknown>> | undefined, entry as unknown as Record<string, unknown>) } : {}
  }

  /** Supplier columns of an answer; an answer without supplier fields keeps the targeted supplier of the request. */
  private supplierFields(row: CpqQuoteLineCost, answer: AnswerPayload) {
    return {
      supplierId: answer.supplierId ?? row.requestSupplierId ?? row.supplierId ?? null,
      supplierName: answer.supplierName ?? (answer.supplierId ? null : row.requestSupplierName ?? row.supplierName ?? null),
      supplierQuoteRef: answer.supplierQuoteRef, validUntil: answer.validUntil, supplierTermEnd: answer.supplierTermEnd,
      supplierMinTermMonths: answer.supplierMinTermMonths, note: answer.note ?? row.note ?? null,
    }
  }

  /**
   * The value fields an answer writes (`value_origin = supplier`). An answer in a non-quote currency is STORED (the
   * supplier's unit amount in its own currency, so the FX feature can convert it) but resolves to `none` +
   * `CURRENCY_NO_RATE` with no instance amount (no FX yet, Q15; spec edge case "Answer in a non-quote currency"):
   * pricing and margin ignore a `none` cost, so there is never a silent 1:1 conversion.
   */
  private async valuePatch(em: EntityManager, quote: CpqQuoteConfiguration, line: CpqQuoteLineConfiguration, row: CpqQuoteLineCost, answer: AnswerPayload, scope: TenantScope) {
    const supplier = this.supplierFields(row, answer)
    if (answer.currencyCode !== quote.currencyCode) {
      return { ...supplier, valueStatus: 'none', valueOrigin: 'supplier', unitAmount: money(Number(answer.unitAmount)), instanceAmount: null, currencyCode: answer.currencyCode, errorCode: 'CURRENCY_NO_RATE' }
    }
    const unit = Number(answer.unitAmount)
    let quantityAttributeCode: string | null = null
    if (row.costModel === 'per_unit' && row.chargeCode) {
      const owner = line.offeringId ? { offeringId: line.offeringId } : { productId: line.productId }
      quantityAttributeCode = (await em.findOne(CpqProductCharge, { ...scoped(scope), isActive: true, ...owner, code: row.chargeCode }))?.quantityAttributeCode ?? null
    }
    const instance = await costInstanceAmount(em, quote, line, quantityAttributeCode, row.costModel, unit)
    return {
      ...supplier, valueStatus: answer.valueStatus, valueOrigin: 'supplier', unitAmount: money(unit), instanceAmount: money(instance),
      currencyCode: answer.currencyCode, errorCode: null,
    }
  }

  /**
   * A confirming answer on a renegotiation-due `carried` cost clears the ARC spec's `renegotiation_due`. The column
   * exists only once that spec ships, so until then this is a no-op (guarded on the property).
   */
  private confirmRenegotiation(row: CpqQuoteLineCost, valueStatus: string) {
    if (row.origin === 'carried' && valueStatus === 'confirmed' && 'renegotiationDue' in row) (row as unknown as { renegotiationDue: boolean }).renegotiationDue = false
  }

  /** Q11: the value / status change of a sourcing action, as an amount-free signal for step 12's `cost_valued` event. */
  private valuedSignal(
    signals: SourcingSignal[], row: CpqQuoteLineCost, quote: CpqQuoteConfiguration, cause: 'answer' | 'decline' | 'apply_answer',
    prior: { valueStatus: string; unitAmount: string | null; currencyCode: string | null }, now: Date,
  ) {
    const requestedAt = row.requestedAt ? new Date(row.requestedAt).getTime() : null
    signals.push({
      ...sourcingCostRef(row), kind: 'valued', cause, costRequestId: row.costRequestId ?? null, requestSeq: row.requestSeq ?? null,
      valueStatus: row.valueStatus, previousValueStatus: prior.valueStatus, sourcingStatus: row.sourcingStatus,
      valueChanged: prior.valueStatus !== row.valueStatus || !sameNumber(prior.unitAmount, row.unitAmount ?? null) || prior.currencyCode !== (row.currencyCode ?? null),
      answerPending: row.proposedAmount !== null && row.proposedAmount !== undefined, errorCode: row.errorCode ?? null,
      lineReady: lineReady(quote, row.quoteLineId),
      leadTimeHours: cause !== 'apply_answer' && requestedAt !== null ? Math.round(((now.getTime() - requestedAt) / 3_600_000) * 100) / 100 : null,
      requestedByUserId: row.requestedByUserId ?? null,
    })
  }

  private async requireEnabled(scope: TenantScope) {
    if (!(await this.deps.costService.enabled(scope.tenantId))) throw new QuotingError(404, 'Not found')
  }

  private async requireCost(em: EntityManager, quote: CpqQuoteConfiguration, id: string, scope: TenantScope) {
    const row = await em.findOne(CpqQuoteLineCost, { ...scoped(scope), id, quoteConfigurationId: quote.id })
    if (!row) throw new QuotingError(404, 'Cost line not found')
    return row
  }
}
