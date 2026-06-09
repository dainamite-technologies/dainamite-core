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
import {
  UsageForm,
  type UsageAccountOption,
  type AssembledUsagePayload,
} from '../../../../components/UsageForm'

/**
 * `/backend/billing/usage/create` — manually record a usage entry.
 *
 * Mirrors `items/create`: loads the account list once to drive the
 * picker, supports `?billAccountId=<id>` deep-link from the account
 * detail page's "Add usage" CTA, and POSTs to `/api/billing/usage`
 * (the same endpoint external meters use). Usage has no detail page —
 * on success we return to the account detail where the new record
 * shows up in the Usage section.
 */
export default function CreateBillingUsagePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedAccountId = searchParams.get('billAccountId') ?? ''

  const [accounts, setAccounts] = React.useState<UsageAccountOption[] | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await readApiResultOrThrow<{ items: UsageAccountOption[] }>(
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
    async (payload: AssembledUsagePayload) => {
      setSubmitting(true)
      try {
        const call = await apiCallOrThrow<{ id: string; deduplicated: boolean }>(
          '/api/billing/usage',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        if (call.result?.deduplicated) {
          flash(
            t(
              'billing.usage.create.deduplicated',
              'A usage record with that source reference already existed — nothing was duplicated.',
            ),
            'success',
          )
        } else {
          flash(t('billing.usage.create.success', 'Usage record created'), 'success')
        }
        router.push(`/backend/billing/accounts/${payload.billAccountId}`)
      } catch (err) {
        const { message } = normalizeCrudServerError(err)
        flash(
          message || t('billing.usage.create.error', 'Failed to record usage'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [router, t],
  )

  const handleCancel = React.useCallback(() => {
    if (preselectedAccountId) {
      router.push(`/backend/billing/accounts/${preselectedAccountId}`)
    } else {
      router.push('/backend/billing/accounts')
    }
  }, [preselectedAccountId, router])

  return (
    <Page>
      <PageHeader title={t('billing.usage.create.title', 'Record Usage')} />
      <PageBody>
        {accounts === null ? (
          <LoadingMessage label={t('billing.usage.create.loading', 'Loading accounts…')} />
        ) : (
          <UsageForm
            accountOptions={accounts}
            initial={
              preselectedAccountId ? { billAccountId: preselectedAccountId } : undefined
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
