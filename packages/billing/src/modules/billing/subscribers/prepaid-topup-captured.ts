import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import type { TaxCalculationService } from '@open-mercato/core/modules/sales/services/taxCalculationService'
import { BillingAccount, BillingTopup } from '../data/entities'
import { emitBillingEvent } from '../events'
import { captureTopup } from '../lib/topupCapture'
import { getTopupTaxRate } from '../lib/prepaidConfig'

/**
 * Subscriber: `payment_gateways.payment.captured` → prepaid top-up captured.
 *
 * Coexists with `payment-captured-to-paid.ts`: that subscriber matches
 * `paymentId == invoiceId` (postpaid), while a top-up's `paymentId` is a
 * minted UUID that only ever matches a `BillingTopup`. Finding the
 * BillingTopup IS the guard — for any non-top-up payment this is a silent
 * no-op.
 *
 * Idempotent: a re-fired capture on an already-captured top-up is a no-op
 * (the gateway delivers webhooks at-least-once).
 */

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'billing-prepaid-topup-captured',
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

  const topup = await em.findOne(BillingTopup, {
    paymentId: payload.paymentId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    deletedAt: null,
  })
  if (!topup) {
    // Not a prepaid top-up — other subscribers own this captured payment.
    return
  }
  if (topup.status === 'captured') {
    return // idempotent re-fire
  }

  const account = await em.findOne(BillingAccount, {
    id: topup.billAccountId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    deletedAt: null,
  })
  if (!account) {
    return
  }

  const taxRate = await getTopupTaxRate(em)
  const numberGenerator = container.resolve(
    'salesDocumentNumberGenerator',
  ) as SalesDocumentNumberGenerator
  const taxService = container.resolve('taxCalculationService') as TaxCalculationService

  const result = await captureTopup(
    em,
    { numberGenerator, taxService },
    {
      topup,
      account: {
        id: account.id,
        organizationId: account.organizationId,
        tenantId: account.tenantId,
        currencyCode: account.currencyCode,
      },
      taxRate,
      gatewayTransactionId: payload.transactionId ?? null,
    },
  )

  if (result.status !== 'captured') return

  // Side effects fire AFTER the capture transaction commits.
  await emitBillingEvent('billing.balance.topped_up', {
    billAccountId: account.id,
    tenantId: account.tenantId,
    organizationId: account.organizationId,
    topupId: topup.id,
    amount: topup.amount,
    currencyCode: account.currencyCode,
    balance: result.balanceAfter ?? null,
    transactionId: result.transactionId ?? null,
    receiptInvoiceId: result.receiptInvoiceId ?? null,
  })

  // Reuse the postpaid receipt path so the existing mailer / accounting bridge
  // sends the top-up VAT receipt.
  if (result.receiptInvoiceId) {
    await emitBillingEvent('billing.invoice.posted', {
      invoiceId: result.receiptInvoiceId,
      invoiceNumber: result.invoiceNumber ?? null,
      tenantId: account.tenantId,
      organizationId: account.organizationId,
      grandTotalGross: result.grossAmount ?? null,
      currencyCode: account.currencyCode,
      billAccountId: account.id,
      kind: 'prepaid_topup',
    })
  }
}
