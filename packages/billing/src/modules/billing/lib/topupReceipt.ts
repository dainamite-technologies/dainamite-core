import type { EntityManager } from '@mikro-orm/postgresql'
import {
  SalesInvoice,
  SalesInvoiceLine,
} from '@open-mercato/core/modules/sales/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import type { TaxCalculationService } from '@open-mercato/core/modules/sales/services/taxCalculationService'
import { resolveInvoiceStatusEntryId } from './invoiceStatus'

/**
 * Creates the fiscal VAT receipt for a captured prepaid top-up (SPEC-002 P2).
 *
 * Deliberate divergence from the postpaid draft→post gate: a captured top-up
 * is a completed, already-paid transaction with nothing to review, so the
 * receipt is created **posted + paid** in one shot (the gate exists for
 * outbound bills, not money already received — mirrors the xd-249 "deviations"
 * convention).
 *
 * **VAT at top-up.** The top-up `amount` is the GROSS the customer paid (= the
 * balance credited). The core tax service splits it into net + VAT at the
 * configured rate. Gap-free numbering reuses `salesDocumentNumberGenerator`.
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

export type TopupReceiptDeps = {
  numberGenerator: Pick<SalesDocumentNumberGenerator, 'generate'>
  taxService: TaxCalculationService
}

export type TopupReceipt = {
  invoiceId: string
  invoiceNumber: string
  netAmount: string
  taxAmount: string
  grossAmount: string
  taxRate: number
}

function fmt4(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(4)
}

export async function createTopupReceipt(
  em: EntityManager,
  deps: TopupReceiptDeps,
  params: TopupReceiptParams,
): Promise<TopupReceipt> {
  const { account } = params

  // VAT split — the top-up amount is GROSS (what was paid = balance credited).
  const tax = await deps.taxService.calculateUnitAmounts({
    amount: Number.parseFloat(params.amount),
    mode: 'gross',
    organizationId: account.organizationId,
    tenantId: account.tenantId,
    taxRate: params.taxRate,
  })
  const net = fmt4(tax.netAmount)
  const gross = fmt4(tax.grossAmount)
  const taxAmount = fmt4(tax.taxAmount)
  const effectiveRate = tax.taxRate ?? 0

  const generated = await deps.numberGenerator.generate({
    kind: 'invoice',
    organizationId: account.organizationId,
    tenantId: account.tenantId,
  })

  // Posted+paid in one shot — resolve the `paid` status entry directly.
  const paidStatusEntryId = await resolveInvoiceStatusEntryId(
    em,
    account.tenantId,
    account.organizationId,
    'paid',
  )

  const now = new Date()
  const invoice = em.create(SalesInvoice, {
    organizationId: account.organizationId,
    tenantId: account.tenantId,
    invoiceNumber: generated.number,
    statusEntryId: paidStatusEntryId,
    status: 'paid',
    issueDate: now,
    currencyCode: account.currencyCode,
    subtotalNetAmount: net,
    subtotalGrossAmount: gross,
    discountTotalAmount: '0',
    taxTotalAmount: taxAmount,
    grandTotalNetAmount: net,
    grandTotalGrossAmount: gross,
    paidTotalAmount: gross,
    outstandingAmount: '0',
    metadata: {
      kind: 'prepaid_topup',
      bill_account_id: account.id,
      topup_id: params.topupId,
      payment_id: params.paymentId,
    },
    createdAt: now,
    updatedAt: now,
  })
  em.persist(invoice)

  const line = em.create(SalesInvoiceLine, {
    invoice,
    organizationId: account.organizationId,
    tenantId: account.tenantId,
    lineNumber: 1,
    kind: 'service',
    description: 'Account top-up',
    quantity: '1',
    normalizedQuantity: '1',
    currencyCode: account.currencyCode,
    unitPriceNet: net,
    unitPriceGross: gross,
    discountAmount: '0',
    discountPercent: '0',
    taxRate: fmt4(effectiveRate),
    taxAmount,
    totalNetAmount: net,
    totalGrossAmount: gross,
    metadata: {
      kind: 'prepaid_topup',
      topup_id: params.topupId,
    },
  })
  em.persist(line)
  await em.flush()

  return {
    invoiceId: invoice.id,
    invoiceNumber: generated.number,
    netAmount: net,
    taxAmount,
    grossAmount: gross,
    taxRate: effectiveRate,
  }
}
