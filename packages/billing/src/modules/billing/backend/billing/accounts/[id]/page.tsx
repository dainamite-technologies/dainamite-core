"use client"
import * as React from 'react'
import Link from 'next/link'
import { Pencil, Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AccountForm, type AccountFormValues } from '../../../../components/AccountForm'
import { DetailCard, DetailField } from '../../../../components/DetailFields'

/**
 * `/backend/billing/accounts/[id]` — Billing Account detail.
 *
 * Opens read-only (field grid + the account's items). The `Edit`
 * button swaps the grid for the `AccountForm`; Save / Cancel return
 * to the read-only view. Loads via `GET /api/billing/accounts?id=<id>`,
 * edits through `PUT`, soft-delete through `DELETE`.
 *
 * `customerId` + `currencyCode` are immutable on update — the form
 * disables both in `mode='edit'` and the schema rejects them per
 * `billingAccountUpdateSchema`.
 */

// API list rows are snake_case (see `api/accounts/route.ts` `fields`).
type AccountRow = {
  id: string
  customer_id: string
  name: string
  currency_code: string
  bill_cycle: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  bill_cycle_anchor: string
  invoice_email: string
  invoice_language: string
  tax_id: string | null
  invoice_address: {
    line1?: string
    line2?: string
    city?: string
    postal_code?: string
    country?: string
  } | null
  next_bill_date: string
  last_bill_date: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type ListResponse = { items: AccountRow[] }

// Minimal item shape for the embedded "Items" table.
type AccountItemRow = {
  id: string
  description: string
  type: 'one_time' | 'recurring' | 'usage'
  bill_start_date: string
  is_active: boolean
}

// Minimal usage shape for the embedded "Usage" table. Mirrors the
// snake_case `fields` projection in `api/usage/route.ts`. Usage is
// append-only — `rated_in_bill_run_id` is null until a Bill Run rates it.
type AccountUsageRow = {
  id: string
  uom_code: string
  quantity: string
  period_start: string
  period_end: string
  line_description: string | null
  rated_in_bill_run_id: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function toFormValues(row: AccountRow): AccountFormValues {
  return {
    customerId: row.customer_id,
    name: row.name,
    currencyCode: row.currency_code,
    billCycle: row.bill_cycle,
    billCycleAnchor: row.bill_cycle_anchor,
    invoiceEmail: row.invoice_email,
    invoiceLanguage: row.invoice_language,
    taxId: row.tax_id ?? '',
    invoiceAddress: {
      line1: row.invoice_address?.line1 ?? '',
      line2: row.invoice_address?.line2 ?? '',
      city: row.invoice_address?.city ?? '',
      postal_code: row.invoice_address?.postal_code ?? '',
      country: row.invoice_address?.country ?? '',
    },
    nextBillDate: row.next_bill_date?.slice(0, 10) ?? '',
    isActive: row.is_active,
  }
}

// ─── Read-only view ──────────────────────────────────────────────

function AccountView({ row }: { row: AccountRow }) {
  const t = useT()
  const addr = row.invoice_address
  const addressText = addr
    ? [
        addr.line1,
        addr.line2,
        [addr.postal_code, addr.city].filter(Boolean).join(' '),
        addr.country,
      ]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(', ')
    : ''
  return (
    <DetailCard>
      <DetailField label={t('billing.accounts.form.customer_id', 'Customer ID')}>
        <span className="font-mono text-xs">{row.customer_id}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.columns.currency', 'Currency')}>
        {row.currency_code}
      </DetailField>
      <DetailField label={t('billing.common.id', 'ID')}>
        <span className="font-mono text-xs">{row.id}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.columns.cycle', 'Cycle')}>
        {row.bill_cycle}
        <span className="text-muted-foreground"> · {row.bill_cycle_anchor}</span>
      </DetailField>
      <DetailField label={t('billing.accounts.columns.next_bill', 'Next bill')}>
        {formatDate(row.next_bill_date)}
      </DetailField>
      <DetailField label={t('billing.accounts.columns.last_bill', 'Last bill')}>
        {formatDate(row.last_bill_date)}
      </DetailField>
      <DetailField label={t('billing.accounts.form.invoice_email', 'Invoice email')}>
        {row.invoice_email}
      </DetailField>
      <DetailField label={t('billing.accounts.form.invoice_language', 'Invoice language')}>
        {row.invoice_language}
      </DetailField>
      <DetailField label={t('billing.accounts.form.tax_id', 'Tax ID')}>
        {row.tax_id || '—'}
      </DetailField>
      <DetailField
        label={t('billing.accounts.form.address.title', 'Invoice address')}
        fullWidth
      >
        {addressText || '—'}
      </DetailField>
    </DetailCard>
  )
}

// ─── Embedded items table ────────────────────────────────────────

function AccountItemsSection({ accountId }: { accountId: string }) {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<AccountItemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const pageSize = 25

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<{
        items: AccountItemRow[]
        total: number
        totalPages: number
      }>(
        `/api/billing/items?billAccountId=${accountId}&page=${page}` +
          `&pageSize=${pageSize}&sortField=createdAt&sortDir=desc`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [accountId, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const columns = React.useMemo<ColumnDef<AccountItemRow>[]>(
    () => [
      {
        accessorKey: 'description',
        header: t('billing.items.columns.description', 'Description'),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-primary">
            {row.original.description}
          </span>
        ),
      },
      {
        accessorKey: 'type',
        header: t('billing.items.columns.type', 'Type'),
        cell: ({ row }) => <Tag variant="info">{row.original.type}</Tag>,
      },
      {
        accessorKey: 'bill_start_date',
        header: t('billing.items.columns.start', 'Start'),
        cell: ({ row }) => formatDate(row.original.bill_start_date),
      },
      {
        accessorKey: 'is_active',
        header: t('billing.items.columns.status', 'Status'),
        cell: ({ row }) =>
          row.original.is_active ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          ),
      },
    ],
    [t],
  )

  return (
    <div className="mt-6">
      <DataTable
        title={t('billing.accounts.detail.items.title', 'Items')}
        columns={columns}
        data={rows}
        isLoading={loading}
        onRowClick={(row) => router.push(`/backend/billing/items/${row.id}`)}
        pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        emptyState={
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('billing.accounts.detail.items.empty', 'No items for this account yet.')}
          </div>
        }
      />
    </div>
  )
}

// ─── Embedded usage table ────────────────────────────────────────

function AccountUsageSection({ accountId }: { accountId: string }) {
  const t = useT()
  const [rows, setRows] = React.useState<AccountUsageRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const pageSize = 25

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<{
        items: AccountUsageRow[]
        total: number
        totalPages: number
      }>(
        `/api/billing/usage?billAccountId=${accountId}&page=${page}` +
          `&pageSize=${pageSize}&sortField=periodStart&sortDir=desc`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [accountId, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const columns = React.useMemo<ColumnDef<AccountUsageRow>[]>(
    () => [
      {
        accessorKey: 'uom_code',
        header: t('billing.usage.columns.uom', 'Unit'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.uom_code}</span>
        ),
      },
      {
        accessorKey: 'quantity',
        header: t('billing.usage.columns.quantity', 'Quantity'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.quantity}</span>
        ),
      },
      {
        accessorKey: 'period_start',
        header: t('billing.usage.columns.period', 'Period'),
        cell: ({ row }) =>
          `${formatDate(row.original.period_start)} – ${formatDate(row.original.period_end)}`,
      },
      {
        accessorKey: 'line_description',
        header: t('billing.usage.columns.description', 'Description'),
        cell: ({ row }) => row.original.line_description || '—',
      },
      {
        accessorKey: 'rated_in_bill_run_id',
        header: t('billing.usage.columns.rated', 'Rated'),
        cell: ({ row }) =>
          row.original.rated_in_bill_run_id ? (
            // Rated records carry the Bill Run that priced them — link to it.
            // Unrated records have no destination, so they stay non-interactive
            // (no misleading row-level click affordance).
            <Link
              href={`/backend/billing/runs/${row.original.rated_in_bill_run_id}`}
              className="rounded-sm hover:underline"
            >
              <Tag variant="success">{t('billing.usage.rated.yes', 'Rated')}</Tag>
            </Link>
          ) : (
            <Tag variant="default">{t('billing.usage.rated.no', 'Unrated')}</Tag>
          ),
      },
    ],
    [t],
  )

  return (
    <div className="mt-6">
      <DataTable
        title={t('billing.accounts.detail.usage.title', 'Usage')}
        columns={columns}
        data={rows}
        isLoading={loading}
        pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        emptyState={
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {t('billing.accounts.detail.usage.empty', 'No usage records for this account yet.')}
          </div>
        }
      />
    </div>
  )
}

export default function BillingAccountDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  // OM serves backend pages through a catch-all route — the dynamic
  // `[id]` segment arrives as a page prop; `useParams()` is the fallback.
  const urlParams = useParams<{ id: string }>()
  const accountId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [row, setRow] = React.useState<AccountRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/accounts?id=${accountId}&pageSize=1`,
      )
      const found = result.items?.[0]
      if (!found) {
        setError(t('billing.accounts.detail.error.not_found', 'Account not found'))
        return
      }
      setRow(found)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      setError(message || t('billing.accounts.detail.error.load', 'Failed to load account'))
    } finally {
      setLoading(false)
    }
  }, [accountId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = React.useCallback(
    async (values: AccountFormValues) => {
      if (!row) return
      setSaving(true)
      try {
        const payload: Record<string, unknown> = {
          id: row.id,
          name: values.name.trim(),
          billCycle: values.billCycle,
          billCycleAnchor: values.billCycleAnchor.trim(),
          invoiceEmail: values.invoiceEmail.trim(),
          invoiceLanguage: values.invoiceLanguage.trim().toLowerCase(),
          invoiceAddress: {
            line1: values.invoiceAddress.line1.trim(),
            ...(values.invoiceAddress.line2.trim()
              ? { line2: values.invoiceAddress.line2.trim() }
              : {}),
            city: values.invoiceAddress.city.trim(),
            postal_code: values.invoiceAddress.postal_code.trim(),
            country: values.invoiceAddress.country.trim().toUpperCase(),
          },
          nextBillDate: values.nextBillDate,
          isActive: values.isActive,
        }
        payload.taxId = values.taxId.trim() === '' ? null : values.taxId.trim()

        await apiCallOrThrow('/api/billing/accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        flash(t('billing.accounts.detail.save.success', 'Account updated'), 'success')
        setEditing(false)
        void load()
      } catch (err) {
        const { message, fieldErrors } = normalizeCrudServerError(err)
        const fieldDetail =
          fieldErrors && Object.keys(fieldErrors).length
            ? Object.entries(fieldErrors)
                .map(([field, msg]) => `${field}: ${msg}`)
                .join('; ')
            : null
        const detailed =
          fieldDetail && message
            ? `${message} — ${fieldDetail}`
            : fieldDetail || message
        flash(detailed || t('billing.accounts.detail.save.error', 'Save failed'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [load, row, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!row) return
    const ok = await confirm({
      title: t('billing.accounts.detail.delete.confirm.title', 'Delete account?'),
      text: t(
        'billing.accounts.detail.delete.confirm.text',
        "Soft-deletes the account. Its items + usage records stay in the database for audit; the Bill Run engine will stop picking it up immediately.",
      ),
      confirmText: t('billing.accounts.detail.delete.confirm.button', 'Soft delete'),
      variant: 'destructive',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await apiCallOrThrow('/api/billing/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      flash(t('billing.accounts.detail.delete.success', 'Account deleted'), 'success')
      router.push('/backend/billing/accounts')
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.accounts.detail.delete.error', 'Delete failed'), 'error')
      setDeleting(false)
    }
  }, [confirm, router, row, t])

  if (error) {
    return (
      <Page>
        <PageHeader title={t('billing.accounts.detail.title', 'Billing Account')} />
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  if (loading || !row) {
    return (
      <Page>
        <PageHeader title={t('billing.accounts.detail.title', 'Billing Account')} />
        <PageBody>
          <LoadingMessage
            label={t('billing.accounts.detail.loading', 'Loading account…')}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/accounts"
        entityTypeLabel={t('billing.accounts.detail.title', 'Billing Account')}
        title={row.name}
        statusBadge={
          row.is_active ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          )
        }
        actionsContent={
          <>
            <Button asChild variant="outline">
              <Link href={`/backend/billing/items/create?billAccountId=${row.id}`}>
                <Plus size={16} />
                {t('billing.accounts.detail.add_item', 'Add item')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/backend/billing/usage/create?billAccountId=${row.id}`}>
                <Plus size={16} />
                {t('billing.accounts.detail.add_usage', 'Add usage')}
              </Link>
            </Button>
            {!editing ? (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil size={16} />
                {t('billing.common.edit', 'Edit')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting
                ? t('billing.accounts.detail.delete.in_progress', 'Deleting…')
                : t('billing.accounts.detail.delete.action', 'Soft delete')}
            </Button>
          </>
        }
      />
      <PageBody>
        {editing ? (
          <AccountForm
            mode="edit"
            initial={toFormValues(row)}
            submitting={saving}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <AccountView row={row} />
        )}
        <AccountItemsSection accountId={row.id} />
        <AccountUsageSection accountId={row.id} />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
