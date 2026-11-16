"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { CpqInteractionStyles } from '../../../components/CpqListView'
import { useGrantedFeatures } from '../../../components/useGrantedFeatures'
import { COST_INDEX_WRITE_FEATURES } from '../../../data/cost-indices'
import {
  COST_PLUS_OFF_FALLBACK,
  classifyIndexError,
  formatCurrentValue,
  type CostIndexListRow,
} from '../../../lib/costIndexView'
import { CreateIndexDialog } from './_components/CreateIndexDialog'

const PAGE_SIZE = 50

type ListResponse = { items?: CostIndexListRow[]; total?: number; totalPages?: number }

/** Server-side paged list state; search and the Active filter go to the API. */
function useCostIndexList() {
  const t = useT()
  const [rows, setRows] = React.useState<CostIndexListRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [search, setSearchState] = React.useState('')
  const [filterValues, setFilterValuesState] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [toggleOff, setToggleOff] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (search.trim()) params.set('search', search.trim())
    if (filterValues.isActive === true) params.set('isActive', 'true')
    return params.toString()
  }, [filterValues, page, search])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      setIsLoading(true)
      const call = await apiCall<ListResponse>(`/api/cpq/cost-indices?${queryString}`)
      if (cancelled) return
      if (call.ok && call.result) {
        const items = Array.isArray(call.result.items) ? call.result.items : []
        setToggleOff(false)
        setRows(items)
        setTotal(typeof call.result.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result.totalPages === 'number' ? Math.max(1, call.result.totalPages) : 1)
      } else if (classifyIndexError(call.status, call.result).toggleOff) {
        setToggleOff(true)
        setRows([])
      } else {
        flash(t('cpq.costIndices.error.load', 'Failed to load cost indices'), 'error')
      }
      setIsLoading(false)
    })()
    return () => { cancelled = true }
  }, [queryString, reloadToken, t])

  return {
    rows, total, totalPages, page, search, filterValues, isLoading, toggleOff, setPage,
    setSearch: (value: string) => { setSearchState(value); setPage(1) },
    setFilterValues: (values: FilterValues) => { setFilterValuesState(values); setPage(1) },
    clearFilters: () => { setFilterValuesState({}); setPage(1) },
    reload: () => setReloadToken((token) => token + 1),
  }
}

export default function CpqCostIndicesPage() {
  const t = useT()
  const router = useRouter()
  const list = useCostIndexList()
  const granted = useGrantedFeatures(COST_INDEX_WRITE_FEATURES)
  const canWrite = COST_INDEX_WRITE_FEATURES.every((feature) => granted.includes(feature))
  const [creating, setCreating] = React.useState(false)

  const filters = React.useMemo<FilterDef[]>(
    () => [{ id: 'isActive', label: t('cpq.costIndices.filters.isActive', 'Active'), type: 'checkbox' }],
    [t],
  )

  const columns = React.useMemo<ColumnDef<CostIndexListRow>[]>(() => [
    { id: 'code', header: t('cpq.costIndices.fields.code', 'Code'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    { id: 'name', header: t('cpq.costIndices.fields.name', 'Name'), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: 'unit', header: t('cpq.costIndices.fields.unit', 'Unit'), cell: ({ row }) => <span className="text-sm">{row.original.unit}</span> },
    { id: 'currency', header: t('cpq.costIndices.fields.currency', 'Currency'), cell: ({ row }) => <span className="text-sm">{row.original.currencyCode}</span> },
    {
      id: 'current',
      header: t('cpq.costIndices.fields.currentValue', 'Current value'),
      cell: ({ row }) => {
        const label = formatCurrentValue(row.original.current)
        return label
          ? <span className="text-sm" data-testid="cpq-cost-index-current">{label}</span>
          : <span className="text-sm text-muted-foreground" data-testid="cpq-cost-index-current">{t('cpq.costIndices.noValueYet', 'No value yet')}</span>
      },
    },
    { id: 'elements', header: t('cpq.costIndices.fields.elements', 'Elements'), cell: ({ row }) => <span className="text-sm">{row.original.elementCount}</span> },
    {
      id: 'isActive',
      header: t('cpq.costIndices.fields.active', 'Active'),
      cell: ({ row }) => (
        <Tag variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {row.original.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
        </Tag>
      ),
    },
  ], [t])

  const defaultView = !list.search.trim() && Object.keys(list.filterValues).every((key) => !list.filterValues[key])
  const emptyState = (
    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="cpq-cost-indices-empty">
      {defaultView
        ? t('cpq.costIndices.empty', 'No cost indices. Create one for costs that follow a market price.')
        : t('cpq.costIndices.emptyFiltered', 'No cost indices match the filters.')}
    </div>
  )

  return (
    <Page>
      <PageBody className="cpq-list-view space-y-6">
        <CpqInteractionStyles />
        {list.toggleOff ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="cpq-cost-indices-toggle-off">
            {t('cpq.costIndices.toggleOff', COST_PLUS_OFF_FALLBACK)}
          </div>
        ) : (
          <DataTable<CostIndexListRow>
            title={t('cpq.costIndices.list.title', 'Cost indices')}
            refreshButton={{ label: t('cpq.list.actions.refresh', 'Refresh'), onRefresh: list.reload, isRefreshing: list.isLoading }}
            actions={canWrite ? (
              <Button onClick={() => setCreating(true)} data-testid="cpq-cost-index-create">{t('cpq.costIndices.create.action', 'Create index')}</Button>
            ) : undefined}
            columns={columns}
            data={list.rows}
            searchValue={list.search}
            onSearchChange={list.setSearch}
            searchPlaceholder={t('cpq.costIndices.search.placeholder', 'Search by code or name...')}
            filters={filters}
            filterValues={list.filterValues}
            onFiltersApply={list.setFilterValues}
            onFiltersClear={list.clearFilters}
            onRowClick={(row) => router.push(`/backend/cpq/cost-indices/${row.id}`)}
            injectionSpotId="data-table:cpq.cost_indices"
            perspective={{ tableId: 'cpq.cost_indices.list' }}
            pagination={{ page: list.page, pageSize: PAGE_SIZE, total: list.total, totalPages: list.totalPages, onPageChange: list.setPage }}
            isLoading={list.isLoading}
            emptyState={emptyState}
          />
        )}
        {creating && (
          <CreateIndexDialog
            onClose={() => setCreating(false)}
            onCreated={(item) => {
              setCreating(false)
              flash(t('cpq.costIndices.flash.created', 'Cost index created'), 'success')
              router.push(`/backend/cpq/cost-indices/${item.id}`)
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
