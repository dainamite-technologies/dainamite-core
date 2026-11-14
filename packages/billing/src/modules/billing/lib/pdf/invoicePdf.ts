import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingAccount, BillingInvoice, BillingInvoiceLine } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import { buildSellerSnapshot, getBillingSettings } from '../billingSettings'
import { buildBuyerSnapshot } from '../documentParties'
import { DEFAULT_INVOICE_LANGUAGE } from '../invoiceLanguages'
import { buildInvoiceDocumentModel, type DocumentTranslate, type PdfAddress } from './invoiceModel'
import { renderInvoicePdf, type PdfLogo } from './invoiceTemplate'
import { attachmentIdFromUrl, readAttachment, storeAttachment } from './attachmentStore'

/**
 * Billing document PDFs (Spec B, P-D1 / B-D5):
 *
 *   - posted documents are rendered once and frozen as an attachment
 *     (`pdf_attachment_id`); later downloads stream the stored file, so the
 *     document never changes after issue. If freezing failed at post, the
 *     first download renders and freezes it (lazy fallback).
 *   - drafts and test documents are rendered live with a DRAFT / TEST
 *     watermark and never stored.
 *
 * Parties come from the frozen snapshots on posted documents and from the
 * live account / settings on drafts. Labels use the document language
 * (`invoice_language`), never the operator's UI locale.
 */

export type TranslatorLoader = (language: string) => Promise<DocumentTranslate>

/** Billing i18n for a document language (en / pl, falling back to en). */
export const loadDocumentTranslator: TranslatorLoader = async (language) => {
  const { loadDictionary } = await import('@open-mercato/shared/lib/i18n/server')
  const { createFallbackTranslator } = await import('@open-mercato/shared/lib/i18n/translate')
  const locale = language === 'pl' ? 'pl' : 'en'
  const translate = createFallbackTranslator(await loadDictionary(locale))
  return (key, fallback) => translate(key, fallback)
}

type Snapshot = Record<string, unknown>

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function address(value: unknown): PdfAddress | null {
  return value && typeof value === 'object' ? (value as PdfAddress) : null
}

export function pdfFileName(invoice: Pick<BillingInvoice, 'number'>): string {
  return `${invoice.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`
}

function isFrozenDocument(invoice: Pick<BillingInvoice, 'status' | 'testRun'>): boolean {
  return invoice.status !== 'draft' && !invoice.testRun
}

async function resolveParties(em: EntityManager, invoice: BillingInvoice) {
  const scope = { tenantId: invoice.tenantId, organizationId: invoice.organizationId }
  let seller: Snapshot | null = isFrozenDocument(invoice) ? (invoice.sellerSnapshot ?? null) : null
  let buyer: Snapshot | null = isFrozenDocument(invoice) ? (invoice.buyerSnapshot ?? null) : null
  if (!seller || !('legal_name' in seller)) seller = buildSellerSnapshot(await getBillingSettings(em, scope))
  if (!buyer) {
    const account = await em.findOne(BillingAccount, { id: invoice.billAccountId, ...scope } as never)
    buyer = account ? buildBuyerSnapshot(account) : { name: '' }
  }
  return { seller, buyer }
}

async function resolveLogo(em: EntityManager, invoice: BillingInvoice, seller: Snapshot): Promise<PdfLogo | null> {
  const scope = { tenantId: invoice.tenantId, organizationId: invoice.organizationId }
  let attachmentId = str(seller.logo_attachment_id)
  if (!attachmentId) {
    // Fallback: the organization logo, only when it is one of our own
    // attachments (never fetch arbitrary URLs server-side).
    const rows = (await em.execute(`SELECT logo_url FROM organizations WHERE id = ? LIMIT 1`, [
      invoice.organizationId,
    ])) as unknown as Array<{ logo_url: string | null }>
    attachmentId = attachmentIdFromUrl(rows?.[0]?.logo_url)
  }
  if (!attachmentId) return null
  const file = await readAttachment(em, scope, attachmentId)
  return file ? { bytes: file.bytes, mimeType: file.mimeType } : null
}

