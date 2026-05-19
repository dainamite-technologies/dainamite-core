"use client"
import * as React from 'react'
import { useParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
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

type BillingInvoice = {
  id: string
  invoice_number: string
  status: 'draft' | 'posted' | 'paid' | 'void' | null
  currency_code: string
  issue_date: string | null
  due_date: string | null
  subtotal_net_amount: string
  grand_total_net_amount: string
  grand_total_gross_amount: string
  paid_total_amount: string
  outstanding_amount: string
  metadata: {
    bill_run_id?: string
    bill_account_id?: string
    bill_period_start?: string
    bill_period_end?: string
    test_run?: boolean
  } | null
  created_at: string
  updated_at: string
}

type InvoiceLine = {
  id: string
  line_number: number
  kind: string
  description: string | null
  quantity: string
  currency_code: string
  unit_price_net: string
  total_net_amount: string
  total_gross_amount: string
  metadata: {
    billing_item_id?: string
    billing_type?: 'one_time' | 'recurring' | 'usage'
    operator_added?: boolean
    usage_tier_breakdown?: unknown
  } | null
}

type DetailResponse = {
  invoice: BillingInvoice
  lines: InvoiceLine[]
}

function statusVariant(
  status: BillingInvoice['status'],
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'paid':
      return 'success'
    case 'posted':
      return 'warning'
    case 'void':
      return 'error'
    case 'draft':
    default:
      return 'default'
  }
}

