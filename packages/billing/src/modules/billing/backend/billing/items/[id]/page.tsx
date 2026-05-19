"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
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

/**
 * `/backend/billing/items/[id]` — Billing Item detail + edit.
 *
 * Loads the item via the existing list endpoint (`?id=<id>`). Edits
 * go through `PUT /api/billing/items`. Soft-delete via `DELETE` with
 * a `ConfirmDialog` gate. The form is in `mode='edit'` — type is
 * hidden (immutable per spec), account / type / sourceRef are not
 * editable.
 *
 * Two read-only badges at the top: `currencyMismatch` and
 * `billedToDate` (Bill Run engine-managed columns the operator
 * cannot edit but needs to see for troubleshooting).
 */

type BillingItemRow = {
  id: string
  billAccountId: string
  type: 'one_time' | 'recurring' | 'usage'
  billStartDate: string
  billEndDate: string | null
  description: string
  rateJson: Record<string, unknown> | null
  uomCode: string | null
  subscriptionId: string | null
  subscriptionItemId: string | null
  sourceRef: string | null
  currencyMismatch: boolean
  billedToDate: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ListResponse = { items: BillingItemRow[] }

function toFormValues(row: BillingItemRow): Partial<ItemFormValues> {
  const rate = (row.rateJson ?? {}) as Record<string, unknown>
  const out: Partial<ItemFormValues> = {
    billAccountId: row.billAccountId,
    type: row.type,
    billStartDate: row.billStartDate?.slice(0, 10) ?? '',
    billEndDate: row.billEndDate?.slice(0, 10) ?? '',
    description: row.description,
    uomCode: row.uomCode ?? '',
    subscriptionId: row.subscriptionId ?? '',
    subscriptionItemId: row.subscriptionItemId ?? '',
    isActive: row.isActive,
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

export default function BillingItemDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const itemId = typeof params.id === 'string' ? params.id : ''

  const [row, setRow] = React.useState<BillingItemRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
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
          isActive: assembled.isActive ?? row.isActive,
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
      <PageHeader title={t('billing.items.detail.title', 'Billing Item')} />
      <PageBody>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Tag variant="info">{row.type}</Tag>
              {row.currencyMismatch ? (
                <Tag variant="warning">
                  {t('billing.items.detail.currency_mismatch', 'Currency mismatch')}
                </Tag>
              ) : null}
              {row.billedToDate ? (
                <Tag variant="default">
                  {t('billing.items.detail.billed_to', 'Billed through {date}').replace(
                    '{date}',
                    row.billedToDate.slice(0, 10),
                  )}
                </Tag>
              ) : null}
              {row.sourceRef ? (
                <Tag variant="default">
                  {t('billing.items.detail.source_ref', 'source_ref: {ref}').replace(
                    '{ref}',
                    row.sourceRef,
                  )}
                </Tag>
              ) : null}
            </div>
            <div className="text-base font-semibold">{row.description}</div>
            <div className="text-xs text-muted-foreground font-mono">{row.id}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('billing.items.detail.field.account', 'Account')}:{' '}
              <Link
                href={`/backend/billing/accounts/${row.billAccountId}`}
                className="font-mono text-primary hover:underline"
              >
                {row.billAccountId}
              </Link>
            </div>
          </div>
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
        </div>

        <ItemForm
          mode="edit"
          initial={toFormValues(row)}
          submitting={saving}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/backend/billing/items')}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
