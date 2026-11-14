import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingAccount, BillingInvoice } from '../data/entities'
import { hasSuccessfulDelivery, isDeliverableEmail, sendInvoice, type SendInvoiceDeps } from '../lib/invoiceDelivery'

/**
 * Auto-send (Spec B): `billing.invoice.posted` → email the document when the
 * account has `auto_send_invoice` on.
 *
 * Persistent and idempotent: a redelivered event finds a `sent` auto
 * delivery in `metadata.deliveries` and does nothing. Receipts, test
 * documents and accounts with a placeholder / missing email are skipped
 * without a delivery entry (the operator can still send manually once the
 * address is fixed). A transport failure is recorded as a `failed`
 * delivery by `sendInvoice` and not retried automatically.
 */

export const metadata = {
  event: 'billing.invoice.posted',
  persistent: true,
  id: 'billing-invoice-auto-send',
}

type PostedPayload = {
  invoiceId?: string
  tenantId?: string
  organizationId?: string
}

export async function autoSendInvoice(em: EntityManager, payload: PostedPayload, deps: SendInvoiceDeps = {}): Promise<'sent' | 'failed' | 'skipped'> {
  if (!payload?.invoiceId || !payload.tenantId || !payload.organizationId) return 'skipped'
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const invoice = await em.findOne(BillingInvoice, { id: payload.invoiceId, ...scope, deletedAt: null } as never)
  if (!invoice || invoice.testRun || invoice.status === 'draft' || invoice.documentType === 'receipt') return 'skipped'
  if (hasSuccessfulDelivery(invoice, 'auto')) return 'skipped'
  const account = await em.findOne(BillingAccount, { id: invoice.billAccountId, ...scope } as never)
  if (!account?.autoSendInvoice || !isDeliverableEmail(account.invoiceEmail)) return 'skipped'
  const result = await sendInvoice(em, { invoiceId: invoice.id, ...scope, trigger: 'auto' }, deps)
  return result.status
}

export default async function handle(payload: PostedPayload): Promise<void> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  await autoSendInvoice(em, payload)
}
