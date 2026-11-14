import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingInvoice, BillingInvoiceLine } from '../data/entities'
import { getBillingSettings, numberMaskFor } from './billingSettings'
import { claimDocumentNumber } from './numbering'
import { lineAmountsFromGross, money4 } from './vat'

/**
 * Creates the fiscal VAT receipt for a captured prepaid top-up (SPEC-002 P2,
 * Spec 0 E-D3).
 *
 * The receipt is a billing-owned document (`billing_invoices` with
 * `document_type = 'receipt'`, `status = 'paid'`), numbered from the
 * `receipt` series (default mask `RC/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`).
 * Nothing is written to core `sales`.
 *
 * VAT at top-up: the top-up `amount` is the GROSS the customer paid (= the
 * balance credited); `vat.lineAmountsFromGross` splits it into net + tax with
 * `net + tax = gross` exactly.
 *
 * MUST run inside the capture transaction (`captureTopup`) so the receipt
 * number, the balance credit and the top-up transition commit together.
 */

export type TopupReceiptParams = {
  account: {
    id: string
    organizationId: string
    tenantId: string
    currencyCode: string
  }
  topupId: string
  paymentId: string
  /** Gross amount paid (numeric(18,4) string). */
  amount: string
  /** VAT percent (e.g. 23). 0 = no VAT. */
  taxRate: number
}

export type TopupReceipt = {
  invoiceId: string
  invoiceNumber: string
  netAmount: string
  taxAmount: string
  grossAmount: string
  taxRate: number
}

function todayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function createTopupReceipt(em: EntityManager, params: TopupReceiptParams): Promise<TopupReceipt> {
  const { account } = params
  const scope = { tenantId: account.tenantId, organizationId: account.organizationId }
  const taxRate = Number.isFinite(params.taxRate) && params.taxRate > 0 ? params.taxRate : 0
  const amounts = lineAmountsFromGross(Number.parseFloat(params.amount), taxRate)
  const net = money4(amounts.net)
  const tax = money4(amounts.tax)
  const gross = money4(amounts.gross)

  const settings = await getBillingSettings(em, scope)
  const issueDate = todayUtc()
  const claimed = await claimDocumentNumber(em, scope, 'receipt', numberMaskFor(settings, 'receipt'), issueDate)

  const now = new Date()
  const receipt = em.create(BillingInvoice, {
    ...scope,
    billAccountId: account.id,
    documentType: 'receipt',
    number: claimed.number,
    series: 'receipt',
    status: 'paid',
    testRun: false,
    issueDate,
    postedAt: now,
    currencyCode: account.currencyCode,
    subtotalNet: net,
    taxTotal: tax,
    totalGross: gross,
    paidTotal: gross,
    creditedTotal: '0',
    outstanding: '0',
    topupId: params.topupId,
    metadata: { kind: 'prepaid_topup', payment_id: params.paymentId },
    createdAt: now,
    updatedAt: now,
  })
  em.persist(receipt)
  await em.flush() // need the receipt id for the line

  em.persist(
    em.create(BillingInvoiceLine, {
      ...scope,
      invoiceId: receipt.id,
      lineNumber: 1,
      billingType: 'receipt',
      description: 'Account top-up',
      quantity: '1.0000',
      unitPriceNet: net,
      taxRate: taxRate.toFixed(4),
      netAmount: net,
      taxAmount: tax,
      grossAmount: gross,
      metadata: { kind: 'prepaid_topup', topup_id: params.topupId },
      createdAt: now,
      updatedAt: now,
    }),
  )
  await em.flush()

  return {
    invoiceId: receipt.id,
    invoiceNumber: claimed.number,
    netAmount: net,
    taxAmount: tax,
    grossAmount: gross,
    taxRate,
  }
}