function lineKindVariant(
  type: InvoiceLine['metadata'] extends infer M
    ? M extends { billing_type?: infer T }
      ? T
      : never
    : never,
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

export default function BillingInvoiceDetailPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const invoiceId = typeof params.id === 'string' ? params.id : ''

  const [invoice, setInvoice] = React.useState<BillingInvoice | null>(null)
  const [lines, setLines] = React.useState<InvoiceLine[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [posting, setPosting] = React.useState(false)
  const [wiping, setWiping] = React.useState(false)

  // Inline line-edit dialog state. `dialogMode === null` → closed.
  const [dialogMode, setDialogMode] = React.useState<'add' | 'edit' | null>(null)
  const [dialogTargetLine, setDialogTargetLine] = React.useState<InvoiceLine | null>(null)
  const [dialogSubmitting, setDialogSubmitting] = React.useState(false)

  // Confirm flows: wipe-test + remove-line both use ConfirmDialog
  // (per UI AGENTS.md: NEVER `window.confirm`).
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

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
          ` (${call.result?.invoiceNumber ?? invoice.invoice_number})`,
        'success',
      )
      void load()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.invoices.post.error', 'Post failed'), 'error')
    } finally {
      setPosting(false)
    }
  }, [invoice, load, t])

  const handleWipeTest = React.useCallback(async () => {
    if (!invoice) return
    const ok = await confirm({
      title: t('billing.invoices.wipe.confirm.title', 'Wipe test invoices?'),
      text: t(
        'billing.invoices.wipe.confirm.text',
        'Every test invoice from this Bill Run will be permanently deleted. This cannot be undone.',
      ),
      confirmText: t('billing.invoices.wipe.confirm.button', 'Delete test invoices'),
      variant: 'destructive',
    })
    if (!ok) return
    setWiping(true)
    try {
      const billRunId = invoice.metadata?.bill_run_id
      const call = await apiCallOrThrow<{ invoicesRemoved: number }>(
        '/api/billing/test-invoices/wipe',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(billRunId ? { billRunId } : {}),
        },
      )
      flash(
        t('billing.invoices.wipe.success', 'Test invoices removed') +
          ` (${call.result?.invoicesRemoved ?? 0})`,
        'success',
      )
      // The invoice we were looking at is hard-deleted — navigate away
      // on success by reloading; the detail load will 404 and the
      // user clicks back.
      void load()
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.invoices.wipe.error', 'Wipe failed'), 'error')
    } finally {
      setWiping(false)
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
          const type = row.original.metadata?.billing_type
          const operatorAdded = row.original.metadata?.operator_added === true
          return (
            <div className="flex flex-col gap-1">
              <span>{row.original.description ?? '—'}</span>
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
        accessorKey: 'total_net_amount',
        header: t('billing.invoices.lines.columns.total', 'Total net'),
        cell: ({ row }) =>
          formatMoney(row.original.total_net_amount, row.original.currency_code),
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
    [canEditLines, handleRemoveLine, t],
  )

  const dialogInitial = React.useMemo<Partial<LineFormValues> | undefined>(() => {
    if (dialogMode !== 'edit' || !dialogTargetLine) return undefined
    return {
      description: dialogTargetLine.description ?? '',
      quantity: Number.parseFloat(dialogTargetLine.quantity),
      unitPriceNet: Number.parseFloat(dialogTargetLine.unit_price_net),
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

  const isTest = invoice.metadata?.test_run === true
  const isDraft = invoice.status === 'draft'

  return (
    <Page title={t('billing.invoices.detail.title', 'Billing Invoice')}>
      <PageBody>
        <div className="rounded-lg border border-border bg-card p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tag variant={statusVariant(invoice.status)}>{invoice.status ?? '—'}</Tag>
                {isTest ? <Tag variant="warning">TEST</Tag> : null}
              </div>
              <div className="text-base font-semibold font-mono mb-1">
                {invoice.invoice_number}
              </div>
              <div className="text-xs text-muted-foreground font-mono mb-3">{invoice.id}</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  {t('billing.invoices.detail.field.period', 'Bill period')}
                </dt>
                <dd>
                  {invoice.metadata?.bill_period_start ?? '—'} →{' '}
                  {invoice.metadata?.bill_period_end ?? '—'}
                </dd>
                <dt className="text-muted-foreground">
                  {t('billing.invoices.detail.field.bill_run', 'Bill Run')}
                </dt>
                <dd className="font-mono text-xs">{invoice.metadata?.bill_run_id ?? '—'}</dd>
                <dt className="text-muted-foreground">
                  {t('billing.invoices.detail.field.account', 'Billing Account')}
                </dt>
                <dd className="font-mono text-xs">
                  {invoice.metadata?.bill_account_id ?? '—'}
                </dd>
                <dt className="text-muted-foreground">
                  {t('billing.invoices.detail.field.issued', 'Issued')}
                </dt>
                <dd>{invoice.issue_date?.slice(0, 10) ?? '—'}</dd>
              </dl>
            </div>
            <div className="flex flex-col gap-2 items-end">
              {isDraft && !isTest ? (
                <Button onClick={handlePost} disabled={posting}>
                  {posting
                    ? t('billing.invoices.post.in_progress', 'Posting…')
                    : t('billing.invoices.post.action', 'Post invoice')}
                </Button>
              ) : null}
              {isTest ? (
                <Button
                  variant="outline"
                  onClick={handleWipeTest}
                  disabled={wiping}
                >
                  {wiping
                    ? t('billing.invoices.wipe.in_progress', 'Wiping…')
                    : t('billing.invoices.wipe.action', 'Wipe test invoices for this run')}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">
                {t('billing.invoices.detail.subtotal', 'Subtotal net')}
              </div>
              <div className="text-lg font-semibold">
                {formatMoney(invoice.subtotal_net_amount, invoice.currency_code)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">
                {t('billing.invoices.detail.total', 'Grand total')}
              </div>
              <div className="text-lg font-semibold">
                {formatMoney(invoice.grand_total_gross_amount, invoice.currency_code)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">
                {t('billing.invoices.detail.paid', 'Paid')}
              </div>
              <div className="text-lg font-semibold">
                {formatMoney(invoice.paid_total_amount, invoice.currency_code)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">
                {t('billing.invoices.detail.outstanding', 'Outstanding')}
              </div>
              <div className="text-lg font-semibold">
                {formatMoney(invoice.outstanding_amount, invoice.currency_code)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2 mt-4">
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
        <DataTable columns={lineColumns} data={lines} isLoading={false} />

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
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
