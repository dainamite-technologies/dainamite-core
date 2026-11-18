import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingInvoice, BillingPayment } from '../data/entities'
import { withAccountLock } from '../lib/accountLock'
import { allocate, applyAccountCredit, emptyEffects, mergeEffects, toCents, type AllocationEffects } from '../lib/allocation'
import { emitAllocationEffects } from '../lib/allocationEvents'
import { emitBillingEvent } from '../events'

/**
 * Subscriber: gateway payment captured → billing payment + allocation
 * (Spec C, P-D9 — the single code path to "paid").
 *
 * The payment session is created with `paymentId = invoice.id`, so the
 * captured event identifies the billing invoice. Instead of flipping the
 * invoice status, the capture becomes a `BillingPayment` (`source =
 * gateway`, `external_ref = transactionId ?? paymentId`) allocated to that
 * invoice through the allocation service; any remainder is account credit.
 *
 * Idempotent: a re-delivered event finds the payment by `external_ref` and
 * does nothing. Payments for anything that is not an open billing
 * receivable are ignored (other modules own them).
 */

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'billing-payment-captured-to-paid',
}

export type CapturedPayload = {
  paymentId?: string
  transactionId?: string
  organizationId?: string
  tenantId?: string
  providerKey?: string
  amount?: number | string
  currencyCode?: string
}

export async function recordGatewayCapture(
  em: EntityManager,
  payload: CapturedPayload,
): Promise<'recorded' | 'duplicate' | 'skipped'> {
  if (!payload?.paymentId || !payload.tenantId || !payload.organizationId) return 'skipped'
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const invoice = await em.findOne(BillingInvoice, { id: payload.paymentId, ...scope, deletedAt: null } as never)
  if (!invoice || invoice.testRun || !['invoice', 'debit_memo'].includes(invoice.documentType)) return 'skipped'
  const externalRef = payload.transactionId ?? payload.paymentId
  const existing = await em.findOne(BillingPayment, { ...scope, externalRef } as never)
  if (existing) return 'duplicate'
  if (!['posted', 'partially_paid'].includes(invoice.status)) return 'skipped'

  const captured = toCents(payload.amount ?? invoice.outstanding)
  if (captured <= 0) return 'skipped'
  const amount = (captured / 100).toFixed(4)
  const now = new Date()
  const payment = em.create(BillingPayment, {
    ...scope,
    receivedAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    amount,
    currencyCode: (payload.currencyCode ?? invoice.currencyCode).toUpperCase(),
    reference: invoice.number,
    source: 'gateway',
    billAccountId: invoice.billAccountId,
    status: 'matched',
    unallocatedAmount: amount,
    sourceRef: `gateway:${externalRef}`,
    externalRef,
    metadata: { provider_key: payload.providerKey ?? null },
    createdAt: now,
    updatedAt: now,
  })
  em.persist(payment)
  await em.flush()

  const effects: AllocationEffects = await withAccountLock(
    em,
    { tenantId: scope.tenantId, billAccountId: invoice.billAccountId },
    async (tem) => {
      const all = emptyEffects()
      const take = Math.min(captured, toCents(invoice.outstanding))
      if (take > 0 && payment.currencyCode === invoice.currencyCode) {
        mergeEffects(
          all,
          await allocate(tem, scope, {
            source: { type: 'payment', id: payment.id },
            invoiceId: invoice.id,
            amountCents: take,
            by: 'gateway',
          }),
        )
      }
      mergeEffects(
        all,
        await applyAccountCredit(tem, scope, { id: invoice.billAccountId, currencyCode: payment.currencyCode }, {
          onlySources: [{ type: 'payment', id: payment.id }],
        }),
      )
      return all
    },
  )
  await emitBillingEvent('billing.payment.created', { ...scope, paymentId: payment.id, source: 'gateway' })
  await emitAllocationEffects(scope, effects)
  return 'recorded'
}

export default async function handle(payload: CapturedPayload): Promise<void> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  await recordGatewayCapture(em, payload)
}
