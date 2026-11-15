import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { SendEmailOptions } from '@open-mercato/shared/lib/email/send'
import { BillingAccount, BillingInvoice } from '../data/entities'
import { emitBillingEvent } from '../events'
import { resolveInvoiceLanguage } from './invoiceLanguages'
import { formatIban } from './iban'
import { documentLocale, formatDocumentDate, formatDocumentMoney, type DocumentTranslate } from './pdf/invoiceModel'
import { getInvoicePdf, loadDocumentTranslator, type TranslatorLoader } from './pdf/invoicePdf'

/**
 * Emails a posted billing document to the account's invoice address with
 * the frozen PDF attached (Spec B), through the platform's standard
 * `sendEmail()` — no custom transport.
 *
 *   - posted (non-draft, non-test) documents only → 409 `billing.invoice.not_posted`;
 *   - the connector's placeholder addresses (`@invalid.local`) and malformed
 *     emails are refused → 422 `billing.invoice.email_invalid`, nothing sent;
 *   - every attempt appends `{ at, to, status, error?, trigger }` to
 *     `metadata.deliveries` (atomic jsonb append — concurrent sends never
 *     lose an entry) and emits `billing.invoice.sent` / `send_failed`;
 *   - transport errors (e.g. `EMAIL_TRANSPORT_NOT_CONFIGURED`) are recorded
 *     as a `failed` delivery and returned, never thrown — posting is
 *     unaffected and the operator sees the reason.
 */

export type DeliveryTrigger = 'manual' | 'auto'

export type InvoiceDelivery = {
  at: string
  to: string
  status: 'sent' | 'failed'
  error?: string | null
  trigger: DeliveryTrigger
}

export type SendInvoiceResult = { invoiceId: string; to: string; status: 'sent' | 'failed'; error: string | null }

export type SendEmailFn = (options: SendEmailOptions) => Promise<void>

export type SendInvoiceDeps = {
  sendEmail?: SendEmailFn
  loadTranslator?: TranslatorLoader
  now?: () => Date
}

const PLACEHOLDER_DOMAIN = '@invalid.local'
const emailSchema = z.string().trim().email()

export function isDeliverableEmail(value: string | null | undefined): value is string {
  if (!value) return false
  if (value.trim().toLowerCase().endsWith(PLACEHOLDER_DOMAIN)) return false
  return emailSchema.safeParse(value).success
}

export function hasSuccessfulDelivery(
  invoice: Pick<BillingInvoice, 'metadata'>,
  trigger?: DeliveryTrigger,
): boolean {
  const deliveries = (invoice.metadata?.deliveries ?? []) as InvoiceDelivery[]
  return Array.isArray(deliveries) && deliveries.some((d) => d.status === 'sent' && (!trigger || d.trigger === trigger))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match)
}

/** Subject + plain-text and HTML bodies in the document language. Pure. */
export function buildInvoiceEmail(params: {
  invoice: Pick<BillingInvoice, 'number' | 'totalGross' | 'currencyCode' | 'dueDate'>
  buyerName: string
  sellerName: string | null
  iban: string | null
  language: string
  translate: DocumentTranslate
}): { subject: string; text: string; html: string } {
  const { invoice, translate: t } = params
  const locale = documentLocale(params.language)
  const values = {
    number: invoice.number,
    name: params.buyerName,
    amount: formatDocumentMoney(invoice.totalGross, invoice.currencyCode, locale).replace(/[  ]/g, ' '),
    dueDate: formatDocumentDate(invoice.dueDate ?? null, locale),
    iban: params.iban ? formatIban(params.iban) : '',
  }
  const paragraphs = [
    fill(t('billing.email.invoice.greeting', 'Hello {name},'), values),
    fill(t('billing.email.invoice.body', 'Please find attached invoice {number} for {amount}, due on {dueDate}.'), values),
    params.iban
      ? fill(t('billing.email.invoice.payment', 'Please pay to IBAN {iban} with the transfer title {number}.'), values)
      : '',
    [t('billing.email.invoice.closing', 'Kind regards,'), params.sellerName ?? ''].filter(Boolean).join('\n'),
  ].filter(Boolean)
  return {
    subject: fill(t('billing.email.invoice.subject', 'Invoice {number}'), values),
    text: paragraphs.join('\n\n'),
    html: paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join(''),
  }
}

