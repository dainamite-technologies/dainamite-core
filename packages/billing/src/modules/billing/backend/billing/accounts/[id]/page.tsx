"use client"
import * as React from 'react'
import Link from 'next/link'
import { Pencil, Play, Plus } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AccountForm, type AccountFormValues } from '../../../../components/AccountForm'
import { PrepaidPanel } from '../../../../components/PrepaidPanel'
import { AccountInvoicesSection } from '../../../../components/AccountInvoicesSection'
import { AccountPaymentsSection } from '../../../../components/AccountPaymentsSection'
import { AccountView } from '../../../../components/account/AccountView'
import { AccountItemsTab } from '../../../../components/account/AccountItemsTab'
import { AccountUsageTab } from '../../../../components/account/AccountUsageTab'
import { AccountRunsTab } from '../../../../components/account/AccountRunsTab'
import { AccountStatementsTab } from '../../../../components/account/AccountStatementsTab'
import { AccountSummaryCards } from '../../../../components/account/AccountSummaryCards'
import { AccountRunBillingDialog } from '../../../../components/account/AccountRunBillingDialog'
import { toFormValues, type AccountRow } from '../../../../components/account/accountRow'
import { accountHref, isAccountTab, type AccountTab } from '../../../../lib/navigation'

/**
 * `/backend/billing/accounts/[id]` — the Billing Account workspace
 * (Spec E §4, delivered by Spec F, F8).
 *
 * Header actions (Run billing, Add item / usage, Edit, Soft delete), summary
 * cards from `GET /api/billing/accounts/{id}/summary`, and deep-linkable
 * tabs (`?tab=`). A tab mounts on first open and stays mounted, so switching
 * back keeps its page and filters; prepaid-only tabs are hidden for postpaid
 * accounts and vice versa. Loads via `GET /api/billing/accounts?id=<id>`,
 * edits through `PUT`, soft-delete through `DELETE`.
 *
 * `customerId` + `currencyCode` are immutable on update — the form
 * disables both in `mode='edit'` and the schema rejects them per
 * `billingAccountUpdateSchema`.
 */

