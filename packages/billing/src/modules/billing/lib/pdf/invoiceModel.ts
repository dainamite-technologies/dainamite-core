/**
 * Invoice document model (Spec B) — pure.
 *
 * Turns a billing document + its lines + the frozen seller / buyer blocks
 * into the exact strings the PDF prints, in the document language. The
 * renderer (`invoiceTemplate.ts`) only lays this model out, so everything a
 * reader can check (labels, formatting, VAT summary, payment title) is
 * asserted here without parsing a PDF. Same shape as core forms'
 * "build model, then lay out with pdf-lib" snapshot pipeline.
 *
 * Credit / debit memos (Spec D) reuse it: only the title changes and a
 * "corrects" row is added to the header.
 */

import { invoiceIntlLocale } from '../invoiceLanguages'
import { lineServicePeriod } from '../linePeriod'
import { creditReasonText, type CreditReason } from '../creditReason'

export type DocumentTranslate =(key: string, fallback: string) => string

export type PdfAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
}

export type PdfSeller = {
  legalName: string | null
  address: PdfAddress | null
  taxId: string | null
  bankName: string | null
  iban: string | null
  bic: string | null
  footer: string | null
}

export type PdfBuyer = {
  name: string
  address: PdfAddress | null
  taxId: string | null
}

export type PdfInvoice = {
  number: string
  documentType: 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt'
  status: string
  testRun: boolean
  issueDate: Date | string | null
  dueDate: Date | string | null
  billDate: Date | string | null
  periodStart: Date | string | null
  periodEnd: Date | string | null
  currencyCode: string
  subtotalNet: string
  taxTotal: string
  totalGross: string
  correctsNumber?: string | null
  /** Spec D: issue date of the corrected document and the correction reason. */
  correctsIssueDate?: Date | string | null
  correctionReason?: string | null
}

export type PdfLine = {
  description: string
  quantity: string
  unitPriceNet: string
  taxRate: string
  netAmount: string
  taxAmount: string
  grossAmount: string
  servicePeriodStart: Date | string | null
  servicePeriodEnd: Date | string | null
  /** Part 2: why this credit line exists (from line metadata), rendered in the document language. */
  creditReason?: CreditReason | null
}

export type InvoiceDocumentModel = {
  language: string
  title: string
  number: string
  watermark: string | null
  meta: Array<[string, string]>
  seller: { heading: string; lines: string[] }
  buyer: { heading: string; lines: string[] }
  table: {
    headers: string[]
    /** Column alignment: description left, numbers right. */
    align: Array<'left' | 'right'>
    rows: string[][]
  }
  vatSummary: { heading: string; headers: string[]; rows: string[][] }
  totals: Array<[string, string]>
  payment: { heading: string; lines: string[] } | null
  footer: string[]
  pageLabel: (page: number, pages: number) => string
}

/** `Intl` locale for a document language — derived from the language registry. */
export function documentLocale(language: string): string {
  return invoiceIntlLocale(language)
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDocumentDate(value: Date | string | null | undefined, locale: string): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(
    date,
  )
}

export function formatDocumentMoney(value: string | number, currency: string, locale: string): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  const safe = Number.isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe)
  } catch {
    return `${safe.toFixed(2)} ${currency}`
  }
}

function formatNumber(value: string | number, locale: string, maxFraction = 4): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: maxFraction }).format(
    Number.isFinite(n) ? n : 0,
  )
}

function formatPercent(rate: string | number, locale: string): string {
  return `${formatNumber(rate, locale, 2)} %`
}

/** Normalizes Intl's narrow / regular no-break spaces to plain ones (safe for any embedded font). */
function plain(text: string): string {
  return text.replace(/[  ]/g, ' ')
}

function addressLines(address: PdfAddress | null | undefined): string[] {
  if (!address) return []
  const cityLine = [address.postal_code, address.city].filter(Boolean).join(' ')
  return [address.line1, address.line2, cityLine, address.country].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
}