/** Renders a billing document as it should print now (no storage). */
export async function renderBillingDocument(
  em: EntityManager,
  invoice: BillingInvoice,
  deps: { loadTranslator?: TranslatorLoader } = {},
): Promise<Uint8Array> {
  const scope = { tenantId: invoice.tenantId, organizationId: invoice.organizationId }
  const lines = await em.find(
    BillingInvoiceLine,
    { invoiceId: invoice.id, ...scope, deletedAt: null } as never,
    { orderBy: { lineNumber: 'asc' } as never },
  )
  const { seller, buyer } = await resolveParties(em, invoice)
  const language = str(buyer.invoice_language) ?? DEFAULT_INVOICE_LANGUAGE
  const translate = await (deps.loadTranslator ?? loadDocumentTranslator)(language)

  let correctsNumber: string | null = null
  if (invoice.correctsInvoiceId) {
    const corrected = await em.findOne(BillingInvoice, { id: invoice.correctsInvoiceId, ...scope } as never)
    correctsNumber = corrected?.number ?? null
  }

  const model = buildInvoiceDocumentModel({
    invoice: {
      number: invoice.number,
      documentType: invoice.documentType as 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt',
      status: invoice.status,
      testRun: invoice.testRun,
      issueDate: invoice.issueDate ?? null,
      dueDate: invoice.dueDate ?? null,
      billDate: invoice.billDate ?? null,
      periodStart: invoice.periodStart ?? null,
      periodEnd: invoice.periodEnd ?? null,
      currencyCode: invoice.currencyCode,
      subtotalNet: invoice.subtotalNet,
      taxTotal: invoice.taxTotal,
      totalGross: invoice.totalGross,
      correctsNumber,
    },
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxRate: line.taxRate,
      netAmount: line.netAmount,
      taxAmount: line.taxAmount,
      grossAmount: line.grossAmount,
      servicePeriodStart: line.servicePeriodStart ?? null,
      servicePeriodEnd: line.servicePeriodEnd ?? null,
    })),
    seller: {
      legalName: str(seller.legal_name),
      address: address(seller.address),
      taxId: str(seller.tax_id),
      bankName: str(seller.bank_name),
      iban: str(seller.iban),
      bic: str(seller.bic),
      footer: str(seller.invoice_footer),
    },
    buyer: {
      name: str(buyer.name) ?? '',
      address: address(buyer.invoice_address),
      taxId: str(buyer.tax_id),
    },
    language,
    translate,
  })
  return renderInvoicePdf(model, { logo: await resolveLogo(em, invoice, seller) })
}

/**
 * Renders and stores the PDF of a posted document once. Idempotent: returns
 * the existing attachment id when already frozen. The column is claimed with
 * a conditional update, so concurrent freezes never overwrite each other.
 */
export async function freezeInvoicePdf(
  em: EntityManager,
  invoice: BillingInvoice,
  deps: { loadTranslator?: TranslatorLoader } = {},
): Promise<{ attachmentId: string; bytes: Uint8Array | null }> {
  if (invoice.pdfAttachmentId) return { attachmentId: invoice.pdfAttachmentId, bytes: null }
  if (!isFrozenDocument(invoice)) throw new Error('Only posted, non-test documents are frozen')
  const bytes = await renderBillingDocument(em, invoice, deps)
  const scope = { tenantId: invoice.tenantId, organizationId: invoice.organizationId }
  const attachmentId = await storeAttachment(em, scope, {
    entityId: billingEntityIds.invoice,
    recordId: invoice.id,
    fileName: pdfFileName(invoice),
    mimeType: 'application/pdf',
    bytes,
  })
  await em.nativeUpdate(
    BillingInvoice,
    { id: invoice.id, ...scope, pdfAttachmentId: null } as never,
    { pdfAttachmentId: attachmentId } as never,
  )
  invoice.pdfAttachmentId = attachmentId
  return { attachmentId, bytes }
}

/**
 * The PDF to serve / attach: the frozen file for posted documents (frozen
 * now if it never was), a live watermarked render for drafts and tests.
 */
export async function getInvoicePdf(
  em: EntityManager,
  invoice: BillingInvoice,
  deps: { loadTranslator?: TranslatorLoader } = {},
): Promise<{ bytes: Uint8Array; fileName: string; frozen: boolean }> {
  const fileName = pdfFileName(invoice)
  if (!isFrozenDocument(invoice)) {
    return { bytes: await renderBillingDocument(em, invoice, deps), fileName, frozen: false }
  }
  if (invoice.pdfAttachmentId) {
    const stored = await readAttachment(
      em,
      { tenantId: invoice.tenantId, organizationId: invoice.organizationId },
      invoice.pdfAttachmentId,
    )
    if (stored) return { bytes: stored.bytes, fileName, frozen: true }
    // Stored file lost (storage moved / purged): serve a fresh render from
    // the frozen snapshots rather than failing; the attachment id is kept.
    console.warn('[billing.pdf] frozen PDF unreadable, rendering from snapshots', invoice.id)
    return { bytes: await renderBillingDocument(em, invoice, deps), fileName, frozen: true }
  }
  const frozen = await freezeInvoicePdf(em, invoice, deps)
  return {
    bytes: frozen.bytes ?? (await renderBillingDocument(em, invoice, deps)),
    fileName,
    frozen: true,
  }
}