type ListResponse = { items: AccountRow[] }

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
  const [runDialogOpen, setRunDialogOpen] = React.useState(false)
  // Bumped after a run / cleanup so the summary and run-driven tabs reload.
  const [refreshKey, setRefreshKey] = React.useState(0)
  const refresh = React.useCallback(() => setRefreshKey((key) => key + 1), [])

  // Deep-linkable tab (`?tab=`); router.replace keeps history clean.
  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get('tab')
  const activeTab: AccountTab = isAccountTab(requestedTab) ? requestedTab : 'overview'
  const [visitedTabs, setVisitedTabs] = React.useState<Set<AccountTab>>(() => new Set([activeTab]))
  React.useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
  }, [activeTab])
  const selectTab = React.useCallback(
    (next: string) => {
      if (!isAccountTab(next) || !accountId) return
      router.replace(accountHref(accountId, next), { scroll: false })
    },
    [accountId, router],
  )

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  // `silent` refreshes the row in place (after a run / save) without the
  // full-page loading state, which would unmount the workspace and its dialogs.
  const load = React.useCallback(async (options: { silent?: boolean } = {}) => {
    if (!accountId) return
    if (!options.silent) setLoading(true)
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
        // billingMode is immutable on update; creditLimit + threshold are editable.
        const creditLimit = Number.parseFloat(values.creditLimit)
        if (Number.isFinite(creditLimit) && creditLimit >= 0) payload.creditLimit = creditLimit
        const termsDays = Number.parseInt(values.paymentTermsDays, 10)
        payload.paymentTermsDays =
          values.paymentTermsDays.trim() && Number.isInteger(termsDays) && termsDays >= 0 ? termsDays : null
        payload.autoSendInvoice = values.autoSendInvoice
        if (row.billing_mode === 'prepaid' && values.lowBalanceThreshold.trim()) {
          const threshold = Number.parseFloat(values.lowBalanceThreshold)
          if (Number.isFinite(threshold) && threshold >= 0) payload.lowBalanceThreshold = threshold
        }

        await apiCallOrThrow('/api/billing/accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        flash(t('billing.accounts.detail.save.success', 'Account updated'), 'success')
        setEditing(false)
        void load({ silent: true })
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

  const isPrepaid = row?.billing_mode === 'prepaid'
  const visibleTabs: AccountTab[] = isPrepaid
    ? ['overview', 'items', 'usage', 'invoices', 'balance', 'statements', 'runs']
    : ['overview', 'items', 'usage', 'invoices', 'payments', 'runs']
  const tabLabels: Record<AccountTab, string> = {
    overview: t('billing.accounts.tabs.overview', 'Overview'),
    items: t('billing.accounts.tabs.items', 'Items'),
    usage: t('billing.accounts.tabs.usage', 'Usage'),
    invoices: t('billing.accounts.tabs.invoices', 'Invoices'),
    payments: t('billing.accounts.tabs.payments', 'Payments'),
    balance: t('billing.accounts.tabs.balance', 'Balance & top-ups'),
    statements: t('billing.accounts.tabs.statements', 'Statements'),
    runs: t('billing.accounts.tabs.runs', 'Bill runs'),
  }
  // A tab that does not apply to this account's mode falls back to Overview.
  const currentTab: AccountTab = visibleTabs.includes(activeTab) ? activeTab : 'overview'
  const renderTab = (tab: AccountTab): React.ReactNode => {
    if (!row) return null
    switch (tab) {
      case 'overview':
        return editing ? (
          <AccountForm
            mode="edit"
            initial={toFormValues(row)}
            submitting={saving}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <AccountView row={row} />
        )
      case 'items':
        return <AccountItemsTab key={refreshKey} accountId={row.id} currencyCode={row.currency_code} />
      case 'usage':
        return <AccountUsageTab accountId={row.id} />
      case 'invoices':
        return <AccountInvoicesSection key={refreshKey} accountId={row.id} showSummary={false} />
      case 'payments':
        return <AccountPaymentsSection accountId={row.id} currencyCode={row.currency_code} />
      case 'balance':
        return <PrepaidPanel key={refreshKey} accountId={row.id} currencyCode={row.currency_code} />
      case 'statements':
        return <AccountStatementsTab accountId={row.id} refreshKey={refreshKey} />
      case 'runs':
        return <AccountRunsTab accountId={row.id} refreshKey={refreshKey} />
    }
  }

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
          <span className="inline-flex items-center gap-2">
            {row.is_active ? (
              <Tag variant="success">{t('billing.common.active', 'Active')}</Tag>
            ) : (
              <Tag variant="default">{t('billing.common.inactive', 'Inactive')}</Tag>
            )}
            {row.billing_mode === 'prepaid' ? (
              <Tag variant="brand">{t('billing.mode.prepaid', 'Prepaid')}</Tag>
            ) : (
              <Tag variant="neutral">{t('billing.mode.postpaid', 'Postpaid')}</Tag>
            )}
          </span>
        }
        actionsContent={
          <>
            <Button type="button" variant="outline" onClick={() => setRunDialogOpen(true)}>
              <Play size={16} />
              {t('billing.accounts.run.action', 'Run billing')}
            </Button>
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
              <Button
                type="button"
                onClick={() => {
                  setEditing(true)
                  selectTab('overview')
                }}
              >
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
        <div className="space-y-6">
          <AccountSummaryCards accountId={row.id} refreshKey={refreshKey} />
          <Tabs value={currentTab} onValueChange={selectTab} variant="underline">
            <TabsList aria-label={t('billing.accounts.tabs.label', 'Account sections')}>
              {visibleTabs.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {tabLabels[tab]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {visibleTabs.map((tab) =>
            visitedTabs.has(tab) || tab === currentTab ? (
              <div key={tab} role="tabpanel" hidden={tab !== currentTab}>
                {renderTab(tab)}
              </div>
            ) : null,
          )}
        </div>
        <AccountRunBillingDialog
          accountId={row.id}
          open={runDialogOpen}
          onOpenChange={setRunDialogOpen}
          onCompleted={() => {
            setRunDialogOpen(false)
            refresh()
            void load({ silent: true })
            selectTab('runs')
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
