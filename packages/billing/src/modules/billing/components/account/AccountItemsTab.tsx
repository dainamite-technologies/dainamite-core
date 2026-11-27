"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BillingDataTable as DataTable } from '../BillingDataTable'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Pause, X } from 'lucide-react'
import { ItemPhaseTag, ItemStatusTag, ownPeriodText } from '../ItemLineLabels'
import { ItemStatusDialog, type BulkStatusResult } from '../ItemStatusDialog'
import type { PhaseRow, StatusPeriodRow } from '../../lib/itemStatusLabel'
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
  billing_period_unit?: string | null
  billing_period_interval?: number | null
  phases_enabled?: boolean
  phases?: PhaseRow[]
  statusPeriods?: StatusPeriodRow[]
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
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = React.useState<AccountItemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const pageSize = 25
  const today = React.useMemo(() => localTodayIso(), [])
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [bulkResult, setBulkResult] = React.useState<BulkStatusResult | null>(null)

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
      const base =
        row.charge_timing === 'in_arrears'
          ? t('billing.accounts.items.recurring_arrears', 'Recurring · in arrears')
          : t('billing.accounts.items.recurring_advance', 'Recurring · in advance')
      // Own-period lines (L §4.2): "Recurring · in advance · every 1 year".
      return row.billing_period_unit ? `${base} · ${ownPeriodText(t, row.billing_period_unit, row.billing_period_interval)}` : base
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
      const date = state.date ? formatDate(state.date, locale) : ''
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
    [t, locale],
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
          `${formatDate(row.original.bill_start_date, locale)} – ${
            row.original.bill_end_date ? formatDate(row.original.bill_end_date, locale) : t('billing.accounts.items.open_ended', 'open-ended')
          }`,
      },
      {
        accessorKey: 'billed_to_date',
        header: t('billing.accounts.items.billed_through', 'Billed through'),
        cell: ({ row }) =>
          row.original.type === 'recurring' && row.original.billed_to_date ? formatDate(row.original.billed_to_date, locale) : '—',
      },
      {
        id: 'billing_state',
        header: t('billing.accounts.items.state', 'Billing'),
        cell: ({ row }) => {
          const state = itemBillingState(row.original, today)
          return (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Tag variant={stateVariant(state)}>{stateLabel(state)}</Tag>
              {row.original.type === 'recurring' ? (
                <>
                  <ItemStatusTag periods={row.original.statusPeriods} today={today} />
                  <ItemPhaseTag phases={row.original.phases} phasesEnabled={row.original.phases_enabled} today={today} />
                </>
              ) : null}
            </span>
          )
        },
      },
    ],
    [rateLabel, stateLabel, t, today, typeLabel, locale],
  )

  const skippedSummary = React.useMemo(() => {
    if (!bulkResult || bulkResult.skipped.length === 0) return null
    const count = (reason: 'read_only' | 'overlap' | 'ended') => bulkResult.skipped.filter((s) => s.reason === reason).length
    const names = bulkResult.skipped.map((s) => rows.find((r) => r.id === s.billingItemId)?.description ?? s.billingItemId)
    const parts = [
      count('read_only') ? t('billing.accounts.items.bulk_status.skipped_read_only', '{count} CPQ lines (status comes from CPQ)', { count: count('read_only') }) : null,
      count('overlap') ? t('billing.accounts.items.bulk_status.skipped_overlap', '{count} already have a status in that period', { count: count('overlap') }) : null,
      count('ended') ? t('billing.accounts.items.bulk_status.skipped_ended', '{count} ended before the start date', { count: count('ended') }) : null,
    ].filter((part): part is string => Boolean(part))
    return { total: bulkResult.skipped.length, parts, names }
  }, [bulkResult, rows, t])

  return (
    <>
      {skippedSummary ? (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text">
          <div>
            <div className="font-medium">
              {t('billing.accounts.items.bulk_status.skipped_title', '{count} lines were skipped', { count: skippedSummary.total })}
            </div>
            <div>{skippedSummary.parts.join(' · ')}</div>
            <div className="text-xs">{skippedSummary.names.join(', ')}</div>
          </div>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('billing.common.close', 'Close')}
            onClick={() => setBulkResult(null)}
          >
            <X />
          </IconButton>
        </div>
      ) : null}
      <DataTable
        title={t('billing.accounts.detail.items.title', 'Items')}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <Pause size={14} />
            {t('billing.accounts.items.bulk_status.action', 'Pause / suspend all lines')}
          </Button>
        }
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
      <ItemStatusDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        target={{ kind: 'account', accountId }}
        status="paused"
        onSaved={(result) => {
          setBulkResult(result ?? null)
          void load()
        }}
      />
    </>
  )
}
