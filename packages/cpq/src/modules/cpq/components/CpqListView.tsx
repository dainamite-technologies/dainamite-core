"use client"
import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// ─── Types ───────────────────────────────────────────────────────

type PaginatedResponse<T> = {
  items?: T[]
  total?: number
  totalPages?: number
}

export type CpqListData<T> = {
  rows: T[]
  total: number
  totalPages: number
  page: number
  isLoading: boolean
  search: string
  sorting: SortingState
  filterValues: FilterValues
  setPage: (page: number) => void
  setSearch: (value: string) => void
  setSorting: React.Dispatch<React.SetStateAction<SortingState>>
  setFilterValues: (values: FilterValues) => void
  clearFilters: () => void
  reload: () => void
  queryString: string
}

export type UseCpqListDataOptions = {
  /** API endpoint without query string, e.g. `/api/cpq/product-offerings` */
  endpoint: string
  /** Default 50 — keep at or below 100. */
  pageSize?: number
  /** Initial sort state. Default `[{ id: 'createdAt', desc: true }]`. */
  initialSorting?: SortingState
  /** Map filter values to URL params (only call set on the params arg). */
  buildFilterParams?: (values: FilterValues, params: URLSearchParams) => void
  /** Override the flash message shown when the load fails. */
  loadErrorMessage?: string
}

/**
 * Server-side paginated list state for CPQ list views.
 *
 * Designed for 100k+ records:
 *  - search / sort / filter all go to the server
 *  - default pageSize stays at or below 100
 *  - debouncing is handled by FilterBar's search input (1s)
 */
