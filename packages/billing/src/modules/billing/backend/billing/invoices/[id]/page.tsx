"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { FileDown, Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDateTime, formatBillingDay } from '../../../../lib/displayDate'
import { localizeDescriptionPeriod } from '../../../../lib/linePeriod'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { BillingDataTable as DataTable } from '../../../../components/BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { LineFormDialog, type LineFormValues } from '../../../../components/LineFormDialog'
import { BillingSettingsLink } from '../../../../components/BillingSettingsLink'
import {
  DetailCard,
  DetailField,
  Stat,
  StatCard,
} from '../../../../components/DetailFields'
import { billRunName } from '../../../../lib/billRunLabel'
import { InvoiceLineExtras } from '../../../../components/InvoiceLineExtras'
import { invoicePdfHref, resolveInvoiceReturnTarget } from '../../../../lib/navigation'
import { CreateMemoDialog } from '../../../../components/CreateMemoDialog'

// Spec 0: billing_invoices / billing_invoice_lines field names.
type BillingInvoice = {
  id: string
  number: string
  document_type: 'invoice' | 'credit_memo' | 'debit_memo' | 'receipt'
  status: 'draft' | 'posted' | 'partially_paid' | 'paid' | 'credited'
  test_run: boolean
  bill_account_id: string
  bill_account_name: string | null
  bill_run_id: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net: string
  tax_total: string
  total_gross: string
  paid_total: string
  outstanding: string
  days_overdue?: number
  pdf_attachment_id?: string | null
  // Spec D — corrective documents
  corrects_invoice_id?: string | null
  corrects_invoice_number?: string | null
  correction_reason?: string | null
  buyer_snapshot?: { invoice_email?: string } | null
  metadata?: { draft_number?: string; deliveries?: InvoiceDelivery[] } | null
  created_at: string
  updated_at: string
}

// Spec B: one entry per email attempt (metadata.deliveries).
type InvoiceDelivery = {
  at: string
  to: string
  status: 'sent' | 'failed'
  error?: string | null
  trigger: 'manual' | 'auto'
}

type InvoiceLine = {
  id: string
  line_number: number
  billing_type: string
  description: string | null
  quantity: string
  currency_code: string
  unit_price_net: string
  tax_rate: string | number | null
  net_amount: string
  tax_amount: string
  gross_amount: string
  service_period_start: string | null
  service_period_end: string | null
  metadata: { operator_added?: boolean; usage_tier_breakdown?: unknown } | null
}

// Spec C: what settled this receivable (payments; Spec D: credit memos).
type InvoiceAllocation = {
  id: string
  source_type: 'payment' | 'credit_memo'
  source_id: string
  source_label: string | null
  amount: string
  currency_code: string
  allocated_by: string
  created_at: string
}

type DetailResponse = {
  invoice: BillingInvoice
  lines: InvoiceLine[]
  allocations?: InvoiceAllocation[]
  corrections?: InvoiceCorrection[]
}

// Spec D: memos correcting this document.
type InvoiceCorrection = {
  id: string
  number: string
  document_type: 'credit_memo' | 'debit_memo'
  status: string
  total_gross: string
  currency_code: string
}

function statusVariant(
  status: BillingInvoice['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'paid':
    case 'credited':
      return 'success'
    case 'posted':
    case 'partially_paid':
      return 'warning'
    case 'draft':
    default:
      return 'default'
  }
}

function lineKindVariant(
  type: string,
): 'default' | 'success' | 'warning' | 'error' {
  switch (type) {
    case 'one_time':
      return 'warning'
    case 'recurring':
      return 'success'
    case 'usage':
      return 'default'
    default:
      return 'default'
  }
}

function formatMoney(value: string, currency: string): string {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return value
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
  } catch {
    return `${value} ${currency}`
  }
}

