import type { CancelReason } from './costSourcing'

/**
 * What a sourcing write did, collected DURING the transaction and published AFTER commit. This is the seam of the
 * sourcing events (feature spec step 12): every write path that can open or cancel a request pushes plain,
 * amount-free signals into a sink it owns, and hands the sink to a `SourcingSignalPublisher` once the quote
 * transaction committed (`withQuotePricingWrite({ afterCommit })`). Nothing is emitted by the producers themselves,
 * and a signal never carries a cost amount, markup or margin (App Spec I-4).
 */

/** Identity of the cost line a signal is about (ids and names only). */
export type SourcingCostRef = {
  quoteConfigurationId: string
  quoteId: string
  quoteLineId: string
  costLineId: string
  costKey: string
  costName: string
  chargeCode: string | null
}

export type SourcingRequestedSignal = SourcingCostRef & {
  kind: 'requested'
  costRequestId: string
  requestSeq: number
  supplierId: string | null
  requestedByUserId: string | null
  /** Opened by a saved recalculation (Q12), not by a user action. */
  auto: boolean
}

export type SourcingCancelledSignal = SourcingCostRef & {
  kind: 'request_cancelled'
  costRequestId: string
  requestSeq: number
  reason: CancelReason
}

/**
 * A sourcing action changed a cost line's value or value status (Q11: answer, decline, apply-answer). Statuses and
 * flags only: never the amount (App Spec I-4). The publisher maps it to `cpq.quote.cost_valued`.
 */
export type SourcingValuedSignal = SourcingCostRef & {
  kind: 'valued'
  cause: 'answer' | 'decline' | 'apply_answer' | 'manual_value' | 'reset'
  costRequestId: string | null
  requestSeq: number | null
  /** Resolved after the write's recalculation. */
  valueStatus: string
  previousValueStatus: string
  sourcingStatus: string
  valueChanged: boolean
  /** An unapplied proposal exists (a different-value answer on a locked quote). */
  answerPending: boolean
  errorCode: string | null
  lineReady: boolean
  /** `answered_at - requested_at` in hours (answer / decline). */
  leadTimeHours: number | null
  requestedByUserId: string | null
}

export type SourcingSignal = SourcingRequestedSignal | SourcingCancelledSignal | SourcingValuedSignal

export type SourcingSignalSink = SourcingSignal[]

/** The quote the committed write belonged to. */
export type SourcingPublishScope = { id: string; tenantId: string; organizationId: string }

/** `createSourcingPublisher` provides the implementation (non-broadcast events, once per request / cancellation). Failures must not throw. */
export type SourcingSignalPublisher = (signals: readonly SourcingSignal[], quote: SourcingPublishScope) => Promise<void> | void

type RefSource = {
  id: string
  quoteConfigurationId: string
  quoteId: string
  quoteLineId: string
  costKey: string
  name: string
  chargeCode?: string | null
}

export const sourcingCostRef = (row: RefSource): SourcingCostRef => ({
  quoteConfigurationId: row.quoteConfigurationId, quoteId: row.quoteId, quoteLineId: row.quoteLineId,
  costLineId: row.id, costKey: row.costKey, costName: row.name, chargeCode: row.chargeCode ?? null,
})

/** A quote line is ready while the stored validation has no error for it. */
export const lineReady = (quote: { validationResult?: { errors?: unknown } | null }, quoteLineId: string): boolean =>
  !(((quote.validationResult?.errors as Array<{ lineId?: string }> | undefined) ?? []).some((error) => error.lineId === quoteLineId))
