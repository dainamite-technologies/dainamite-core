import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingTopup } from '../data/entities'
import { applyBalanceMovement } from './balanceLedger'
import { createTopupReceipt, type TopupReceiptDeps } from './topupReceipt'

/**
 * Idempotent top-up capture (SPEC-002 P2).
 *
 * On `payment_gateways.payment.captured` for a top-up, in ONE DB transaction:
 *   - credit the balance (atomic) + append a `type='topup'` transaction with a
 *     deterministic `source_ref = topup-{paymentId}` (so a re-fired capture can
 *     never double-credit),
 *   - create the posted+paid VAT receipt in core/sales,
 *   - transition the BillingTopup → captured, backfilling `transaction_id` +
 *     `receipt_invoice_id`.
 *
 * Re-firing on an already-captured top-up is a no-op (the gateway delivers
 * webhooks at-least-once).
 */

export type CaptureTopupAccount = {
  id: string
  organizationId: string
  tenantId: string
  currencyCode: string
}

export type CaptureTopupParams = {
  topup: BillingTopup
  account: CaptureTopupAccount
  /** VAT percent applied to the receipt. */
  taxRate: number
  /** Provider transaction id for the transaction metadata, if known. */
  gatewayTransactionId?: string | null
}

export type CaptureTopupResult = {
  status: 'captured' | 'already_captured'
  balanceAfter?: string
  transactionId?: string
  receiptInvoiceId?: string
  invoiceNumber?: string
  grossAmount?: string
}

export async function captureTopup(
  em: EntityManager,
  deps: TopupReceiptDeps,
  params: CaptureTopupParams,
): Promise<CaptureTopupResult> {
  const { topup, account } = params

  if (topup.status === 'captured') {
    return { status: 'already_captured' }
  }

  return em.transactional(async (tem) => {
    // 1. Atomic credit + paired transaction (idempotent on source_ref).
    const movement = await applyBalanceMovement(tem as EntityManager, {
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      billAccountId: account.id,
      currencyCode: account.currencyCode,
      type: 'topup',
      amount: topup.amount,
      description: `Top-up — ${topup.providerKey}`,
      topupId: topup.id,
      sourceRef: `topup-${topup.paymentId}`,
      metadata: {
        provider_key: topup.providerKey,
        payment_id: topup.paymentId,
        gateway_transaction_id: params.gatewayTransactionId ?? topup.gatewayTransactionId ?? null,
      },
    })

    // A deduplicated credit means a PRIOR capture already committed (the
    // gateway delivers `payment.captured` at-least-once, and the stale
    // `status` check above can race a concurrent capture). Do NOT issue a
    // second fiscal receipt — return the existing capture's links.
    if (movement.deduplicated) {
      const prior = await tem.findOne(BillingTopup, { id: topup.id })
      return {
        status: 'already_captured' as const,
        balanceAfter: movement.balanceAfter,
        transactionId: prior?.transactionId ?? movement.transaction.id,
        receiptInvoiceId: prior?.receiptInvoiceId ?? undefined,
      }
    }

    // 2. Fiscal VAT receipt (posted+paid).
    const receipt = await createTopupReceipt(tem as EntityManager, deps, {
      account,
      topupId: topup.id,
      paymentId: topup.paymentId,
      amount: topup.amount,
      taxRate: params.taxRate,
    })

    // 3. Transition the top-up.
    const managed = await tem.findOne(BillingTopup, { id: topup.id })
    const target = managed ?? topup
    target.status = 'captured'
    target.transactionId = movement.transaction.id
    target.receiptInvoiceId = receipt.invoiceId
    target.updatedAt = new Date()
    await tem.flush()

    return {
      status: 'captured' as const,
      balanceAfter: movement.balanceAfter,
      transactionId: movement.transaction.id,
      receiptInvoiceId: receipt.invoiceId,
      invoiceNumber: receipt.invoiceNumber,
      grossAmount: receipt.grossAmount,
    }
  })
}