export default function BillingInvoiceDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  // OM serves backend pages through a catch-all route — the dynamic
  // `[id]` segment arrives as a page prop; `useParams()` is the fallback.
  const urlParams = useParams<{ id: string }>()
  const invoiceId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [invoice, setInvoice] = React.useState<BillingInvoice | null>(null)
  const [lines, setLines] = React.useState<InvoiceLine[]>([])
  // Bill Run + Billing Account are stored as FK ids in invoice metadata;
  // resolve their human names so the detail card shows names, not UUIDs.
  const [accountName, setAccountName] = React.useState<string | null>(null)
  const [runName, setRunName] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [posting, setPosting] = React.useState(false)
  const [settingsIncomplete, setSettingsIncomplete] = React.useState(false)

  // Client-side pagination for invoice lines. Caps the table at 100 rows
  // per page (per the OM DataTable convention) — invoices typically have
  // <20 lines, but bulk import or a long-running usage-rated subscription
  // can exceed that.
  const [linesPage, setLinesPage] = React.useState(1)
  const linesPageSize = 100
  const visibleLines = React.useMemo(
    () => lines.slice((linesPage - 1) * linesPageSize, linesPage * linesPageSize),
    [lines, linesPage],
  )
  const linesTotalPages = Math.max(1, Math.ceil(lines.length / linesPageSize))

  // Inline line-edit dialog state. `dialogMode === null` → closed.
  const [dialogMode, setDialogMode] = React.useState<'add' | 'edit' | null>(null)
  const [dialogTargetLine, setDialogTargetLine] = React.useState<InvoiceLine | null>(null)
  const [dialogSubmitting, setDialogSubmitting] = React.useState(false)

  // Confirm flows (remove line, send, memo delete) use ConfirmDialog
  // (per UI AGENTS.md: NEVER `window.confirm`).
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [allocations, setAllocations] = React.useState<InvoiceAllocation[]>([])
  const [corrections, setCorrections] = React.useState<InvoiceCorrection[]>([])
  const [memoDialog, setMemoDialog] = React.useState<'credit_memo' | 'debit_memo' | null>(null)
  const router = useRouter()
  const correctionColumns = React.useMemo<ColumnDef<InvoiceCorrection>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('billing.invoices.columns.number', 'Number'),
        cell: ({ row }) => (
          <Link href={`/backend/billing/invoices/${row.original.id}`} className="text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'document_type',
        header: t('billing.invoices.columns.type', 'Type'),
        cell: ({ row }) =>
          row.original.document_type === 'credit_memo'
            ? t('billing.invoices.document_type.credit_memo', 'Credit memo')
            : t('billing.invoices.document_type.debit_memo', 'Debit memo'),
      },
      { accessorKey: 'status', header: t('billing.invoices.columns.status', 'Status') },
      {
        accessorKey: 'total_gross',
        header: t('billing.invoices.columns.total', 'Total'),
        cell: ({ row }) =>
          formatMoney(
            String((row.original.document_type === 'credit_memo' ? -1 : 1) * Number.parseFloat(row.original.total_gross)),
            row.original.currency_code,
          ),
      },
    ],
    [t],
  )
  const handleDeleteDraftMemo = React.useCallback(async () => {
    if (!invoice) return
    const ok = await confirm({
      title: t('billing.memo.delete.confirm', 'Delete this draft memo?'),
      text: t('billing.memo.delete.text', 'The draft and its lines are removed. Posted documents are never deleted.'),
      confirmText: t('billing.memo.delete.action', 'Delete draft'),
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await apiCallOrThrow('/api/billing/invoices/delete-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      })
      flash(t('billing.memo.deleted', 'Draft memo deleted'), 'success')
      router.push(invoice.corrects_invoice_id ? `/backend/billing/invoices/${invoice.corrects_invoice_id}` : '/backend/billing/invoices')
    } catch (err) {
      flash(normalizeCrudServerError(err).message || t('billing.memo.delete.failed', 'Could not delete the draft'), 'error')
    }
  }, [confirm, invoice, router, t])
  const allocationColumns = React.useMemo<ColumnDef<InvoiceAllocation>[]>(
    () => [
      {
        accessorKey: 'source_label',
        header: t('billing.invoices.payments.source', 'Source'),
        cell: ({ row }) => (
          <Link
            href={
              row.original.source_type === 'payment'
                ? `/backend/billing/payments/${row.original.source_id}`
                : `/backend/billing/invoices/${row.original.source_id}`
            }
            className="text-primary hover:underline"
          >
            {row.original.source_type === 'payment'
              ? `${t('billing.invoices.payments.payment', 'Payment')}${row.original.source_label ? ` · ${row.original.source_label}` : ''}`
              : `${t('billing.invoices.payments.credit_memo', 'Credit memo')} ${row.original.source_label ?? ''}`}
          </Link>
        ),
        meta: { truncate: true, maxWidth: '320px' },
      },
      {
        accessorKey: 'amount',
        header: t('billing.payments.columns.amount', 'Amount'),
        cell: ({ row }) => formatMoney(row.original.amount, row.original.currency_code),
      },
      {
        accessorKey: 'created_at',
        header: t('billing.payments.allocations.at', 'When'),
        cell: ({ row }) => formatBillingDateTime(row.original.created_at, locale),
      },
    ],
    [t, locale],
  )
  const searchParams = useSearchParams()
  const backHref = resolveInvoiceReturnTarget({
    from: searchParams?.get('from'),
    accountId: searchParams?.get('accountId'),
  })
  const [sending, setSending] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!invoiceId) return
    setError(null)
    setLoading(true)
    try {
      const data = await readApiResultOrThrow<DetailResponse>(
        `/api/billing/invoices/${invoiceId}`,
      )
      setInvoice(data.invoice)
      setLines(data.lines ?? [])
      setAllocations(data.allocations ?? [])
      setCorrections(data.corrections ?? [])
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      setError(message || t('billing.invoices.detail.error.load', 'Failed to load invoice'))
    } finally {
      setLoading(false)
    }
  }, [invoiceId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  // Resolve the FK names once the invoice is loaded (one bounded
  // request each — Bill Run name is derived from its as-of date).
  const billRunId = invoice?.bill_run_id
  const billAccountId = invoice?.bill_account_id
  React.useEffect(() => {
    if (billAccountId) {
      readApiResultOrThrow<{ items: Array<{ name: string }> }>(
        `/api/billing/accounts?id=${billAccountId}&pageSize=1`,
      )
        .then((r) => setAccountName(r.items?.[0]?.name ?? null))
        .catch(() => setAccountName(null))
    }
    if (billRunId) {
      readApiResultOrThrow<{ items: Array<{ as_of_date: string }> }>(
        `/api/billing/runs?id=${billRunId}&pageSize=1`,
      )
        .then((r) => {
          const asOf = r.items?.[0]?.as_of_date
          setRunName(asOf ? billRunName(asOf) : null)
        })
        .catch(() => setRunName(null))
    }
  }, [billAccountId, billRunId])

  const handlePost = React.useCallback(async () => {
    if (!invoice) return
    setPosting(true)
    try {
      const call = await apiCallOrThrow<{ status: string; invoiceNumber: string }>(
        '/api/billing/invoices/post',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: invoice.id }),
        },
      )
      flash(
        t('billing.invoices.post.success', 'Invoice posted') +
          ` (${call.result?.invoiceNumber ?? invoice.number})`,
        'success',
      )
      void load()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      const code = (err as { body?: { code?: string } } | null)?.body?.code
      if (code === 'billing.settings.incomplete') setSettingsIncomplete(true)
      flash(
        code === 'billing.settings.incomplete'
          ? t(
              'billing.invoices.post.settings_incomplete',
              'Fill in the seller details in Settings → Billing before posting invoices.',
            )
          : message || t('billing.invoices.post.error', 'Post failed'),
        'error',
      )
    } finally {
      setPosting(false)
    }
  }, [invoice, load, t])

  const handleSend = React.useCallback(async () => {
    if (!invoice) return
    const recipient = invoice.buyer_snapshot?.invoice_email ?? ''
    const alreadySent = (invoice.metadata?.deliveries ?? []).some((d) => d.status === 'sent')
    const ok = await confirm({
      title: alreadySent
        ? t('billing.invoices.send.confirm.title_resend', 'Resend invoice?')
        : t('billing.invoices.send.confirm.title', 'Send invoice?'),
      text: t('billing.invoices.send.confirm.text', 'The PDF is emailed to {email}.').replace('{email}', recipient),
      confirmText: t('billing.invoices.send.action', 'Send'),
    })
    if (!ok) return
    setSending(true)
    try {
      const call = await apiCallOrThrow<{ status: 'sent' | 'failed'; error?: string | null }>(
        `/api/billing/invoices/${encodeURIComponent(invoice.id)}/send`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      if (call.result?.status === 'sent') {
        flash(t('billing.invoices.send.success', 'Invoice sent'), 'success')
      } else {
        flash(
          `${t('billing.invoices.send.failed', 'Sending failed')}${call.result?.error ? `: ${call.result.error}` : ''}`,
          'error',
        )
      }
      void load()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.invoices.send.failed', 'Sending failed'), 'error')
    } finally {
      setSending(false)
    }
  }, [confirm, invoice, load, t])

  // ─── Line add / edit / remove ────────────────────────────────

  const handleSubmitLine = React.useCallback(
    async (values: LineFormValues) => {
      if (!invoice) return
      setDialogSubmitting(true)
      try {
        if (dialogMode === 'add') {
          await apiCallOrThrow('/api/billing/invoices/add-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invoiceId: invoice.id,
              description: values.description,
              quantity: values.quantity,
              unitPriceNet: values.unitPriceNet,
              ...(values.taxRate !== undefined ? { taxRate: values.taxRate } : {}),
            }),
          })
          flash(t('billing.invoices.lines.add.success', 'Line added'), 'success')
        } else if (dialogMode === 'edit' && dialogTargetLine) {
          await apiCallOrThrow('/api/billing/invoices/edit-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invoiceId: invoice.id,
              invoiceLineId: dialogTargetLine.id,
              changes: {
                description: values.description,
                quantity: values.quantity,
                unitPriceNet: values.unitPriceNet,
                ...(values.totalNetAmount !== undefined
                  ? { totalNetAmount: values.totalNetAmount }
                  : {}),
                ...(values.taxRate !== undefined ? { taxRate: values.taxRate } : {}),
              },
            }),
          })
          flash(t('billing.invoices.lines.edit.success', 'Line updated'), 'success')
        }
        setDialogMode(null)
        setDialogTargetLine(null)
        void load()
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.invoices.lines.save.error', 'Save failed'), 'error')
      } finally {
        setDialogSubmitting(false)
      }
    },
    [dialogMode, dialogTargetLine, invoice, load, t],
  )

  const handleRemoveLine = React.useCallback(
    async (line: InvoiceLine) => {
      if (!invoice) return
      const ok = await confirm({
        title: t('billing.invoices.lines.remove.confirm.title', 'Remove line?'),
        text: t(
          'billing.invoices.lines.remove.confirm.text',
          'The line will be deleted and recorded in the draft-edit audit log.',
        ),
        confirmText: t('billing.invoices.lines.remove.confirm.button', 'Remove line'),
        variant: 'destructive',
      })
      if (!ok) return
      try {
        await apiCallOrThrow('/api/billing/invoices/remove-line', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            invoiceLineId: line.id,
          }),
        })
        flash(t('billing.invoices.lines.remove.success', 'Line removed'), 'success')
        void load()
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.invoices.lines.remove.error', 'Remove failed'), 'error')
      }
    },
    [confirm, invoice, load, t],
  )

  const canEditLines = invoice?.status === 'draft'

  // Newest first; deliveries are a short, append-only log on the invoice.
  const deliveries = React.useMemo(
    () => [...(invoice?.metadata?.deliveries ?? [])].reverse(),
    [invoice?.metadata?.deliveries],
  )
  const deliveryColumns = React.useMemo<ColumnDef<InvoiceDelivery>[]>(
    () => [
      {
        accessorKey: 'at',
        header: t('billing.invoices.deliveries.columns.at', 'When'),
        cell: ({ row }) => formatBillingDateTime(row.original.at, locale),
      },
      { accessorKey: 'to', header: t('billing.invoices.deliveries.columns.to', 'Recipient') },
      {
        accessorKey: 'status',
        header: t('billing.invoices.deliveries.columns.status', 'Status'),
        cell: ({ row }) =>
          row.original.status === 'sent' ? (
            <Tag variant="success">{t('billing.invoices.deliveries.status.sent', 'Sent')}</Tag>
          ) : (
            <Tag variant="error">{t('billing.invoices.deliveries.status.failed', 'Failed')}</Tag>
          ),
      },
      {
        accessorKey: 'trigger',
        header: t('billing.invoices.deliveries.columns.trigger', 'Trigger'),
        cell: ({ row }) =>
          row.original.trigger === 'auto'
            ? t('billing.invoices.deliveries.trigger.auto', 'Automatic')
            : t('billing.invoices.deliveries.trigger.manual', 'Manual'),
      },
      {
        accessorKey: 'error',
        header: t('billing.invoices.deliveries.columns.error', 'Error'),
        cell: ({ row }) => row.original.error ?? '—',
        meta: { truncate: true, maxWidth: '280px' },
      },
    ],
    [t, locale],
  )

  const lineColumns = React.useMemo<ColumnDef<InvoiceLine>[]>(
    () => [
      {
        accessorKey: 'line_number',
        header: '#',
      },
      {
        accessorKey: 'description',
        header: t('billing.invoices.lines.columns.description', 'Description'),
        cell: ({ row }) => {
          const type = row.original.billing_type
          const operatorAdded = row.original.metadata?.operator_added === true
          return (
            <div className="flex flex-col gap-1">
              <span>{row.original.description ? localizeDescriptionPeriod(row.original.description, (day) => formatBillingDay(day, locale)) : '—'}</span>
              <InvoiceLineExtras
                description={row.original.description}
                servicePeriodStart={row.original.service_period_start}
                servicePeriodEnd={row.original.service_period_end}
                metadata={row.original.metadata}
              />
              <div className="flex items-center gap-1 flex-wrap">
                {type ? <Tag variant={lineKindVariant(type)}>{type}</Tag> : null}
                {operatorAdded ? (
                  <Tag variant="info">
                    {t('billing.invoices.lines.operator_added', 'Operator-added')}
                  </Tag>
                ) : null}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'quantity',
        header: t('billing.invoices.lines.columns.quantity', 'Qty'),
      },
      {
        accessorKey: 'unit_price_net',
        header: t('billing.invoices.lines.columns.unit_price', 'Unit price'),
        cell: ({ row }) =>
          formatMoney(row.original.unit_price_net, row.original.currency_code),
      },
      {
        accessorKey: 'net_amount',
        header: t('billing.invoices.lines.columns.total', 'Total net'),
        cell: ({ row }) =>
          formatMoney(row.original.net_amount, row.original.currency_code),
      },
      {
        accessorKey: 'tax_rate',
        header: t('billing.invoices.lines.columns.tax_rate', 'VAT %'),
        cell: ({ row }) => (row.original.tax_rate != null ? `${Number(row.original.tax_rate)} %` : '—'),
      },
      {
        accessorKey: 'tax_amount',
        header: t('billing.invoices.lines.columns.tax_amount', 'VAT'),
        cell: ({ row }) => formatMoney(row.original.tax_amount, row.original.currency_code),
      },
      {
        accessorKey: 'gross_amount',
        header: t('billing.invoices.lines.columns.gross', 'Gross'),
        cell: ({ row }) => formatMoney(row.original.gross_amount, row.original.currency_code),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          if (!canEditLines) return null
          return (
            <div className="flex items-center justify-end gap-1">
              <IconButton
                type="button"
                variant="ghost"
                aria-label={t('billing.invoices.lines.actions.edit', 'Edit line')}
                onClick={() => {
                  setDialogTargetLine(row.original)
                  setDialogMode('edit')
                }}
              >
                <Pencil size={16} />
              </IconButton>
              <IconButton
                type="button"
                variant="ghost"
                aria-label={t('billing.invoices.lines.actions.remove', 'Remove line')}
                onClick={() => void handleRemoveLine(row.original)}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          )
        },
      },
    ],
    [canEditLines, handleRemoveLine, t, locale],
  )

  const dialogInitial = React.useMemo<Partial<LineFormValues> | undefined>(() => {
    if (dialogMode !== 'edit' || !dialogTargetLine) return undefined
    return {
      description: dialogTargetLine.description ?? '',
      quantity: Number.parseFloat(dialogTargetLine.quantity),
      unitPriceNet: Number.parseFloat(dialogTargetLine.unit_price_net),
      taxRate: dialogTargetLine.tax_rate != null ? Number.parseFloat(String(dialogTargetLine.tax_rate)) : undefined,
    }
  }, [dialogMode, dialogTargetLine])

  if (error) {
    return (
      <Page>
        <PageHeader title={t('billing.invoices.detail.title', 'Billing Invoice')} />
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (loading || !invoice) {
    return (
      <Page>
        <PageHeader title={t('billing.invoices.detail.title', 'Billing Invoice')} />
        <PageBody>
          <LoadingMessage label={t('billing.invoices.detail.loading', 'Loading invoice…')} />
        </PageBody>
      </Page>
    )
  }

  const isTest = invoice.test_run === true
  const isDraft = invoice.status === 'draft'

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref={backHref}
        entityTypeLabel={t('billing.invoices.detail.title', 'Billing Invoice')}
        title={invoice.number}
        statusBadge={
          <div className="flex items-center gap-2 flex-wrap">
            <Tag variant={statusVariant(invoice.status)}>{invoice.status}</Tag>
            {invoice.document_type === 'credit_memo' ? (
              <Tag variant="info">{t('billing.invoices.document_type.credit_memo', 'Credit memo')}</Tag>
            ) : invoice.document_type === 'debit_memo' ? (
              <Tag variant="info">{t('billing.invoices.document_type.debit_memo', 'Debit memo')}</Tag>
            ) : null}
            {isTest ? (
              invoice.bill_run_id ? (
                <Link href={`/backend/billing/runs/${invoice.bill_run_id}`}>
                  <Tag variant="warning">{t('billing.invoices.test_run_tag', 'Test run')}</Tag>
                </Link>
              ) : (
                <Tag variant="warning">{t('billing.invoices.test_run_tag', 'Test run')}</Tag>
              )
            ) : null}
            {(invoice.days_overdue ?? 0) > 0 ? (
              <Tag variant="error">
                {t('billing.invoices.overdue_days', 'Overdue {days} d').replace('{days}', String(invoice.days_overdue))}
              </Tag>
            ) : null}
          </div>
        }
        actionsContent={
          <>
            {isDraft && !isTest ? (
              <Button onClick={handlePost} disabled={posting}>
                {posting
                  ? t('billing.invoices.post.in_progress', 'Posting…')
                  : t('billing.invoices.post.action', 'Post invoice')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" asChild>
              <a href={invoicePdfHref(invoice.id)} target="_blank" rel="noopener noreferrer">
                <FileDown size={16} />
                {isDraft
                  ? t('billing.invoices.actions.pdf_preview', 'Preview PDF')
                  : t('billing.invoices.actions.pdf', 'Download PDF')}
              </a>
            </Button>
            {!isDraft && !isTest && invoice.document_type !== 'receipt' ? (
              <Button type="button" variant="outline" onClick={() => void handleSend()} disabled={sending}>
                <Mail size={16} />
                {sending
                  ? t('billing.invoices.send.in_progress', 'Sending…')
                  : (invoice.metadata?.deliveries ?? []).some((d) => d.status === 'sent')
                    ? t('billing.invoices.send.resend', 'Resend')
                    : t('billing.invoices.send.action', 'Send')}
              </Button>
            ) : null}
            {invoice.document_type === 'invoice' && !isTest && ['posted', 'partially_paid', 'paid'].includes(invoice.status) ? (
              <Button type="button" variant="outline" onClick={() => setMemoDialog('credit_memo')}>
                {t('billing.memo.create_credit.action', 'Create credit memo')}
              </Button>
            ) : null}
            {invoice.document_type === 'invoice' && !isTest && ['posted', 'partially_paid', 'paid', 'credited'].includes(invoice.status) ? (
              <Button type="button" variant="outline" onClick={() => setMemoDialog('debit_memo')}>
                {t('billing.memo.create_debit.action', 'Create debit memo')}
              </Button>
            ) : null}
            {isDraft && (invoice.document_type === 'credit_memo' || invoice.document_type === 'debit_memo') ? (
              <Button type="button" variant="outline" onClick={() => void handleDeleteDraftMemo()}>
                {t('billing.memo.delete.action', 'Delete draft')}
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="space-y-6">
          {settingsIncomplete ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm text-status-warning-text">
              <span>
                {t(
                  'billing.invoices.post.settings_incomplete',
                  'Fill in the seller details in Settings → Billing before posting invoices.',
                )}
              </span>
              <BillingSettingsLink />
            </div>
          ) : null}
          <DetailCard>
            <DetailField label={t('billing.invoices.detail.field.period', 'Bill period')}>
              {invoice.period_start?.slice(0, 10) ?? '—'} →{' '}
              {invoice.period_end?.slice(0, 10) ?? '—'}
            </DetailField>
            <DetailField label={t('billing.invoices.detail.field.bill_run', 'Bill Run')}>
              {invoice.bill_run_id ? (
                <Link
                  href={`/backend/billing/runs/${invoice.bill_run_id}`}
                  className="text-primary hover:underline"
                >
                  {runName ?? invoice.bill_run_id}
                </Link>
              ) : (
                '—'
              )}
            </DetailField>
            <DetailField
              label={t('billing.invoices.detail.field.account', 'Billing Account')}
            >
              {invoice.bill_account_id ? (
                <Link
                  href={`/backend/billing/accounts/${invoice.bill_account_id}`}
                  className="text-primary hover:underline"
                >
                  {accountName ?? invoice.bill_account_name ?? invoice.bill_account_id}
                </Link>
              ) : (
                '—'
              )}
            </DetailField>
            <DetailField label={t('billing.invoices.detail.field.issued', 'Issued')}>
              {invoice.issue_date?.slice(0, 10) ?? '—'}
            </DetailField>
            <DetailField label={t('billing.invoices.detail.field.due', 'Due')}>
              {invoice.due_date?.slice(0, 10) ?? '—'}
            </DetailField>
            {invoice.corrects_invoice_id ? (
              <DetailField label={t('billing.memo.corrects', 'Corrects')}>
                <Link href={`/backend/billing/invoices/${invoice.corrects_invoice_id}`} className="text-primary hover:underline">
                  {invoice.corrects_invoice_number ?? invoice.corrects_invoice_id}
                </Link>
              </DetailField>
            ) : null}
            {invoice.correction_reason ? (
              <DetailField label={t('billing.memo.reason_label', 'Reason')}>{invoice.correction_reason}</DetailField>
            ) : null}
            {invoice.metadata?.draft_number ? (
              <DetailField label={t('billing.invoices.detail.field.draft_number', 'Draft number')}>
                <span className="font-mono text-xs">{invoice.metadata.draft_number}</span>
              </DetailField>
            ) : null}
            <DetailField label={t('billing.common.id', 'ID')}>
              <span className="font-mono text-xs">{invoice.id}</span>
            </DetailField>
          </DetailCard>

          <StatCard>
            <Stat
              label={t('billing.invoices.detail.subtotal', 'Subtotal net')}
              value={formatMoney(invoice.subtotal_net, invoice.currency_code)}
            />
            <Stat
              label={t('billing.invoices.detail.total', 'Grand total')}
              value={formatMoney(invoice.total_gross, invoice.currency_code)}
            />
            <Stat
              label={t('billing.invoices.detail.paid', 'Paid')}
              value={formatMoney(invoice.paid_total, invoice.currency_code)}
            />
            <Stat
              label={t('billing.invoices.detail.outstanding', 'Outstanding')}
              value={formatMoney(invoice.outstanding, invoice.currency_code)}
            />
          </StatCard>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold">
                {t('billing.invoices.lines.title', 'Lines')}
              </h2>
              {canEditLines ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogTargetLine(null)
                    setDialogMode('add')
                  }}
                >
                  <Plus size={16} />
                  {t('billing.invoices.lines.add.action', 'Add line')}
                </Button>
              ) : null}
            </div>
            <DataTable
              columns={lineColumns}
              data={visibleLines}
              isLoading={false}
              pagination={{
                page: linesPage,
                pageSize: linesPageSize,
                total: lines.length,
                totalPages: linesTotalPages,
                onPageChange: setLinesPage,
              }}
            />
          </div>

          {corrections.length > 0 ? (
            <div>
              <h2 className="text-base font-semibold mb-2">{t('billing.memo.corrections', 'Corrections')}</h2>
              <DataTable
                columns={correctionColumns}
                data={corrections}
                isLoading={false}
                pagination={{
                  page: 1,
                  pageSize: Math.max(corrections.length, 1),
                  total: corrections.length,
                  totalPages: 1,
                  onPageChange: () => undefined,
                }}
              />
            </div>
          ) : null}

          {!isDraft ? (
            <div>
              <h2 className="text-base font-semibold mb-2">{t('billing.invoices.payments.title', 'Payments')}</h2>
              <DataTable
                columns={allocationColumns}
                data={allocations}
                isLoading={false}
                emptyState={t('billing.invoices.payments.empty', 'No payments yet.')}
                pagination={{
                  page: 1,
                  pageSize: Math.max(allocations.length, 1),
                  total: allocations.length,
                  totalPages: 1,
                  onPageChange: () => undefined,
                }}
              />
            </div>
          ) : null}

          {!isDraft ? (
            <div>
              <h2 className="text-base font-semibold mb-2">
                {t('billing.invoices.deliveries.title', 'Email deliveries')}
              </h2>
              <DataTable
                columns={deliveryColumns}
                data={deliveries}
                isLoading={false}
                emptyState={t('billing.invoices.deliveries.empty', 'Not sent yet.')}
                pagination={{
                  page: 1,
                  pageSize: Math.max(deliveries.length, 1),
                  total: deliveries.length,
                  totalPages: 1,
                  onPageChange: () => undefined,
                }}
              />
            </div>
          ) : null}
        </div>

        <LineFormDialog
          open={dialogMode !== null}
          mode={dialogMode ?? 'add'}
          initial={dialogInitial}
          submitting={dialogSubmitting}
          onCancel={() => {
            setDialogMode(null)
            setDialogTargetLine(null)
          }}
          onSubmit={handleSubmitLine}
        />
        {memoDialog ? (
          <CreateMemoDialog
            open
            type={memoDialog}
            invoiceId={invoice.id}
            invoiceNumber={invoice.number}
            currencyCode={invoice.currency_code}
            lines={lines.map((line) => ({
              id: line.id,
              description: line.description,
              quantity: line.quantity,
              unit_price_net: line.unit_price_net,
              tax_rate: line.tax_rate,
            }))}
            onClose={() => setMemoDialog(null)}
            onCreated={(memoId) => router.push(`/backend/billing/invoices/${memoId}`)}
          />
        ) : null}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
