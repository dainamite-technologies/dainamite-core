"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { DetailCard, DetailField } from '../../../../components/DetailFields'
import { statementStatusVariant } from '../page'

type BreakdownEntry = {
  billing_item_id: string
  billing_type: string
  uom_code?: string
  quantity: string
  amount: string
}

type StatementRow = {
  id: string
  bill_account_id: string
  bill_run_id: string | null
  period_start: string
  period_end: string
  currency_code: string
  opening_balance: string
  total_topups: string
  total_usage: string
  total_recurring: string
  closing_balance: string
  debit_breakdown: { items?: BreakdownEntry[] } | null
  status: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

export default function BillingStatementDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const urlParams = useParams<{ id: string }>()
  const statementId = (props.params?.id ?? urlParams?.id ?? '') as string

  const [row, setRow] = React.useState<StatementRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!statementId) return
    setLoading(true)
    readApiResultOrThrow<{ items: StatementRow[] }>(
      `/api/billing/statements?id=${statementId}&pageSize=1`,
    )
      .then((res) => {
        if (cancelled) return
        const found = res.items?.[0]
        if (!found) setError(t('billing.statements.detail.not_found', 'Statement not found'))
        else setRow(found)
      })
      .catch(() => {
        if (!cancelled)
          setError(t('billing.statements.detail.load_error', 'Failed to load statement'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statementId, t])

  const breakdown = row?.debit_breakdown?.items ?? []
  const columns = React.useMemo<ColumnDef<BreakdownEntry>[]>(
    () => [
      {
        accessorKey: 'billing_type',
        header: t('billing.statements.breakdown.type', 'Type'),
        cell: ({ row }) => <Tag variant="info">{row.original.billing_type}</Tag>,
      },
      {
        accessorKey: 'billing_item_id',
        header: t('billing.statements.breakdown.item', 'Item'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.billing_item_id}</span>,
      },
      {
        accessorKey: 'quantity',
        header: t('billing.statements.breakdown.quantity', 'Qty'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.quantity}</span>,
      },
      {
        accessorKey: 'amount',
        header: t('billing.statements.breakdown.amount', 'Amount'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.amount}</span>,
      },
    ],
    [t],
  )

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
          <LoadingMessage label={t('billing.statements.detail.loading', 'Loading statement…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <FormHeader
        mode="detail"
        backHref="/backend/billing/statements"
        entityTypeLabel={t('billing.statements.detail.title', 'Statement')}
        title={`${formatDate(row.period_start)} – ${formatDate(row.period_end)}`}
        statusBadge={
          <Tag variant={statementStatusVariant(row.status)}>
            {t(`billing.statements.status.${row.status}`, row.status)}
          </Tag>
        }
        actionsContent={
          <Button asChild variant="outline">
            <Link href={`/backend/billing/accounts/${row.bill_account_id}`}>
              {t('billing.statements.detail.view_account', 'View account')}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <DetailCard>
          <DetailField label={t('billing.statements.columns.opening', 'Opening')}>
            <span className="font-mono tabular-nums">{row.opening_balance}</span>
          </DetailField>
          <DetailField label={t('billing.statements.columns.topups', 'Top-ups')}>
            <span className="font-mono tabular-nums">{row.total_topups}</span>
          </DetailField>
          <DetailField label={t('billing.statements.columns.usage', 'Usage')}>
            <span className="font-mono tabular-nums">{row.total_usage}</span>
          </DetailField>
          <DetailField label={t('billing.statements.columns.recurring', 'Recurring')}>
            <span className="font-mono tabular-nums">{row.total_recurring}</span>
          </DetailField>
          <DetailField label={t('billing.statements.columns.closing', 'Closing')}>
            <span className="font-mono tabular-nums">
              {row.closing_balance} {row.currency_code}
            </span>
          </DetailField>
          <DetailField label={t('billing.statements.detail.bill_run', 'Bill Run')}>
            {row.bill_run_id ? (
              <Link
                href={`/backend/billing/runs/${row.bill_run_id}`}
                className="font-mono text-xs hover:underline"
              >
                {row.bill_run_id}
              </Link>
            ) : (
              '—'
            )}
          </DetailField>
        </DetailCard>
        <div className="mt-6">
          <DataTable
            title={t('billing.statements.detail.breakdown', 'Period-close charges')}
            columns={columns}
            data={breakdown}
            emptyState={
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                {t('billing.statements.detail.no_charges', 'No recurring charges this period.')}
              </div>
            }
          />
        </div>
      </PageBody>
    </Page>
  )
}