export function useCpqListData<T extends { id: string }>(
  options: UseCpqListDataOptions,
): CpqListData<T> {
  const {
    endpoint,
    pageSize = 50,
    initialSorting = [{ id: 'createdAt', desc: true }],
    buildFilterParams,
    loadErrorMessage,
  } = options
  const t = useT()

  const [rows, setRows] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPageState] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [search, setSearchState] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [filterValues, setFilterValuesState] = React.useState<FilterValues>({})

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    if (buildFilterParams) buildFilterParams(filterValues, params)
    return params.toString()
  }, [buildFilterParams, filterValues, page, pageSize, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: PaginatedResponse<T> = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<PaginatedResponse<T>>(
          `${endpoint}?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(loadErrorMessage ?? t('cpq.list.error.load', 'Failed to load'), 'error')
          return
        }
        const payload = call.result ?? fallback
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items)
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [endpoint, loadErrorMessage, queryString, reloadToken, t])

  const setSearch = React.useCallback((value: string) => {
    setSearchState(value)
    setPageState(1)
  }, [])

  const setFilterValues = React.useCallback((values: FilterValues) => {
    setFilterValuesState(values)
    setPageState(1)
  }, [])

  const clearFilters = React.useCallback(() => {
    setFilterValuesState({})
    setPageState(1)
  }, [])

  const reload = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return {
    rows,
    total,
    totalPages,
    page,
    isLoading,
    search,
    sorting,
    filterValues,
    setPage: setPageState,
    setSearch,
    setSorting,
    setFilterValues,
    clearFilters,
    reload,
    queryString,
  }
}

// ─── Component ───────────────────────────────────────────────────

export type CpqListViewProps<T extends { id: string }> = {
  /** Page + table title */
  title: React.ReactNode
  /** Stable id for perspectives (e.g. `cpq.offerings.list`) */
  tableId: string
  /** Stable id for DataTable's selection state (defaults to tableId) */
  selectionScopeKey?: string
  /** List state — typically built from `useCpqListData` in the parent */
  data: CpqListData<T>
  /** Table columns */
  columns: ColumnDef<T>[]
  /** Filter definitions for the FilterBar overlay */
  filters?: FilterDef[]
  /** Search input placeholder */
  searchPlaceholder?: string
  /** Header actions (e.g. Create button) */
  actions?: React.ReactNode
  /** Bulk actions toolbar shown when rows are selected */
  bulkActions?: BulkAction<T>[]
  /** Per-row action menu */
  rowActions?: (row: T) => React.ReactNode
  /** Click handler for whole row (typically navigates to detail) */
  onRowClick?: (row: T) => void
  /** Custom empty state */
  emptyState?: React.ReactNode
  /** Pagination size (must match `useCpqListData` pageSize) */
  pageSize?: number
  /**
   * Custom content rendered ABOVE the DataTable inside the same Page wrapper.
   * Use for inline forms, customer pickers, tab switchers, alerts.
   */
  toolbarContent?: React.ReactNode
  /**
   * Custom content rendered BELOW the DataTable (e.g. confirm dialog portals).
   */
  footerContent?: React.ReactNode
}

/**
 * Generic CPQ list view. Wraps DataTable + FilterBar + Page in the
 * Open Mercato standard, with stronger row-hover affordance so users
 * always know what's clickable.
 */
export function CpqListView<T extends { id: string }>({
  title,
  tableId,
  selectionScopeKey,
  data,
  columns,
  filters,
  searchPlaceholder,
  actions,
  bulkActions,
  rowActions,
  onRowClick,
  emptyState,
  pageSize = 50,
  toolbarContent,
  footerContent,
}: CpqListViewProps<T>) {
  const t = useT()
  return (
    <Page>
      <PageBody className="cpq-list-view space-y-6">
        <CpqInteractionStyles />
        {toolbarContent}
        <DataTable<T>
          title={title}
          actions={actions}
          refreshButton={{
            label: t('cpq.list.actions.refresh', 'Refresh'),
            onRefresh: data.reload,
            isRefreshing: data.isLoading,
          }}
          columns={columns}
          data={data.rows}
          searchValue={data.search}
          onSearchChange={data.setSearch}
          searchPlaceholder={searchPlaceholder ?? t('cpq.list.search.placeholder', 'Search...')}
          filters={filters}
          filterValues={data.filterValues}
          onFiltersApply={data.setFilterValues}
          onFiltersClear={data.clearFilters}
          sorting={data.sorting}
          onSortingChange={data.setSorting}
          bulkActions={bulkActions}
          selectionScopeKey={selectionScopeKey ?? tableId}
          onRowClick={onRowClick}
          rowActions={rowActions}
          perspective={{ tableId }}
          columnChooser={{ auto: true }}
          pagination={{
            page: data.page,
            pageSize,
            total: data.total,
            totalPages: data.totalPages,
            onPageChange: data.setPage,
          }}
          isLoading={data.isLoading}
          emptyState={emptyState}
        />
        {footerContent}
      </PageBody>
    </Page>
  )
}

// ─── Shared interaction styles ───────────────────────────────────

/**
 * Inline style block applied inside `.cpq-list-view` (and any `.cpq-page`)
 * wrappers. Strengthens the OM hover affordance so users can clearly tell
 * which row their mouse is on, and forces `cursor: pointer` on every
 * clickable element inside CPQ pages.
 *
 * Kept inline to avoid coupling the package to a global stylesheet.
 */
export function CpqInteractionStyles() {
  return (
    <style>{`
.cpq-list-view tbody tr.cursor-pointer,
.cpq-page tbody tr.cursor-pointer {
  cursor: pointer;
}
.cpq-list-view tbody tr.cursor-pointer:hover,
.cpq-page tbody tr.cursor-pointer:hover {
  background-color: rgba(0, 0, 0, 0.045);
}
.dark .cpq-list-view tbody tr.cursor-pointer:hover,
.dark .cpq-page tbody tr.cursor-pointer:hover {
  background-color: rgba(255, 255, 255, 0.06);
}
.cpq-list-view button:not(:disabled),
.cpq-list-view [role="button"]:not([aria-disabled="true"]),
.cpq-list-view a[href],
.cpq-list-view [data-clickable="true"],
.cpq-page button:not(:disabled),
.cpq-page [role="button"]:not([aria-disabled="true"]),
.cpq-page a[href],
.cpq-page [data-clickable="true"] {
  cursor: pointer;
}
/* Row actions \`⋯\` trigger: OM's hover:bg-accent is barely visible in
   the light theme. Make hover (and the open state) clearly distinct so
   users see what they're aiming at. */
.cpq-list-view [aria-haspopup="menu"]:hover,
.cpq-page [aria-haspopup="menu"]:hover,
.cpq-list-view [aria-haspopup="menu"][aria-expanded="true"],
.cpq-page [aria-haspopup="menu"][aria-expanded="true"] {
  background-color: rgba(0, 0, 0, 0.08);
}
.dark .cpq-list-view [aria-haspopup="menu"]:hover,
.dark .cpq-page [aria-haspopup="menu"]:hover,
.dark .cpq-list-view [aria-haspopup="menu"][aria-expanded="true"],
.dark .cpq-page [aria-haspopup="menu"][aria-expanded="true"] {
  background-color: rgba(255, 255, 255, 0.1);
}
/* Items inside the row-actions dropdown menu — strengthen hover so the
   item under the pointer is unmistakable. The menu portal renders at the
   document body, so we can't scope it to .cpq-list-view; targeting the
   role attribute is enough. */
[role="menu"] [role="menuitem"]:hover,
[role="menu"] [role="menuitem"]:focus-visible {
  background-color: rgba(0, 0, 0, 0.06);
}
.dark [role="menu"] [role="menuitem"]:hover,
.dark [role="menu"] [role="menuitem"]:focus-visible {
  background-color: rgba(255, 255, 255, 0.08);
}
`}</style>
  )
}
