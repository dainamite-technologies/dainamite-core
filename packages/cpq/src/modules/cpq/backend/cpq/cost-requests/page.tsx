"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { CpqInteractionStyles } from '../../../components/CpqListView'
import {
  ANSWER_OUTCOME_FALLBACKS,
  CANCEL_REASON_FALLBACKS,
  COST_REQUEST_STATUS_OPTIONS,
  COST_REQUEST_STATUS_OPTION_FALLBACKS,
  SOURCING_STATUS_FALLBACKS,
  SOURCING_STATUS_VARIANTS,
  buildCostRequestParams,
  queueRowActions,
  sourcingErrorFallback,
  type CostRequestDetail,
  type CostRequestRow,
  type SourcingFailure,
} from '../../../lib/costSourcingView'
import { isCostLocked, COST_STATUS_FALLBACKS } from '../../../lib/quoteCostView'
import { AnswerCostDialog } from './_components/AnswerCostDialog'
import { DeclineCostDialog } from './_components/DeclineCostDialog'
import { CostRequestDetailPanel } from './_components/CostRequestDetailPanel'
import type { SourcingTarget } from './_components/sourcingDialogShared'

const PAGE_SIZE = 25

/** A table row: the API item plus the synthetic id the table needs, or the lazy detail sub-row of an expanded one. */
type Row = CostRequestRow & { id: string; isDetail?: boolean }
type ListResponse = { items?: CostRequestRow[]; total?: number; totalPages?: number; overdueThresholdWorkingDays?: number }
type DialogState = { kind: 'answer' | 'decline'; target: SourcingTarget }

const toRow = (item: CostRequestRow): Row => ({ ...item, id: item.costId })
const detailRowOf = (row: Row): Row => ({ ...row, id: `${row.costId}:detail`, isDetail: true })
const getSubRows = (row: Row): Row[] | undefined => (row.isDetail ? undefined : [detailRowOf(row)])

/** Server-side paged queue state; the filter values map to the query through `buildCostRequestParams`. */
function useCostRequestList() {
  const t = useT()
  const [rows, setRows] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [threshold, setThreshold] = React.useState<number | null>(null)
  const [page, setPage] = React.useState(1)
  const [search, setSearchState] = React.useState('')
  const [filterValues, setFilterValuesState] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    buildCostRequestParams(filterValues, params)
    return params.toString()
  }, [filterValues, page, search])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      setIsLoading(true)
      const call = await apiCall<ListResponse>(`/api/cpq/cost-requests?${queryString}`)
      if (cancelled) return
      if (call.ok && call.result) {
        const items = Array.isArray(call.result.items) ? call.result.items : []
        setRows(items.map(toRow))
        setTotal(typeof call.result.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result.totalPages === 'number' ? Math.max(1, call.result.totalPages) : 1)
        if (typeof call.result.overdueThresholdWorkingDays === 'number') setThreshold(call.result.overdueThresholdWorkingDays)
      } else {
        flash(t('cpq.costRequests.error.load', 'Failed to load cost requests'), 'error')
      }
      setIsLoading(false)
    })()
    return () => { cancelled = true }
  }, [queryString, reloadToken, t])

  return {
    rows, total, totalPages, threshold, page, search, filterValues, isLoading,
    setPage,
    setSearch: (value: string) => { setSearchState(value); setPage(1) },
    setFilterValues: (values: FilterValues) => { setFilterValuesState(values); setPage(1) },
    clearFilters: () => { setFilterValuesState({}); setPage(1) },
    reload: () => setReloadToken((token) => token + 1),
  }
}

async function loadCompanyOptions(query?: string) {
  const params = new URLSearchParams({ page: '1', pageSize: '20' })
  if (query) params.set('search', query)
  const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(`/api/customers/companies?${params}`)
  const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
  return items.map((company) => ({ value: String(company.id), label: String(company.display_name ?? company.displayName ?? company.name ?? company.id) }))
}

/** Estimate currency of the request, else the quote currency (spec §UI/UX Answer dialog). Empty when neither is known. */
async function resolveAnswerCurrency(row: CostRequestRow): Promise<string> {
  const detail = await apiCall<CostRequestDetail>(`/api/cpq/cost-requests/${row.costId}`)
  if (detail.ok && detail.result?.current.currencyCode) return detail.result.current.currencyCode
  const quote = await apiCall<{ currencyCode?: string }>(`/api/cpq/quotes/${row.quoteConfigurationId}`)
  return quote.ok && quote.result?.currencyCode ? quote.result.currencyCode : ''
}

