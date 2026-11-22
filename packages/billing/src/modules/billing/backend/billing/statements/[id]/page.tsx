"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatBillingDay } from '../../../../lib/displayDate'
import { addDays } from '../../../../lib/billPeriod'
import { toIsoDate } from '../../../../lib/dateOnly'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { BillingDataTable as DataTable } from '../../../../components/BillingDataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { DetailCard, DetailField } from '../../../../components/DetailFields'
import { statementStatusVariant } from '../page'

type BreakdownEntry = {
  billing_item_id: string
  billing_type: string
  uom_code?: string
  quantity: string
  /** What left the balance. */
  amount: string
  // Spec F — older statements do not carry these.
  description?: string
  net?: string
  tax?: string
  tax_rate?: string
  service_period_start?: string | null
  service_period_end?: string | null
}

type VatSummaryEntry = { rate: string; net: string; tax: string; gross: string }

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
  total_adjustments: string
  closing_balance: string
  /** `bill_date` — when the charges were taken (statements before Spec F lack it). */
  debit_breakdown: { items?: BreakdownEntry[]; bill_date?: string } | null
  vat_summary?: VatSummaryEntry[] | null
  status: string
}

export default function BillingStatementDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
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
  // Charges are taken AT the bill date = the day after the period end (#138).
  const billDate = row ? (row.debit_breakdown?.bill_date ?? toIsoDate(addDays(row.period_end, 1))) : null
  const vatSummary = row?.vat_summary ?? []
  // Spec F: VAT columns only when VAT was charged at consumption.
  const showVat = vatSummary.length > 0
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
        cell: ({ row }) => (
          <Link href={`/backend/billing/items/${row.original.billing_item_id}`} className="text-sm text-primary hover:underline">
            {row.original.description ?? row.original.billing_item_id}
          </Link>
        ),
      },
      {
        accessorKey: 'service_period_start',
        header: t('billing.statements.breakdown.service_period', 'Service period'),
        cell: ({ row }) =>
          row.original.service_period_start
            ? `${row.original.service_period_start} – ${row.original.service_period_end ?? '…'}`
            : '—',
      },
      {
        accessorKey: 'quantity',
        header: t('billing.statements.breakdown.quantity', 'Qty'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.quantity}</span>,
      },
      ...(showVat
        ? [
            {
              accessorKey: 'net',
              header: t('billing.statements.breakdown.net', 'Net'),
              cell: ({ row }: { row: { original: BreakdownEntry } }) => (
                <span className="font-mono tabular-nums">{row.original.net ?? '—'}</span>
              ),
            } satisfies ColumnDef<BreakdownEntry>,
            {
              accessorKey: 'tax',
              header: t('billing.statements.breakdown.vat', 'VAT'),
              cell: ({ row }: { row: { original: BreakdownEntry } }) =>
                row.original.tax !== undefined ? (
                  <span className="font-mono tabular-nums">
                    {row.original.tax} ({row.original.tax_rate ?? '0'} %)
                  </span>
                ) : (
                  '—'
                ),
            } satisfies ColumnDef<BreakdownEntry>,
          ]
        : []),
      {
        accessorKey: 'amount',
        header: t('billing.statements.breakdown.charged', 'Charged to balance'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.amount}</span>,
      },
    ],
    [showVat, t],
  )
  const vatColumns = React.useMemo<ColumnDef<VatSummaryEntry>[]>(
    () => [
      { accessorKey: 'rate', header: t('billing.statements.vat.rate', 'VAT rate'), cell: ({ row }) => `${row.original.rate} %` },
      {
        accessorKey: 'net',
        header: t('billing.statements.breakdown.net', 'Net'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.net}</span>,
      },
      {
        accessorKey: 'tax',
        header: t('billing.statements.breakdown.vat', 'VAT'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.tax}</span>,
      },
      {
        accessorKey: 'gross',
        header: t('billing.statements.vat.gross', 'Gross'),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.gross}</span>,
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
        title={`${formatBillingDay(row.period_start, locale)} – ${formatBillingDay(row.period_end, locale)}`}
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
          <DetailField label={t('billing.statements.columns.charges_on_bill_date', 'Charges (taken on bill date)')}>
            <span className="font-mono tabular-nums">{row.total_recurring}</span>
          </DetailField>
          <DetailField label={t('billing.statements.columns.adjustments', 'Adjustments')}>
            <span className="font-mono tabular-nums">{row.total_adjustments}</span>
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
          {billDate ? (
            <p className="mb-2 text-sm text-muted-foreground">
              {t(
                'billing.statements.detail.charges_hint',
                'Charges are taken on the bill date ({date}). In-advance items cover the service period shown on each line, which starts on that date — the period after this statement.',
                { date: formatBillingDay(billDate, locale) },
              )}
            </p>
          ) : null}
          <DataTable
            title={t('billing.statements.detail.breakdown', 'Period-close charges')}
            columns={columns}
            data={breakdown}
            pagination={{ page: 1, pageSize: 100, total: breakdown.length, totalPages: 1, onPageChange: () => undefined }}
            emptyState={
              <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                {t('billing.statements.detail.no_charges', 'No charges at this bill date.')}
              </div>
            }
          />
        </div>
        {showVat ? (
          <div className="mt-6">
            <DataTable
              title={t('billing.statements.detail.vat_summary', 'VAT summary')}
              columns={vatColumns}
              data={vatSummary}
              pagination={{ page: 1, pageSize: 100, total: vatSummary.length, totalPages: 1, onPageChange: () => undefined }}
            />
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