function titleFor(doc: PdfInvoice, t: DocumentTranslate): string {
  switch (doc.documentType) {
    case 'credit_memo':
      return t('billing.pdf.title.credit_memo', 'Credit memo')
    case 'debit_memo':
      return t('billing.pdf.title.debit_memo', 'Debit memo')
    case 'receipt':
      return t('billing.pdf.title.receipt', 'Receipt')
    default:
      return t('billing.pdf.title.invoice', 'VAT invoice')
  }
}

export function buildInvoiceDocumentModel(params: {
  invoice: PdfInvoice
  lines: PdfLine[]
  seller: PdfSeller
  buyer: PdfBuyer
  language: string
  translate: DocumentTranslate
}): InvoiceDocumentModel {
  const { invoice, lines, seller, buyer, translate: t } = params
  const locale = documentLocale(params.language)
  const money = (value: string | number) => plain(formatDocumentMoney(value, invoice.currencyCode, locale))
  const date = (value: Date | string | null | undefined) => plain(formatDocumentDate(value, locale))
  const isDraft = invoice.status === 'draft'

  const meta: Array<[string, string]> = [
    [t('billing.pdf.meta.number', 'Number'), invoice.number],
    [t('billing.pdf.meta.issue_date', 'Issue date'), isDraft ? '—' : date(invoice.issueDate)],
  ]
  if (invoice.documentType !== 'receipt') {
    meta.push([t('billing.pdf.meta.due_date', 'Due date'), isDraft ? '—' : date(invoice.dueDate)])
  }
  if (invoice.periodStart && invoice.periodEnd) {
    meta.push([
      t('billing.pdf.meta.service_period', 'Service period'),
      `${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`,
    ])
  }
  if (invoice.correctsNumber) {
    meta.push([
      t('billing.pdf.meta.corrects', 'Corrects'),
      invoice.correctsIssueDate
        ? `${invoice.correctsNumber} ${t('billing.pdf.meta.of', 'of')} ${date(invoice.correctsIssueDate)}`
        : invoice.correctsNumber,
    ])
  }
  if (invoice.correctionReason) {
    meta.push([t('billing.pdf.meta.reason', 'Reason'), invoice.correctionReason])
  }

  const sellerLines = [
    seller.legalName ?? '',
    ...addressLines(seller.address),
    seller.taxId ? `${t('billing.pdf.tax_id', 'Tax ID')}: ${seller.taxId}` : '',
  ].filter((line) => line !== '')
  const buyerLines = [
    buyer.name,
    ...addressLines(buyer.address),
    buyer.taxId ? `${t('billing.pdf.tax_id', 'Tax ID')}: ${buyer.taxId}` : '',
  ].filter((line) => line !== '')

  const rows = lines.map((line, index) => {
    const servicePeriod = lineServicePeriod(line)
    const described = servicePeriod
      ? `${line.description} (${date(servicePeriod.start)} – ${date(servicePeriod.end)})`
      : line.description
    const description = line.creditReason
      ? `${described}\n${t('billing.pdf.credit_reason', 'Reason')}: ${creditReasonText(line.creditReason, t, (day) => date(day))}`
      : described
    return [
      String(index + 1),
      description,
      plain(formatNumber(line.quantity, locale)),
      money(line.unitPriceNet),
      plain(formatPercent(line.taxRate, locale)),
      money(line.netAmount),
      money(line.taxAmount),
      money(line.grossAmount),
    ]
  })

  // VAT summary: sums of the (already rounded) line amounts per rate, so the
  // summary always adds up to the document totals (B-D2).
  const byRate = new Map<number, { net: number; tax: number; gross: number }>()
  for (const line of lines) {
    const rate = Number.parseFloat(line.taxRate) || 0
    const bucket = byRate.get(rate) ?? { net: 0, tax: 0, gross: 0 }
    bucket.net += Number.parseFloat(line.netAmount) || 0
    bucket.tax += Number.parseFloat(line.taxAmount) || 0
    bucket.gross += Number.parseFloat(line.grossAmount) || 0
    byRate.set(rate, bucket)
  }
  const vatRows = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, sums]) => [plain(formatPercent(rate, locale)), money(sums.net), money(sums.tax), money(sums.gross)])

  const isCredit = invoice.documentType === 'credit_memo'
  const totals: Array<[string, string]> = [
    [t('billing.pdf.totals.net', 'Total net'), money(invoice.subtotalNet)],
    [t('billing.pdf.totals.tax', 'Total VAT'), money(invoice.taxTotal)],
    isCredit
      ? [t('billing.pdf.totals.credited', 'Total credited'), money(invoice.totalGross)]
      : [t('billing.pdf.totals.gross', 'Total due'), money(invoice.totalGross)],
  ]

  const payable = invoice.documentType === 'invoice' || invoice.documentType === 'debit_memo'
  const payment =
    payable && seller.iban
      ? {
          heading: t('billing.pdf.payment.heading', 'Payment'),
          lines: [
            `${t('billing.pdf.payment.amount', 'Amount')}: ${money(invoice.totalGross)}`,
            `${t('billing.pdf.payment.due', 'Due by')}: ${isDraft ? '—' : date(invoice.dueDate)}`,
            seller.bankName ? `${t('billing.pdf.payment.bank', 'Bank')}: ${seller.bankName}` : '',
            `IBAN: ${seller.iban.replace(/(.{4})/g, '$1 ').trim()}`,
            seller.bic ? `BIC: ${seller.bic}` : '',
            // Spec C's matcher finds the invoice number in the transfer title.
            `${t('billing.pdf.payment.title', 'Transfer title')}: ${invoice.number}`,
          ].filter((line) => line !== ''),
        }
      : isCredit
        ? {
            // A credit memo is not paid: it settles the corrected invoice and
            // any remainder stays as credit on the customer's account (D-D10).
            heading: t('billing.pdf.memo.settlement', 'Settlement'),
            lines: [
              `${t('billing.pdf.memo.amount_credited', 'Amount credited')}: ${money(invoice.totalGross)}`,
              invoice.correctsNumber
                ? t('billing.pdf.memo.settled_against', 'Settled against invoice {number}; any remainder is credited to your account.').replace(
                    '{number}',
                    invoice.correctsNumber,
                  )
                : t('billing.pdf.memo.credited_to_account', 'The amount is credited to your account.'),
            ],
          }
        : null

  return {
    language: params.language,
    title: titleFor(invoice, t),
    number: invoice.number,
    watermark: invoice.testRun
      ? t('billing.pdf.watermark.test', 'TEST')
      : isDraft
        ? t('billing.pdf.watermark.draft', 'DRAFT')
        : null,
    meta,
    seller: { heading: t('billing.pdf.seller', 'Seller'), lines: sellerLines },
    buyer: { heading: t('billing.pdf.buyer', 'Buyer'), lines: buyerLines },
    table: {
      headers: [
        '#',
        t('billing.pdf.columns.description', 'Description'),
        t('billing.pdf.columns.quantity', 'Qty'),
        t('billing.pdf.columns.unit_net', 'Unit net'),
        t('billing.pdf.columns.tax_rate', 'VAT %'),
        t('billing.pdf.columns.net', 'Net'),
        t('billing.pdf.columns.tax', 'VAT'),
        t('billing.pdf.columns.gross', 'Gross'),
      ],
      align: ['right', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
      rows,
    },
    vatSummary: {
      heading: t('billing.pdf.vat_summary', 'VAT summary'),
      headers: [
        t('billing.pdf.columns.tax_rate', 'VAT %'),
        t('billing.pdf.columns.net', 'Net'),
        t('billing.pdf.columns.tax', 'VAT'),
        t('billing.pdf.columns.gross', 'Gross'),
      ],
      rows: vatRows,
    },
    totals,
    payment,
    footer: (seller.footer ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    pageLabel: (page, pages) =>
      t('billing.pdf.page', 'Page {page} of {pages}').replace('{page}', String(page)).replace('{pages}', String(pages)),
  }
}
