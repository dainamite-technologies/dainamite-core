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
import { txnVariant } from '../page'

type TransactionRow = {
  id: string
  bill_account_id: string
  type: string
  amount: string
  currency_code: string
  balance_after: string
  usage_id: string | null
  billing_item_id: string | null
  topup_id: string | null
  statement_id: string | null
  description: string
  source_ref: string | null
  user_id: string | null
  created_at: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

// A monospace value that links somewhere when present, else an em dash.
function RefField({ id, href }: { id: string | null; href?: string }) {
  if (!id) return <>—</>
  if (href) {
    return (
      <Link href={href} className="font-mono text-xs hover:underline">
        {id}
      </Link>
    )
  }
  return <span className="font-mono text-xs">{id}</span>
}

export default function BillingTransactionDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const urlParams = useParams<{ id: string }>()
  const transactionId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [row, setRow] = React.useState<TransactionRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!transactionId) return
    setLoading(true)
    readApiResultOrThrow<{ items: TransactionRow[] }>(
      `/api/billing/transactions?id=${transactionId}&pageSize=1`,
    )
      .then((res) => {
        if (cancelled) return
        const found = res.items?.[0]
        if (!found) setError(t('billing.transactions.detail.not_found', 'Transaction not found'))
        else setRow(found)
      })
      .catch(() => {
        if (!cancelled)
          setError(t('billing.transactions.detail.load_error', 'Failed to load transaction'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [transactionId, t])

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
          <LoadingMessage label={t('billing.transactions.detail.loading', 'Loading transaction…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/transactions"
        entityTypeLabel={t('billing.transactions.detail.title', 'Transaction')}
        title={`${row.amount} ${row.currency_code}`}
        statusBadge={
          <Tag variant={txnVariant(row.type)}>
            {t(`billing.transactions.type.${row.type}`, row.type)}
          </Tag>
        }
        actionsContent={
          <Button asChild variant="outline">
            <Link href={`/backend/billing/accounts/${row.bill_account_id}`}>
              {t('billing.transactions.detail.view_account', 'View account')}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <DetailCard>
          <DetailField label={t('billing.transactions.columns.amount', 'Amount')}>
            <span className="font-mono tabular-nums">
              {row.amount} {row.currency_code}
            </span>
          </DetailField>
          <DetailField label={t('billing.transactions.columns.balance_after', 'Balance')}>
            <span className="font-mono tabular-nums">{row.balance_after}</span>
          </DetailField>
          <DetailField label={t('billing.transactions.columns.type', 'Type')}>
            <Tag variant={txnVariant(row.type)}>
              {t(`billing.transactions.type.${row.type}`, row.type)}
            </Tag>
          </DetailField>
          <DetailField label={t('billing.transactions.columns.when', 'When')}>
            {formatDate(row.created_at)}
          </DetailField>
          <DetailField label={t('billing.transactions.columns.description', 'Description')} fullWidth>
            {row.description || '—'}
          </DetailField>
          <DetailField label={t('billing.transactions.detail.source_ref', 'Source ref')}>
            <span className="font-mono text-xs">{row.source_ref || '—'}</span>
          </DetailField>
          <DetailField label={t('billing.transactions.detail.topup', 'Top-up')}>
            <RefField
              id={row.topup_id}
              href={row.topup_id ? `/backend/billing/topups/${row.topup_id}` : undefined}
            />
          </DetailField>
          <DetailField label={t('billing.transactions.detail.statement', 'Statement')}>
            <RefField
              id={row.statement_id}
              href={row.statement_id ? `/backend/billing/statements/${row.statement_id}` : undefined}
            />
          </DetailField>
          <DetailField label={t('billing.transactions.detail.usage', 'Usage record')}>
            <RefField id={row.usage_id} />
          </DetailField>
          <DetailField label={t('billing.transactions.detail.item', 'Billing item')}>
            <RefField
              id={row.billing_item_id}
              href={row.billing_item_id ? `/backend/billing/items/${row.billing_item_id}` : undefined}
            />
          </DetailField>
          <DetailField label={t('billing.transactions.detail.user', 'User')}>
            <RefField id={row.user_id} />
          </DetailField>
          <DetailField label={t('billing.common.id', 'ID')}>
            <span className="font-mono text-xs">{row.id}</span>
          </DetailField>
        </DetailCard>
      </PageBody>
    </Page>
  )
}
