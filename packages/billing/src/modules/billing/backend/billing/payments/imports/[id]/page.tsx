"use client"
import * as React from 'react'
import { useParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Stat, StatCard } from '../../../../../components/DetailFields'
import { PaymentsTable } from '../../../../../components/PaymentsTable'

/** One CSV upload batch (Spec C, C-D4): counts per outcome, row errors and its payments. */

type ImportRecord = {
  id: string
  file_name: string
  row_count: number
  counts: Record<string, number> | null
  errors: Array<{ row: number; message: string }> | null
  created_at: string
}

export default function PaymentImportPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [record, setRecord] = React.useState<ImportRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!id) return
    readApiResultOrThrow<{ import: ImportRecord }>(`/api/billing/payment-imports/${encodeURIComponent(id)}`)
      .then((result) => setRecord(result.import))
      .catch((err) => {
        const normalized = normalizeCrudServerError(err)
        if ((err as { status?: number })?.status === 404) setNotFound(true)
        else setError(normalized.message || t('billing.payments.import.load_error', 'Could not load the import'))
      })
  }, [id, t])

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState label={t('billing.payments.import.not_found', 'Import not found')} backHref="/backend/billing/payments" backLabel={t('billing.payments.title', 'Payments')} />
        </PageBody>
      </Page>
    )
  }
  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (!record || !id) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('billing.payments.import.loading', 'Loading import…')} />
        </PageBody>
      </Page>
    )
  }
  const counts = record.counts ?? {}
  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/payments"
        entityTypeLabel={t('billing.payments.import.detail_title', 'Payment import')}
        title={record.file_name}
      />
      <PageBody>
        <div className="space-y-6">
          <StatCard>
            <Stat label={t('billing.payments.import.counts.allocated', 'Allocated')} value={counts.allocated ?? 0} />
            <Stat label={t('billing.payments.import.counts.partially_allocated', 'Partially allocated')} value={counts.partially_allocated ?? 0} />
            <Stat label={t('billing.payments.import.counts.matched', 'Matched (credit)')} value={counts.matched ?? 0} />
            <Stat label={t('billing.payments.import.counts.unmatched', 'Unmatched')} value={counts.unmatched ?? 0} />
            <Stat label={t('billing.payments.import.counts.duplicate', 'Duplicates')} value={counts.duplicate ?? 0} />
            <Stat label={t('billing.payments.import.counts.rejected', 'Rejected rows')} value={counts.rejected ?? 0} />
          </StatCard>
          {(record.errors ?? []).length > 0 ? (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <h2 className="mb-2 font-semibold">{t('billing.payments.import.errors', 'Rejected rows')}</h2>
              {(record.errors ?? []).map((row) => (
                <div key={`${row.row}-${row.message}`} className="text-muted-foreground">
                  {t('billing.payments.import.line', 'Line')} {row.row}: {row.message}
                </div>
              ))}
            </div>
          ) : null}
          <PaymentsTable title={t('billing.payments.title', 'Payments')} tableId="billing-payment-import-payments" importId={id} />
        </div>
      </PageBody>
    </Page>
  )
}
