import type { SourcingSignal } from './sourcingSignals'

/**
 * Collects the sourcing events of one committed quote write as `[eventId, payload]` pairs and flushes them once the
 * transaction is over (feature spec step 12). The producers push amount-free `SourcingSignal`s during the
 * transaction; `buildSourcingEvents` maps them to event payloads and `flush` emits them, one failure never stopping
 * the others (an emit error is logged and swallowed: the write stands).
 *
 * Exactly-once rules: a request opens once and is cancelled once, so `requested` / `request_cancelled` signals are
 * de-duplicated by request id (a producer that returns its signals AND pushes them to the sink does not double-emit).
 * `valued` signals are one per sourcing action and are never merged.
 */
export type BufferedSourcingEvent = [eventId: string, payload: Record<string, unknown>]
export type SourcingEmit = (eventId: string, payload: Record<string, unknown>) => Promise<unknown> | unknown

/** What the `cost_requested` payload adds to the signal: the line's product / offering and the attributes the cost depends on. */
export type RequestedEnrichment = { productId: string | null; offeringId: string | null; attributes: Record<string, unknown> }
export const NO_ENRICHMENT: RequestedEnrichment = { productId: null, offeringId: null, attributes: {} }

export class SourcingEventBuffer {
  private readonly entries: BufferedSourcingEvent[] = []

  add(eventId: string, payload: Record<string, unknown>): void {
    this.entries.push([eventId, payload])
  }

  get size(): number {
    return this.entries.length
  }

  /** The buffered events, in order (test seam). */
  peek(): readonly BufferedSourcingEvent[] {
    return this.entries
  }

  async flush(emit: SourcingEmit, onError: (eventId: string, error: unknown) => void = () => undefined): Promise<void> {
    const pending = this.entries.splice(0, this.entries.length)
    for (const [eventId, payload] of pending) {
      try {
        await emit(eventId, payload)
      } catch (error) {
        onError(eventId, error)
      }
    }
  }
}

type Scope = { id: string; tenantId: string; organizationId: string }

export function buildSourcingEvents(
  signals: readonly SourcingSignal[],
  quote: Scope,
  enrichment: ReadonlyMap<string, RequestedEnrichment>,
  occurredAt: string = new Date().toISOString(),
): SourcingEventBuffer {
  const buffer = new SourcingEventBuffer()
  const seen = new Set<string>()
  for (const signal of signals) {
    const base = {
      tenantId: quote.tenantId, organizationId: quote.organizationId,
      // The CPQ quote id, like the sibling quote events; `salesQuoteId` is the sales document.
      quoteId: signal.quoteConfigurationId, quoteConfigurationId: signal.quoteConfigurationId, salesQuoteId: signal.quoteId,
      quoteLineId: signal.quoteLineId, costLineId: signal.costLineId, costKey: signal.costKey, costName: signal.costName,
      chargeCode: signal.chargeCode,
    }
    if (signal.kind === 'requested') {
      const key = `requested:${signal.costRequestId}`
      if (seen.has(key)) continue
      seen.add(key)
      const extra = enrichment.get(signal.costLineId) ?? NO_ENRICHMENT
      buffer.add('cpq.quote.cost_requested', {
        ...base, costRequestId: signal.costRequestId, requestSeq: signal.requestSeq,
        productId: extra.productId, offeringId: extra.offeringId, attributes: extra.attributes,
        supplierId: signal.supplierId, requestedByUserId: signal.requestedByUserId, auto: signal.auto, occurredAt,
      })
    } else if (signal.kind === 'request_cancelled') {
      const key = `cancelled:${signal.costRequestId}`
      if (seen.has(key)) continue
      seen.add(key)
      buffer.add('cpq.quote.cost_request_cancelled', {
        ...base, costRequestId: signal.costRequestId, requestSeq: signal.requestSeq, reason: signal.reason, occurredAt,
      })
    } else {
      buffer.add('cpq.quote.cost_valued', {
        ...base, costRequestId: signal.costRequestId, requestSeq: signal.requestSeq,
        valueStatus: signal.valueStatus, previousValueStatus: signal.previousValueStatus, sourcingStatus: signal.sourcingStatus,
        valueChanged: signal.valueChanged, answerPending: signal.answerPending, errorCode: signal.errorCode, lineReady: signal.lineReady,
        leadTimeHours: signal.leadTimeHours, requestedByUserId: signal.requestedByUserId, cause: signal.cause, occurredAt,
      })
    }
  }
  return buffer
}
