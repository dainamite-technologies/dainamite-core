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

export type SourcingSignal = SourcingRequestedSignal | SourcingCancelledSignal

export type SourcingSignalSink = SourcingSignal[]

/** The quote the committed write belonged to. */
export type SourcingPublishScope = { id: string; tenantId: string; organizationId: string }

/** Step 12 provides the implementation (non-broadcast events, once per request / cancellation). Failures must not throw. */
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
