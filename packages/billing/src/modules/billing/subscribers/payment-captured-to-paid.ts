import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { resolveInvoiceStatusEntryId } from '../lib/invoiceStatus'

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
 *   1. Try to find a `core/sales` invoice with `id = payload.paymentId`
 *      scoped to the same tenant/organization.
 *   2. If found AND its `status == 'posted'`, flip it to `'paid'`
 *      (resolves the `paid` `DictionaryEntry`, updates `status` +
 *      `status_entry_id`). Drafts and already-paid / voided invoices
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

  const invoice = await em.findOne(SalesInvoice, {
    id: payload.paymentId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    deletedAt: null,
  })
  if (!invoice) {
    // The captured payment isn't for a billing invoice — silent
    // no-op. Other subscribers (sales, checkout) handle their slice.
    return
  }
  if (invoice.status === 'paid') {
    // Already paid — idempotent re-firing.
    return
  }
  if (invoice.status !== 'posted') {
    // A captured payment for a draft / void invoice is suspicious but
    // not actionable here. Future iteration: log to audit_logs.
    return
  }

  const paidStatusEntryId = await resolveInvoiceStatusEntryId(
    em,
    payload.tenantId,
    payload.organizationId,
    'paid',
  )
  invoice.status = 'paid'
  invoice.statusEntryId = paidStatusEntryId
  invoice.paidTotalAmount = invoice.grandTotalGrossAmount
  invoice.outstandingAmount = '0'
  invoice.updatedAt = new Date()
  await em.flush()
}
