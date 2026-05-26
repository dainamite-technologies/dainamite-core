"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AccountForm, type AccountFormValues } from '../../../../components/AccountForm'

/**
 * `/backend/billing/accounts/create` — create a Billing Account.
 *
 * POSTs `/api/billing/accounts`. On success, flash + navigate to the
 * new account's detail page (`/backend/billing/accounts/<id>`) so the
 * operator can continue editing if they need to tweak after-creation
 * details.
 */
export default function CreateBillingAccountPage() {
  const t = useT()
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = React.useCallback(
    async (values: AccountFormValues) => {
      setSubmitting(true)
      try {
        const payload: Record<string, unknown> = {
          customerId: values.customerId.trim(),
          name: values.name.trim(),
          currencyCode: values.currencyCode.trim().toUpperCase(),
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
        }
        if (values.taxId.trim()) payload.taxId = values.taxId.trim()

        const call = await apiCallOrThrow<{ id: string }>('/api/billing/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const id = call.result?.id
        flash(t('billing.accounts.create.success', 'Billing account created'), 'success')
        if (id) {
          router.push(`/backend/billing/accounts/${id}`)
        } else {
          router.push('/backend/billing/accounts')
        }
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
        flash(
          detailed || t('billing.accounts.create.error', 'Failed to create account'),
          'error',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [router, t],
  )

  const handleCancel = React.useCallback(() => {
    router.push('/backend/billing/accounts')
  }, [router])

  return (
    <Page>
      <PageHeader title={t('billing.accounts.create.title', 'Create Billing Account')} />
      <PageBody>
        <AccountForm
          mode="create"
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </PageBody>
    </Page>
  )
}
