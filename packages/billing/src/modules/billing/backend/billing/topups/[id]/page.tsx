"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { DetailCard, DetailField } from '../../../../components/DetailFields'
import { statusVariant } from '../page'

type TopupRow = {
  id: string
  bill_account_id: string
  status: string
  amount: string
  currency_code: string
  provider_key: string
  payment_id: string
  gateway_transaction_id: string | null
  transaction_id: string | null
  receipt_invoice_id: string | null
  source_ref: string | null
  created_at: string
  updated_at: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export default function BillingTopupDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const urlParams = useParams<{ id: string }>()
  const topupId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [row, setRow] = React.useState<TopupRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!topupId) return
    setLoading(true)
    readApiResultOrThrow<{ items: TopupRow[] }>(`/api/billing/topups?id=${topupId}&pageSize=1`)
      .then((res) => {
        if (cancelled) return
        const found = res.items?.[0]
        if (!found) setError(t('billing.topups.detail.not_found', 'Top-up not found'))
        else setRow(found)
      })
      .catch(() => {
        if (!cancelled) setError(t('billing.topups.detail.load_error', 'Failed to load top-up'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topupId, t])

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }
  if (loading || !row) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('billing.topups.detail.loading', 'Loading top-up…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/topups"
        entityTypeLabel={t('billing.topups.detail.title', 'Top-up')}
        title={`${row.amount} ${row.currency_code}`}
        statusBadge={
          <Tag variant={statusVariant(row.status)}>
            {t(`billing.topups.status.${row.status}`, row.status)}
          </Tag>
        }
        actionsContent={
          <Button asChild variant="outline">
            <Link href={`/backend/billing/accounts/${row.bill_account_id}`}>
              {t('billing.topups.detail.view_account', 'View account')}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <DetailCard>
          <DetailField label={t('billing.topups.columns.amount', 'Amount')}>
            <span className="font-mono tabular-nums">
              {row.amount} {row.currency_code}
            </span>
          </DetailField>
          <DetailField label={t('billing.topups.columns.provider', 'Provider')}>
            {row.provider_key}
          </DetailField>
          <DetailField label={t('billing.topups.columns.created', 'Created')}>
            {formatDate(row.created_at)}
          </DetailField>
          <DetailField label={t('billing.topups.detail.updated', 'Updated')}>
            {formatDate(row.updated_at)}
          </DetailField>
          <DetailField label={t('billing.topups.detail.payment_id', 'Payment ID')}>
            <span className="font-mono text-xs">{row.payment_id}</span>
          </DetailField>
          <DetailField label={t('billing.topups.detail.gateway_txn', 'Gateway transaction')}>
            <span className="font-mono text-xs">{row.gateway_transaction_id || '—'}</span>
          </DetailField>
          <DetailField label={t('billing.topups.detail.balance_txn', 'Balance transaction')}>
            <span className="font-mono text-xs">{row.transaction_id || '—'}</span>
          </DetailField>
          <DetailField label={t('billing.topups.detail.receipt', 'VAT receipt')}>
            {row.receipt_invoice_id ? (
              <Link
                href={`/backend/billing/invoices/${row.receipt_invoice_id}`}
                className="font-mono text-xs hover:underline"
              >
                {row.receipt_invoice_id}
              </Link>
            ) : (
              '—'
            )}
          </DetailField>
          <DetailField label={t('billing.common.id', 'ID')}>
            <span className="font-mono text-xs">{row.id}</span>
          </DetailField>
        </DetailCard>
      </PageBody>
    </Page>
  )
}
