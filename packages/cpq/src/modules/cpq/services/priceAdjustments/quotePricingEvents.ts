import { emitCpqEvent } from '../../events'
import type { CpqQuoteConfiguration } from '../../data/entities'
import type { PricingWaterfallSummary } from '../types'

export type QuotePricingCause = 'adjustment' | 'line' | 'recalculate' | 'clone'
export type QuoteStatusCause = 'manual' | 'auto'

/** Describes the write so its committed effect can be named in the events. */
export interface QuoteWriteEvents {
  pricingCause: QuotePricingCause
  /** `manual` only for an operator-requested transition; recalculation-driven changes are `auto`. */
  statusCause?: QuoteStatusCause
  actorUserId?: string | null
}

export interface QuoteEventState {
  snapshotHash: string | null
  cpqStatus: string
}

type SnapshotSource = Pick<CpqQuoteConfiguration, 'id' | 'cpqStatus' | 'currencyCode' | 'pricingRevision' | 'pricingSummary' | 'tenantId' | 'organizationId'>
  & { quoteType?: string | null }

export interface QuotePricingSnapshot {
  quoteId: string
  quoteType: 'new' | 'amend' | 'renew' | 'cancel'
  cpqStatus: string
  currencyCode: string
  pricingRevision: number
  snapshotHash: string
  dealValue: PricingWaterfallSummary['dealValue']
  discountDepth: PricingWaterfallSummary['discountDepth']
  hasTimeBasedAdjustments: boolean
}

type Emit = (eventId: string, payload: Record<string, unknown>) => Promise<unknown> | unknown

function storedHash(summary: Record<string, unknown> | null | undefined): string | null {
  const hash = summary?.snapshotHash
  return typeof hash === 'string' && hash.length > 0 ? hash : null
}

export function captureQuoteEventState(quote: Pick<CpqQuoteConfiguration, 'cpqStatus' | 'pricingSummary'>): QuoteEventState {
  return { snapshotHash: storedHash(quote.pricingSummary), cpqStatus: quote.cpqStatus }
}

export function buildQuotePricingSnapshot(quote: SnapshotSource): QuotePricingSnapshot {
  const summary = (quote.pricingSummary ?? {}) as Partial<PricingWaterfallSummary>
  const quoteType = quote.quoteType === 'amend' || quote.quoteType === 'renew' || quote.quoteType === 'cancel' ? quote.quoteType : 'new'
  return {
    quoteId: quote.id,
    quoteType,
    cpqStatus: quote.cpqStatus,
    currencyCode: quote.currencyCode,
    pricingRevision: quote.pricingRevision ?? 0,
    snapshotHash: storedHash(quote.pricingSummary) ?? '',
    dealValue: summary.dealValue ?? { list: 0, standard: 0, offer: 0 },
    discountDepth: summary.discountDepth ?? { rule: null, manual: null, total: null, maxLineManual: null },
    hasTimeBasedAdjustments: summary.hasTimeBasedAdjustments === true,
  }
}

/**
 * Emits the committed effect of one quote write. Call only after the
 * transaction has committed. A null previous hash is a legacy quote's first
 * baseline and never counts as a pricing change. Dispatch failures are logged
 * and swallowed: the write stands and the stored hash stays authoritative.
 */
export async function emitQuoteWriteEvents(
  before: QuoteEventState | null,
  quote: SnapshotSource,
  options: QuoteWriteEvents,
  emit: Emit = emitCpqEvent as unknown as Emit,
): Promise<void> {
  const after = captureQuoteEventState(quote)
  const base = { tenantId: quote.tenantId, organizationId: quote.organizationId, ...buildQuotePricingSnapshot(quote), occurredAt: new Date().toISOString() }
  const pricingChanged = after.snapshotHash !== null
    && (before === null ? true : before.snapshotHash !== null && before.snapshotHash !== after.snapshotHash)
  const pending: Array<[string, Record<string, unknown>]> = []
  if (pricingChanged) pending.push(['cpq.quote.pricing_changed', { ...base, cause: options.pricingCause }])
  if (before !== null && before.cpqStatus !== after.cpqStatus) {
    pending.push(['cpq.quote.status_changed', {
      ...base, fromStatus: before.cpqStatus, toStatus: after.cpqStatus,
      cause: options.statusCause ?? 'auto', actorUserId: options.actorUserId ?? null,
    }])
  }
  for (const [eventId, payload] of pending) {
    try {
      await emit(eventId, payload)
    } catch (error) {
      console.error(`[cpq] failed to emit ${eventId} for quote ${quote.id}`, error)
    }
  }
}
