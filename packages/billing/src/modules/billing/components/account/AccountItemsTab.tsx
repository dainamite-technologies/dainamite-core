"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BillingDataTable as DataTable } from '../BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { itemBillingState, type ItemBillingState } from '../../lib/itemBillingState'
import { localTodayIso } from '../../lib/dateOnly'
import { formatDate } from './accountRow'

// Snake_case projection of `GET /api/billing/items` (see its `fields`).
type AccountItemRow = {
  id: string
  description: string
  type: 'one_time' | 'recurring' | 'usage'
  bill_start_date: string
  bill_end_date: string | null
  billed_to_date: string | null
  rate_json: Record<string, unknown> | null
  charge_timing: 'in_advance' | 'in_arrears'
  price_basis?: 'net' | 'gross'
  uom_code: string | null
  is_active: boolean
}

function stateVariant(state: ItemBillingState): 'success' | 'warning' | 'neutral' | 'info' {
  switch (state.status) {
    case 'billed':
    case 'current':
    case 'fully_billed':
      return 'success'
    case 'awaiting_run':
    case 'due':
      return 'warning'
    case 'metered':
      return 'info'
    default:
      return 'neutral'
  }
}

/**
 * The account's billing items (workspace Items tab): what each item costs,
 * its term, how far it has been billed and — against today — whether a Bill
 * Run still has to charge it.
 */
export function AccountItemsTab({ accountId, currencyCode }: { accountId: string; currencyCode?: string }) {
  const t = useT()
  const router = useRouter()
  const [rows, setRows] = React.useState<AccountItemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const pageSize = 25
  const today = React.useMemo(() => localTodayIso(), [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await readApiResultOrThrow<{ items: AccountItemRow[]; total: number; totalPages: number }>(
        `/api/billing/items?billAccountId=${accountId}&page=${page}` + `&pageSize=${pageSize}&sortField=createdAt&sortDir=desc`,
      )
      setRows(result.items ?? [])
      setTotal(result.total ?? 0)
      setTotalPages(result.totalPages ?? 1)
    } finally {
      setLoading(false)
    }
  }, [accountId, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const typeLabel = React.useCallback(
    (row: AccountItemRow) => {
      if (row.type === 'one_time') return t('billing.items.form.type.one_time', 'One-time charge')
      if (row.type === 'usage') return t('billing.items.form.type.usage', 'Usage (metered)')
      return row.charge_timing === 'in_arrears'
        ? t('billing.accounts.items.recurring_arrears', 'Recurring · in arrears')
        : t('billing.accounts.items.recurring_advance', 'Recurring · in advance')
    },
    [t],
  )

  const rateLabel = React.useCallback(
    (row: AccountItemRow) => {
      const rate = row.rate_json ?? {}
      const amount = typeof rate.amount === 'number' ? rate.amount : typeof rate.unit_price === 'number' ? rate.unit_price : null
      if (amount === null) {
        return 'model' in rate ? `${t('billing.accounts.items.tiered', 'Tiered')} (${String(rate.model)})` : '—'
      }
      const perUnit = row.type === 'usage' && row.uom_code ? ` / ${row.uom_code}` : ''
      const basis = row.price_basis === 'gross' ? t('billing.items.price_basis.gross', 'Gross') : t('billing.items.price_basis.net', 'Net')
      return `${amount}${currencyCode ? ` ${currencyCode}` : ''}${perUnit} · ${basis}`
    },
    [currencyCode, t],
  )

  const stateLabel = React.useCallback(
    (state: ItemBillingState) => {
      const date = state.date ? formatDate(state.date) : ''
      switch (state.status) {
        case 'inactive':
          return t('billing.common.inactive', 'Inactive')
        case 'cancelled':
          return t('billing.accounts.items.state.cancelled', 'Cancelled before start')
        case 'metered':
          return t('billing.accounts.items.state.metered', 'Billed from usage')
        case 'scheduled':
          return `${t('billing.accounts.items.state.scheduled', 'Starts')} ${date}`
        case 'awaiting_run':
          return t('billing.accounts.items.state.awaiting_run', 'Not billed yet')
        case 'billed':
          return t('billing.accounts.items.state.billed', 'Billed')
        case 'current':
          return `${t('billing.accounts.items.state.current', 'Billed through')} ${date}`
        case 'due':
          return `${t('billing.accounts.items.state.due', 'Due since')} ${date}`
        case 'fully_billed':
          return t('billing.accounts.items.state.fully_billed', 'Fully billed')
      }
    },
    [t],
  )

  const columns = React.useMemo<ColumnDef<AccountItemRow>[]>(
    () => [
      {
        accessorKey: 'description',
        header: t('billing.items.columns.description', 'Description'),
        cell: ({ row }) => <span className="text-sm font-medium text-primary">{row.original.description}</span>,
      },
      {
        accessorKey: 'type',
        header: t('billing.items.columns.type', 'Type'),
        cell: ({ row }) => <span className="text-sm">{typeLabel(row.original)}</span>,
      },
      {
        accessorKey: 'rate_json',
        header: t('billing.items.form.rate.title', 'Rate'),
        cell: ({ row }) => <span className="text-sm tabular-nums">{rateLabel(row.original)}</span>,
      },
      {
        accessorKey: 'bill_start_date',
        header: t('billing.accounts.items.term', 'Term'),
        cell: ({ row }) =>
          `${formatDate(row.original.bill_start_date)} – ${
            row.original.bill_end_date ? formatDate(row.original.bill_end_date) : t('billing.accounts.items.open_ended', 'open-ended')
          }`,
      },
      {
        accessorKey: 'billed_to_date',
        header: t('billing.accounts.items.billed_through', 'Billed through'),
        cell: ({ row }) =>
          row.original.type === 'recurring' && row.original.billed_to_date ? formatDate(row.original.billed_to_date) : '—',
      },
      {
        id: 'billing_state',
        header: t('billing.accounts.items.state', 'Billing'),
        cell: ({ row }) => {
          const state = itemBillingState(row.original, today)
          return <Tag variant={stateVariant(state)}>{stateLabel(state)}</Tag>
        },
      },
    ],
    [rateLabel, stateLabel, t, today, typeLabel],
  )

  return (
    <DataTable
      title={t('billing.accounts.detail.items.title', 'Items')}
      columns={columns}
      data={rows}
      isLoading={loading}
      onRowClick={(row) => router.push(`/backend/billing/items/${row.id}`)}
      pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('billing.accounts.detail.items.empty', 'No items for this account yet.')}
        </div>
      }
    />
  )
}
