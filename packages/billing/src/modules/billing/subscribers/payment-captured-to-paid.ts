import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingInvoice } from '../data/entities'

/**
 * Subscriber: payment captured → billing invoice paid.
 *
 * Spec wishlist was `payments.payment.completed` carrying `invoice_id`.
 * The actual upstream event is `payment_gateways.payment.captured` and
 * its payload carries `paymentId` — set by whoever created the payment
 * session. Billing flows that drive their own payment sessions can
 * pass `paymentId = invoice.id`; the subscriber matches on that.
 *
 * Behaviour:
 *   1. Try to find a billing invoice (`billing_invoices`) with `id = payload.paymentId`
 *      scoped to the same tenant/organization.
 *   2. If found AND its `status` is `posted` / `partially_paid`, flip it to
 *      `paid` and set the paid / outstanding totals. Drafts and already-paid / credited documents
 *      are left untouched.
 *   3. If `paymentId` does not point at a billing-known invoice (e.g.
 *      the payment was for a `sales.order`), the subscriber is a
 *      no-op — every other module's own subscriber owns its slice.
 *
 * Cross-tenant safety: we always re-scope by `tenantId` +
 * `organizationId` from the event payload. A malformed payload (e.g.
 * missing scope fields) short-circuits without touching the DB.
 *
 * Idempotency: re-firing the same captured event finds the invoice
 * already paid and skips silently.
 */

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'billing-payment-captured-to-paid',
}

type CapturedPayload = {
  paymentId?: string
  transactionId?: string
  organizationId?: string
  tenantId?: string
  providerKey?: string
}

export default async function handle(payload: CapturedPayload): Promise<void> {
  if (!payload?.paymentId || !payload.tenantId || !payload.organizationId) {
    return
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const invoice = await em.findOne(BillingInvoice, {
    id: payload.paymentId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    deletedAt: null,
  } as never)
  if (!invoice) {
    // The captured payment isn't for a billing invoice — silent
    // no-op. Other subscribers (sales, checkout) handle their slice.
    return
  }
  if (invoice.status === 'paid') {
    // Already paid — idempotent re-firing.
    return
  }
  if (invoice.status !== 'posted' && invoice.status !== 'partially_paid') {
    // A captured payment for a draft / credited document is suspicious but
    // not actionable here. (Spec C replaces this with a payment allocation.)
    return
  }

  invoice.status = 'paid'
  invoice.paidTotal = invoice.totalGross
  invoice.outstanding = '0'
  invoice.updatedAt = new Date()
  await em.flush()
}
