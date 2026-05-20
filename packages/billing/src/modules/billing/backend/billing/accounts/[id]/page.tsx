"use client"
import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
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

/**
 * `/backend/billing/accounts/[id]` — Billing Account detail + edit.
 *
 * Loads the account via `GET /api/billing/accounts?id=<id>` (filter
 * shortcut on the existing list endpoint — saves us a dedicated
 * `[id]` route on the billing-accounts surface). Edits go through
 * `PUT /api/billing/accounts`. Delete is a confirmed soft-delete via
 * `DELETE /api/billing/accounts`.
 *
 * `customerId` + `currencyCode` are immutable on update — the form
 * disables both in `mode='edit'` and the underlying schema also
 * rejects them per `billingAccountUpdateSchema`.
 */

type AccountRow = {
  id: string
  customerId: string
  name: string
  currencyCode: string
  billCycle: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  billCycleAnchor: string
  invoiceEmail: string
  invoiceLanguage: string
  taxId: string | null
  invoiceAddress: {
    line1?: string
    line2?: string
    city?: string
    postal_code?: string
    country?: string
  } | null
  nextBillDate: string
  lastBillDate: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ListResponse = { items: AccountRow[] }

function toFormValues(row: AccountRow): AccountFormValues {
  return {
    customerId: row.customerId,
    name: row.name,
    currencyCode: row.currencyCode,
    billCycle: row.billCycle,
    billCycleAnchor: row.billCycleAnchor,
    invoiceEmail: row.invoiceEmail,
    invoiceLanguage: row.invoiceLanguage,
    taxId: row.taxId ?? '',
    invoiceAddress: {
      line1: row.invoiceAddress?.line1 ?? '',
      line2: row.invoiceAddress?.line2 ?? '',
      city: row.invoiceAddress?.city ?? '',
      postal_code: row.invoiceAddress?.postal_code ?? '',
      country: row.invoiceAddress?.country ?? '',
    },
    nextBillDate: row.nextBillDate?.slice(0, 10) ?? '',
    isActive: row.isActive,
  }
}

export default function BillingAccountDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const accountId = typeof params.id === 'string' ? params.id : ''

  const [row, setRow] = React.useState<AccountRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
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
        void load()
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(message || t('billing.accounts.detail.save.error', 'Save failed'), 'error')
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
      <PageHeader title={t('billing.accounts.detail.title', 'Billing Account')} />
      <PageBody>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-base font-semibold">{row.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{row.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/backend/billing/items?billAccountId=${row.id}`}>
                {t('billing.accounts.detail.view_items', 'View items')}
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/backend/billing/items/create?billAccountId=${row.id}`}>
                <Plus size={16} />
                {t('billing.accounts.detail.add_item', 'Add item')}
              </Link>
            </Button>
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
          </div>
        </div>

        <AccountForm
          mode="edit"
          initial={toFormValues(row)}
          submitting={saving}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/backend/billing/accounts')}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
