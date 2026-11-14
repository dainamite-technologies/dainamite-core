import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqChargeCostElement,
  CpqOrderConfiguration,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteLineCost,
} from '../../data/entities'
import {
  cpqCostCancelRequestSchema,
  cpqCostRequestSchema,
  type CostCancelRequestInput,
  type CostRequestInput,
  type CostRequestResponse,
} from '../../data/cost-sourcing'
import { QuotingError } from '../cpqQuotingService'
import { withQuotePricingWrite } from '../priceAdjustments/quotePricingWrite'
import type { TenantScope } from '../types'
import { COST_CLOSED_STATUSES } from './costLock'
import type { CpqCostService } from './costService'
import { cancelRequestPatch, isRequestOpen, openRequestPatch } from './costRequestState'
import { costLineEligibility, type CancelReason } from './costSourcing'
import { sourcingCostRef, type SourcingSignal, type SourcingSignalPublisher } from './sourcingSignals'

type Dependencies = {
  em: EntityManager
  costService: Pick<CpqCostService, 'enabled'>
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
   * The single cancellation helper of every cause that runs inside a quote write (line removal, quote closing,
   * conversion, deletion, a manual value): cancels the open requests of the quote (optionally of given cost lines or
   * quote lines), appends the history, clears proposals and returns the signals (also pushed to `signals`). It does
   * NOT flush and does not check the toggle: stored state is always cleaned (spec §Edge Cases, toggle off).
   */
  async cancelOpenRequests(
    em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id'>, scope: TenantScope, reason: CancelReason,
    options: { actorUserId?: string | null; costIds?: string[]; quoteLineIds?: string[]; signals?: SourcingSignal[] } = {},
  ): Promise<SourcingSignal[]> {
    const rows = await em.find(CpqQuoteLineCost, {
      ...scoped(scope), quoteConfigurationId: quote.id, sourcingStatus: 'requested',
      ...(options.costIds ? { id: { $in: options.costIds } } : {}),
      ...(options.quoteLineIds ? { quoteLineId: { $in: options.quoteLineIds } } : {}),
    })
    const now = new Date()
    const cancelled: SourcingSignal[] = []
    for (const row of rows) {
      if (!isRequestOpen(row)) continue
      Object.assign(row, cancelRequestPatch(row, { reason, now, closedByUserId: options.actorUserId ?? null }))
      cancelled.push({ ...sourcingCostRef(row), kind: 'request_cancelled', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq ?? 1, reason })
    }
    options.signals?.push(...cancelled)
    return cancelled
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
   * One sourcing write: aggregate lock + revision through `withQuotePricingWrite` (a request never prices anything,
   * so no margin tracker), signals published after commit.
   */
  private write(
    quoteId: string, scope: TenantScope, expectedRevision: number | undefined, actor: string,
    execute: (em: EntityManager, quote: CpqQuoteConfiguration, signals: SourcingSignal[]) => Promise<CostRequestWriteResult>,
  ): Promise<CostRequestWriteResult> {
    const signals: SourcingSignal[] = []
    const publisher = this.deps.publisher
    return withQuotePricingWrite(this.deps.em, quoteId, scope, (em, quote) => execute(em, quote, signals),
      (status, message) => new QuotingError(status, message), {
        expectedRevision, events: { pricingCause: 'cost', actorUserId: actor },
        afterCommit: publisher ? async (_result, quote) => { if (signals.length > 0) await publisher(signals, quote) } : undefined,
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
