"use client"
import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCallOrThrow,
  readApiResultOrThrow,
} from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { ItemForm, type AccountOption, type AssembledItemPayload } from '../../../../components/ItemForm'
import { ITEMS_LIST_HREF, accountHref, itemDetailHref } from '../../../../lib/navigation'

/**
 * `/backend/billing/items/create` — create a Billing Item.
 *
 * Loads the account list once on mount to drive the account picker.
 * Supports `?billAccountId=<id>` deep-link so the parent account
 * page (when we add an "Add item" CTA there) can pre-select.
 *
 * POSTs `/api/billing/items`. Navigation (Spec E, D23): opened from an
 * account (`?billAccountId=`) → save and cancel both return to that
 * account; opened standalone → save goes to the new item, cancel to the
 * Items list.
 */
export default function CreateBillingItemPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedAccountId = searchParams.get('billAccountId') ?? ''

  const [accounts, setAccounts] = React.useState<AccountOption[] | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await readApiResultOrThrow<{ items: AccountOption[] }>(
          '/api/billing/accounts?pageSize=100&sortField=name&sortDir=asc',
        )
        if (!cancelled) setAccounts(result.items ?? [])
      } catch {
        if (!cancelled) setAccounts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = React.useCallback(
    async (payload: AssembledItemPayload) => {
      setSubmitting(true)
      try {
        const call = await apiCallOrThrow<{ id: string; deduplicated: boolean }>(
          '/api/billing/items',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        const id = call.result?.id
        flash(t('billing.items.create.success', 'Billing item created'), 'success')
        if (preselectedAccountId) {
          router.push(accountHref(preselectedAccountId))
        } else if (id) {
          router.push(itemDetailHref(id, { fromItemsList: true }))
        } else {
          router.push(ITEMS_LIST_HREF)
        }
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(
          message || t('billing.items.create.error', 'Failed to create item'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [preselectedAccountId, router, t],
  )

  const handleCancel = React.useCallback(() => {
    router.push(preselectedAccountId ? accountHref(preselectedAccountId) : ITEMS_LIST_HREF)
  }, [preselectedAccountId, router])

  return (
    <Page>
      <PageHeader title={t('billing.items.create.title', 'Create Billing Item')} />
      <PageBody>
        {accounts === null ? (
          <LoadingMessage label={t('billing.items.create.loading', 'Loading accounts…')} />
        ) : (
          <ItemForm
            mode="create"
            accountOptions={accounts}
            initial={
              preselectedAccountId
                ? { billAccountId: preselectedAccountId }
                : undefined
            }
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        )}
      </PageBody>
    </Page>
  )
}
