"use client"
import * as React from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import {
  ItemForm,
  type AssembledItemPayload,
  type ItemFormValues,
} from '../../../../components/ItemForm'
import { DetailCard, DetailField } from '../../../../components/DetailFields'

/**
 * `/backend/billing/items/[id]` — Billing Item detail.
 *
 * Opens read-only (field grid). The `Edit` button swaps the grid for
 * the `ItemForm`; Save / Cancel return to the read-only view. Loads
 * via the list endpoint (`?id=<id>`), edits through `PUT`, soft-delete
 * via `DELETE` with a `ConfirmDialog` gate.
 *
 * Two read-only badges at the top: `currencyMismatch` and
 * `billedToDate` (Bill Run engine-managed columns the operator
 * cannot edit but needs to see for troubleshooting).
 */

// API list rows are snake_case (see `api/items/route.ts` `fields`).
// `bill_account_name` is resolved by the route's `afterList` hook.
type BillingItemRow = {
  id: string
  bill_account_id: string
  bill_account_name: string | null
  type: 'one_time' | 'recurring' | 'usage'
  bill_start_date: string
  bill_end_date: string | null
  description: string
  rate_json: Record<string, unknown> | null
  uom_code: string | null
  subscription_id: string | null
  subscription_item_id: string | null
  source_ref: string | null
  currency_mismatch: boolean
  billed_to_date: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type ListResponse = { items: BillingItemRow[] }

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function formatRate(row: BillingItemRow): string {
  const rate = (row.rate_json ?? {}) as Record<string, unknown>
  if (row.type === 'one_time' && typeof rate.amount === 'number') {
    return String(rate.amount)
  }
  if (row.type === 'recurring' && typeof rate.unit_price === 'number') {
    return String(rate.unit_price)
  }
  if (row.type === 'usage') {
    if ('model' in rate && 'tiers' in rate) {
      return `tiered (${String(rate.model)})`
    }
    if (typeof rate.unit_price === 'number') {
      return String(rate.unit_price)
    }
  }
  return '—'
}

function toFormValues(row: BillingItemRow): Partial<ItemFormValues> {
  const rate = (row.rate_json ?? {}) as Record<string, unknown>
  const out: Partial<ItemFormValues> = {
    billAccountId: row.bill_account_id,
    type: row.type,
    billStartDate: row.bill_start_date?.slice(0, 10) ?? '',
    billEndDate: row.bill_end_date?.slice(0, 10) ?? '',
    description: row.description,
    uomCode: row.uom_code ?? '',
    subscriptionId: row.subscription_id ?? '',
    subscriptionItemId: row.subscription_item_id ?? '',
    isActive: row.is_active,
  }
  if (row.type === 'one_time' && typeof rate.amount === 'number') {
    out.oneTimeAmount = String(rate.amount)
  } else if (row.type === 'recurring' && typeof rate.unit_price === 'number') {
    out.recurringUnitPrice = String(rate.unit_price)
  } else if (row.type === 'usage') {
    if ('model' in rate && 'tiers' in rate) {
      out.usageMode = 'tiered'
      out.usageTieredJson = JSON.stringify(rate, null, 2)
    } else if (typeof rate.unit_price === 'number') {
      out.usageMode = 'simple'
      out.usageUnitPrice = String(rate.unit_price)
    }
  }
  return out
}

// ─── Read-only view ──────────────────────────────────────────────

function ItemView({ row }: { row: BillingItemRow }) {
  const t = useT()
  return (
    <DetailCard>
      <DetailField label={t('billing.items.detail.field.account', 'Account')}>
        <Link
          href={`/backend/billing/accounts/${row.bill_account_id}`}
          className="text-primary hover:underline"
        >
          {row.bill_account_name ?? row.bill_account_id}
        </Link>
      </DetailField>
      <DetailField label={t('billing.items.columns.type', 'Type')}>
        <Tag variant="info">{row.type}</Tag>
      </DetailField>
      <DetailField label={t('billing.items.columns.start', 'Start')}>
        {formatDate(row.bill_start_date)}
      </DetailField>
      <DetailField label={t('billing.items.columns.end', 'End')}>
        {formatDate(row.bill_end_date)}
      </DetailField>
      <DetailField label={t('billing.items.form.rate.title', 'Rate')}>
        {formatRate(row)}
      </DetailField>
      <DetailField label={t('billing.items.columns.uom', 'UoM')}>
        {row.uom_code || '—'}
      </DetailField>
      <DetailField label={t('billing.items.form.subscription_id', 'Subscription ID')}>
        {row.subscription_id || '—'}
      </DetailField>
      <DetailField
        label={t('billing.items.form.subscription_item_id', 'Subscription item ID')}
      >
        {row.subscription_item_id || '—'}
      </DetailField>
      <DetailField label={t('billing.items.detail.field.source_ref', 'Source ref')}>
        {row.source_ref ? (
          <span className="font-mono text-xs">{row.source_ref}</span>
        ) : (
          '—'
        )}
      </DetailField>
      <DetailField label={t('billing.items.detail.field.billed_to', 'Billed through')}>
        {row.billed_to_date ? formatDate(row.billed_to_date) : '—'}
      </DetailField>
      {row.currency_mismatch ? (
        <DetailField
          label={t('billing.items.detail.currency_mismatch', 'Currency mismatch')}
        >
          <Tag variant="warning">{t('billing.common.yes', 'Yes')}</Tag>
        </DetailField>
      ) : null}
      <DetailField label={t('billing.items.columns.status', 'Status')}>
        {row.is_active ? (
          <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
        ) : (
          <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
        )}
      </DetailField>
      <DetailField label={t('billing.common.id', 'ID')}>
        <span className="font-mono text-xs">{row.id}</span>
      </DetailField>
    </DetailCard>
  )
}

export default function BillingItemDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  // OM serves backend pages through a catch-all route — the dynamic
  // `[id]` segment arrives as a page prop; `useParams()` is the fallback.
  const urlParams = useParams<{ id: string }>()
  const itemId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [row, setRow] = React.useState<BillingItemRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const load = React.useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setError(null)
    try {
      const result = await readApiResultOrThrow<ListResponse>(
        `/api/billing/items?id=${itemId}&pageSize=1`,
      )
      const found = result.items?.[0]
      if (!found) {
        setError(t('billing.items.detail.error.not_found', 'Item not found'))
        return
      }
      setRow(found)
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      setError(message || t('billing.items.detail.error.load', 'Failed to load item'))
    } finally {
      setLoading(false)
    }
  }, [itemId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = React.useCallback(
    async (assembled: AssembledItemPayload) => {
      if (!row) return
      setSaving(true)
      try {
        const payload: Record<string, unknown> = {
          id: row.id,
          billStartDate: assembled.billStartDate,
          description: assembled.description,
          rateJson: assembled.rateJson,
          isActive: assembled.isActive ?? row.is_active,
        }
        // Optional fields — submit null when the operator cleared them
        // so the column actually resets (the schema validators accept
        // null for nullable columns).
        payload.billEndDate = assembled.billEndDate ?? null
        payload.uomCode = assembled.uomCode ?? null
        payload.subscriptionId = assembled.subscriptionId ?? null
        payload.subscriptionItemId = assembled.subscriptionItemId ?? null

        await apiCallOrThrow('/api/billing/items', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        flash(t('billing.items.detail.save.success', 'Item updated'), 'success')
        setEditing(false)
        void load()
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.items.detail.save.error', 'Save failed'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [load, row, t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!row) return
    const ok = await confirm({
      title: t('billing.items.detail.delete.confirm.title', 'Delete item?'),
      text: t(
        'billing.items.detail.delete.confirm.text',
        'Soft-deletes the item. Its row stays in the database for audit; the Bill Run engine will stop including it immediately.',
      ),
      confirmText: t('billing.items.detail.delete.confirm.button', 'Soft delete'),
      variant: 'destructive',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await apiCallOrThrow('/api/billing/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      flash(t('billing.items.detail.delete.success', 'Item deleted'), 'success')
      router.push('/backend/billing/items')
    } catch (err) {
      const { message } = normalizeCrudServerError(err)
      flash(message || t('billing.items.detail.delete.error', 'Delete failed'), 'error')
      setDeleting(false)
    }
  }, [confirm, router, row, t])

  if (error) {
    return (
      <Page>
        <PageHeader title={t('billing.items.detail.title', 'Billing Item')} />
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (loading || !row) {
    return (
      <Page>
        <PageHeader title={t('billing.items.detail.title', 'Billing Item')} />
        <PageBody>
          <LoadingMessage label={t('billing.items.detail.loading', 'Loading item…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/items"
        entityTypeLabel={t('billing.items.detail.title', 'Billing Item')}
        title={row.description}
        statusBadge={
          row.is_active ? (
            <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
          ) : (
            <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
          )
        }
        actionsContent={
          <>
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
                ? t('billing.items.detail.delete.in_progress', 'Deleting…')
                : t('billing.items.detail.delete.action', 'Soft delete')}
            </Button>
          </>
        }
      />
      <PageBody>
        {editing ? (
          <ItemForm
            mode="edit"
            initial={toFormValues(row)}
            submitting={saving}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ItemView row={row} />
        )}
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