async function defaultSendEmail(options: SendEmailOptions): Promise<void> {
  const { sendEmail } = await import('@open-mercato/shared/lib/email/send')
  await sendEmail(options)
}

async function appendDelivery(em: EntityManager, invoice: BillingInvoice, delivery: InvoiceDelivery): Promise<void> {
  await em.execute(
    `UPDATE billing_invoices
        SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{deliveries}',
                                 COALESCE(metadata->'deliveries', '[]'::jsonb) || ?::jsonb),
            updated_at = now()
      WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
    [JSON.stringify([delivery]), invoice.id, invoice.tenantId, invoice.organizationId],
  )
  const deliveries = Array.isArray(invoice.metadata?.deliveries) ? (invoice.metadata?.deliveries as InvoiceDelivery[]) : []
  invoice.metadata = { ...(invoice.metadata ?? {}), deliveries: [...deliveries, delivery] }
}

export async function sendInvoice(
  em: EntityManager,
  params: { invoiceId: string; tenantId: string; organizationId: string; trigger: DeliveryTrigger },
  deps: SendInvoiceDeps = {},
): Promise<SendInvoiceResult> {
  const scope = { tenantId: params.tenantId, organizationId: params.organizationId }
  const invoice = await em.findOne(BillingInvoice, { id: params.invoiceId, ...scope, deletedAt: null } as never)
  if (!invoice) throw new CrudHttpError(404, { error: 'Invoice not found' })
  if (invoice.status === 'draft' || invoice.testRun) {
    throw new CrudHttpError(409, {
      error: 'Only posted invoices can be sent',
      code: 'billing.invoice.not_posted',
    })
  }

  // The live account address wins (an operator may fix a bad address and
  // resend); the frozen buyer snapshot is the fallback for a deleted account.
  const account = await em.findOne(BillingAccount, { id: invoice.billAccountId, ...scope } as never)
  const buyer = (invoice.buyerSnapshot ?? {}) as Record<string, unknown>
  const to = account?.invoiceEmail ?? (typeof buyer.invoice_email === 'string' ? buyer.invoice_email : '')
  if (!isDeliverableEmail(to)) {
    throw new CrudHttpError(422, {
      error: 'The billing account has no deliverable invoice email',
      code: 'billing.invoice.email_invalid',
    })
  }

  const language = resolveInvoiceLanguage(
    (typeof buyer.invoice_language === 'string' && buyer.invoice_language) || account?.invoiceLanguage,
  )
  const translate = await (deps.loadTranslator ?? loadDocumentTranslator)(language)
  const seller = (invoice.sellerSnapshot ?? {}) as Record<string, unknown>
  const email = buildInvoiceEmail({
    invoice,
    buyerName: (typeof buyer.name === 'string' && buyer.name) || account?.name || '',
    sellerName: typeof seller.legal_name === 'string' ? seller.legal_name : null,
    iban: typeof seller.iban === 'string' ? seller.iban : null,
    language,
    translate,
  })

  const now = deps.now ?? (() => new Date())
  let error: string | null = null
  try {
    const pdf = await getInvoicePdf(em, invoice, { loadTranslator: deps.loadTranslator })
    await (deps.sendEmail ?? defaultSendEmail)({
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: [{ filename: pdf.fileName, content: Buffer.from(pdf.bytes).toString('base64'), contentType: 'application/pdf' }],
      tenantId: params.tenantId,
      organizationId: params.organizationId,
    })
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    console.warn('[billing.invoice.send] delivery failed', invoice.id, error)
  }

  const status: InvoiceDelivery['status'] = error ? 'failed' : 'sent'
  await appendDelivery(em, invoice, { at: now().toISOString(), to, status, error, trigger: params.trigger })
  await emitBillingEvent(status === 'sent' ? 'billing.invoice.sent' : 'billing.invoice.send_failed', {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    billAccountId: invoice.billAccountId,
    to,
    trigger: params.trigger,
    error,
    tenantId: invoice.tenantId,
    organizationId: invoice.organizationId,
  })
  return { invoiceId: invoice.id, to, status, error }
}