export default function CpqCostRequestsPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const list = useCostRequestList()
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const { setFilterValues } = list

  // Notification links open the page with ?quoteId=...; apply it once as the quote filter.
  const initialQuoteId = searchParams?.get('quoteId') ?? ''
  React.useEffect(() => {
    if (initialQuoteId) setFilterValues({ quoteId: initialQuoteId })
  }, [initialQuoteId, setFilterValues])

  const openDialog = React.useCallback(async (kind: DialogState['kind'], row: Row) => {
    if (!row.costRequestId) return
    const defaultCurrency = kind === 'answer' ? await resolveAnswerCurrency(row) : ''
    setDialog({
      kind,
      target: {
        quoteId: row.quoteConfigurationId, costId: row.costId, costRequestId: row.costRequestId, requestSeq: row.requestSeq,
        costName: row.costName, contextLabel: [row.quoteNumber, row.productName].filter(Boolean).join(' · ') || null,
        cpqStatus: row.cpqStatus, locked: isCostLocked(row.cpqStatus, row.orderId), defaultCurrency,
        supplierId: row.requestSupplierId, supplierName: row.requestSupplierName,
      },
    })
  }, [])

  const onDone = (outcome?: string) => {
    setDialog(null)
    flash(t(`cpq.costRequests.outcomes.${outcome ?? 'applied'}`, ANSWER_OUTCOME_FALLBACKS[outcome ?? 'applied'] ?? ANSWER_OUTCOME_FALLBACKS.applied), 'success')
    list.reload()
  }
  const onFailure = (failure: SourcingFailure) => {
    setDialog(null)
    flash(t(`cpq.costRequests.errors.${failure.code}`, sourcingErrorFallback(failure.code)), 'error')
    list.reload()
  }

  const statusOptions = React.useMemo(
    () => COST_REQUEST_STATUS_OPTIONS.map((value) => ({
      value, label: t(`cpq.costRequests.statusFilter.${value}`, COST_REQUEST_STATUS_OPTION_FALLBACKS[value]),
    })),
    [t],
  )
  const filters = React.useMemo<FilterDef[]>(() => [
    { id: 'status', label: t('cpq.costRequests.filters.status', 'Status'), type: 'select', options: statusOptions },
    {
      id: 'cancelReason', label: t('cpq.costRequests.filters.cancelReason', 'Cancel reason'), type: 'select',
      options: Object.entries(CANCEL_REASON_FALLBACKS).map(([value, label]) => ({ value, label: t(`cpq.costRequests.cancelReasons.${value}`, label) })),
    },
    { id: 'supplierId', label: t('cpq.costRequests.filters.supplier', 'Supplier'), type: 'combobox', loadOptions: loadCompanyOptions },
    {
      id: 'overdue',
      label: t('cpq.costRequests.filters.overdue', 'Overdue only'),
      tooltip: list.threshold === null ? undefined : t('cpq.costRequests.overdueHint', 'Older than {days} working days', { days: list.threshold }),
      type: 'checkbox',
    },
    { id: 'quoteId', label: t('cpq.costRequests.filters.quote', 'Quote id'), type: 'text' },
  ], [list.threshold, statusOptions, t])

  const cell = (render: (row: Row) => React.ReactNode) => ({ row }: { row: { original: Row } }) => (row.original.isDetail ? null : render(row.original))
  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      id: 'quote',
      header: t('cpq.costRequests.table.quote', 'Quote'),
      cell: ({ row }) => row.original.isDetail
        ? (
          // The detail sub-row has one cell per column; the panel overflows a zero-width wrapper so it spans the row.
          <div className="w-0" data-testid="cpq-cost-request-expansion">
            <div className="w-[min(64rem,85vw)] whitespace-normal"><CostRequestDetailPanel costId={row.original.costId} /></div>
          </div>
        )
        : (
          <Link href={`/backend/cpq/quotes/${row.original.quoteConfigurationId}`} className="text-sm font-medium text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
            {row.original.quoteNumber ?? `${row.original.quoteConfigurationId.slice(0, 8)}…`}
          </Link>
        ),
    },
    { id: 'customer', header: t('cpq.costRequests.table.customer', 'Customer'), cell: cell((row) => <span className="text-sm">{row.customerName ?? '—'}</span>) },
    { id: 'product', header: t('cpq.costRequests.table.product', 'Product'), cell: cell((row) => <span className="text-sm">{row.productName ?? '—'}</span>) },
    { id: 'cost', header: t('cpq.costRequests.table.cost', 'Cost'), cell: cell((row) => <span className="text-sm font-medium">{row.costName}</span>) },
    {
      id: 'keyAttributes',
      header: t('cpq.costRequests.table.keyAttributes', 'Key attributes'),
      cell: cell((row) => (
        <span className="text-xs text-muted-foreground">
          {Object.entries(row.keyAttributes).map(([key, value]) => `${key}: ${value ?? '—'}`).join(' · ') || '—'}
        </span>
      )),
    },
    {
      id: 'requestedAt',
      header: t('cpq.costRequests.table.requestedAt', 'Requested'),
      cell: cell((row) => <span className="text-xs text-muted-foreground">{row.requestedAt ? new Date(row.requestedAt).toLocaleDateString() : '—'}</span>),
    },
    {
      id: 'age',
      header: t('cpq.costRequests.table.age', 'Age (working days)'),
      cell: cell((row) => (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.ageWorkingDays ?? '—'}
          {row.overdue && <Tag variant="error" dot className="px-1.5 text-xs" data-testid="cpq-cost-request-overdue">{t('cpq.costRequests.overdue', 'Overdue')}</Tag>}
        </span>
      )),
    },
    { id: 'supplier', header: t('cpq.costRequests.table.supplier', 'Supplier'), cell: cell((row) => <span className="text-sm">{row.requestSupplierName ?? '—'}</span>) },
    {
      id: 'sourcingStatus',
      header: t('cpq.costRequests.table.sourcingStatus', 'Request'),
      cell: cell((row) => (
        <span className="inline-flex flex-col gap-0.5">
          <Tag variant={SOURCING_STATUS_VARIANTS[row.sourcingStatus] ?? 'neutral'} dot className="px-1.5 text-xs">
            {t(`cpq.costRequests.status.${row.sourcingStatus}`, SOURCING_STATUS_FALLBACKS[row.sourcingStatus] ?? row.sourcingStatus)}
          </Tag>
          {row.cancelReason && (
            <span className="text-xs text-muted-foreground">
              {t(`cpq.costRequests.cancelReasons.${row.cancelReason}`, CANCEL_REASON_FALLBACKS[row.cancelReason] ?? row.cancelReason)}
            </span>
          )}
          {row.cancelReason === 'quote_closed' && row.orderId && (
            <Link href={`/backend/cpq/orders/${row.orderId}`} className="text-xs text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
              {t('cpq.costRequests.openOrder', 'Open order')}
            </Link>
          )}
        </span>
      )),
    },
    {
      id: 'valueStatus',
      header: t('cpq.costRequests.table.valueStatus', 'Cost status'),
      cell: cell((row) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="text-xs">{t(`cpq.quoteCosts.statuses.${row.valueStatus}`, COST_STATUS_FALLBACKS[row.valueStatus] ?? row.valueStatus)}</span>
          {row.hasAnswerPending && (
            <Tag variant="warning" dot className="px-1.5 text-xs" data-testid="cpq-cost-request-answer-pending">{t('cpq.costRequests.answerPending', 'Answer pending')}</Tag>
          )}
        </span>
      )),
    },
  ], [t])

  const rowActions = (row: Row) => {
    if (row.isDetail) return null
    const items: RowActionItem[] = []
    for (const action of queueRowActions(row)) {
      items.push(action === 'answer'
        ? { id: 'answer', label: t('cpq.costRequests.actions.answer', 'Answer'), onSelect: () => void openDialog('answer', row) }
        : { id: 'decline', label: t('cpq.costRequests.actions.decline', 'Decline'), onSelect: () => void openDialog('decline', row) })
    }
    items.push({ id: 'open', label: t('cpq.costRequests.actions.openQuote', 'Open quote'), href: `/backend/cpq/quotes/${row.quoteConfigurationId}` })
    return <RowActions items={items} />
  }

  const defaultView = !list.search.trim() && Object.keys(list.filterValues).every((key) => !list.filterValues[key])
  const emptyState = (
    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="cpq-cost-requests-empty">
      {defaultView
        ? (
          <>
            <p>{t('cpq.costRequests.empty', 'No open cost requests. Requests appear here when a quote needs a supplier price.')}</p>
            <Link href="/backend/cpq/quotes" className="mt-2 inline-block text-primary hover:underline">{t('cpq.costRequests.emptyLink', 'Go to quotes')}</Link>
          </>
        )
        : <p>{t('cpq.costRequests.emptyFiltered', 'No cost requests match the filters.')}</p>}
    </div>
  )

  return (
    <Page>
      <PageBody className="cpq-list-view space-y-6">
        <CpqInteractionStyles />
        {list.threshold !== null && (
          <p className="text-xs text-muted-foreground" data-testid="cpq-cost-requests-threshold">
            {t('cpq.costRequests.thresholdHint', 'A request is overdue when it is older than {days} working days.', { days: list.threshold })}
          </p>
        )}
        <DataTable<Row>
          title={t('cpq.costRequests.title', 'Cost requests')}
          refreshButton={{ label: t('cpq.list.actions.refresh', 'Refresh'), onRefresh: list.reload, isRefreshing: list.isLoading }}
          columns={columns}
          data={list.rows}
          searchValue={list.search}
          onSearchChange={list.setSearch}
          searchPlaceholder={t('cpq.costRequests.search.placeholder', 'Search by quote, customer or cost...')}
          filters={filters}
          filterValues={list.filterValues}
          onFiltersApply={list.setFilterValues}
          onFiltersClear={list.clearFilters}
          rowActions={rowActions}
          getSubRows={getSubRows}
          injectionSpotId="data-table:cpq.cost_requests"
          perspective={{ tableId: 'cpq.cost_requests.list' }}
          pagination={{ page: list.page, pageSize: PAGE_SIZE, total: list.total, totalPages: list.totalPages, onPageChange: list.setPage }}
          isLoading={list.isLoading}
          emptyState={emptyState}
        />
        {dialog?.kind === 'answer' && <AnswerCostDialog target={dialog.target} onClose={() => setDialog(null)} onDone={onDone} onFailure={onFailure} />}
        {dialog?.kind === 'decline' && <DeclineCostDialog target={dialog.target} onClose={() => setDialog(null)} onDone={onDone} onFailure={onFailure} />}
      </PageBody>
    </Page>
  )
}
