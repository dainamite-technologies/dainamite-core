import type { CpqCostSourcingService } from '../services/costs/costSourcingService'

/**
 * Persistent subscriber for `sales.quote.deleted` (supplier sourcing spec Q7): a quote deleted through the SALES
 * module cannot join CPQ's transaction, so its open supplier cost requests are cancelled here (`quote_closed`) in a
 * CPQ quote write, eventually consistent. Until then the queue hides the rows and an answer gets `409 QUOTE_CLOSED`.
 * Idempotent: a quote with nothing open is a no-op. Deleting through the CPQ route cancels in its own transaction.
 */
export const metadata = {
  event: 'sales.quote.deleted',
  persistent: true,
  id: 'cpq-sales-quote-deleted-cancel-requests',
}

type SalesQuoteDeletedPayload = { id?: string | null; organizationId?: string | null; tenantId?: string | null }
type ResolverContext = { resolve: <T = unknown>(name: string) => T }

export default async function handler(payload: SalesQuoteDeletedPayload, ctx: ResolverContext): Promise<void> {
  if (!payload?.id || !payload.tenantId || !payload.organizationId) return
  try {
    const sourcing = ctx.resolve<CpqCostSourcingService>('cpqCostSourcingService')
    await sourcing.cancelRequestsForSalesQuote(payload.id, { tenantId: payload.tenantId, organizationId: payload.organizationId })
  } catch (error) {
    // Log with ids only, then rethrow so the persistent queue retries.
    console.error(`[cpq] cancelling cost requests of deleted sales quote ${payload.id} failed`, error)
    throw error
  }
}
