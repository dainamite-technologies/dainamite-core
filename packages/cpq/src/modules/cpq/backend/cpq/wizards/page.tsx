"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui/backend/RowActions'

type WizardDefinition = {
  id: string
  code: string
  name: string
  description: string | null
  version: number
  surface: string
  isActive: boolean
  steps: Array<{ stepId: string; type: string; title: string }>
  createdAt: string
}

type WizardsResponse = {
  items?: WizardDefinition[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 50

export default function CpqWizardsPage() {
  const router = useRouter()
  const t = useT()

  const [rows, setRows] = React.useState<WizardDefinition[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'surface',
        label: t('cpq.wizards.filters.surface', 'Surface'),
        type: 'text',
      },
      {
        id: 'isActive',
        label: t('cpq.wizards.filters.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t],
  )

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    if (typeof filterValues.surface === 'string' && filterValues.surface.trim()) {
      params.set('surface', filterValues.surface.trim())
    }
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: WizardsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<WizardsResponse>(
          `/api/cpq/wizards?${queryString}`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (!call.ok) {
          flash(t('cpq.wizards.list.error.load', 'Failed to load wizards'), 'error')
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
  }, [queryString, reloadToken, t])

  const handleStartWizard = React.useCallback(
    (definitionCode: string) => {
      router.push(`/backend/cpq/wizards/${definitionCode}`)
    },
    [router],
  )

  const columns = React.useMemo<ColumnDef<WizardDefinition>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('cpq.wizards.table.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'code',
        header: t('cpq.wizards.table.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: 'surface',
        header: t('cpq.wizards.table.surface', 'Surface'),
      },
      {
        id: 'steps',
        header: t('cpq.wizards.table.steps', 'Steps'),
        cell: ({ row }) => <span>{row.original.steps.length}</span>,
      },
      {
        id: 'version',
        header: t('cpq.wizards.table.version', 'Version'),
        cell: ({ row }) => <span>v{row.original.version}</span>,
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.wizards.table.active', 'Active'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.original.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {row.original.isActive ? 'Yes' : 'No'}
          </span>
        ),
      },
    ],
    [t],
  )

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return (
    <Page>
      <PageBody className="space-y-6">
        <DataTable<WizardDefinition>
          title={t('cpq.wizards.list.title', 'Wizards')}
          refreshButton={{
            label: t('cpq.wizards.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('cpq.wizards.search.placeholder', 'Search wizards...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'view',
                  label: t('cpq.wizards.actions.view', 'View'),
                  href: `/backend/cpq/wizards/${row.code}/detail`,
                },
                ...(row.isActive
                  ? [
                      {
                        id: 'start',
                        label: t('cpq.wizards.actions.start', 'Start'),
                        onSelect: () => handleStartWizard(row.code),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          perspective={{ tableId: 'cpq.wizards.list' }}
          columnChooser={{ auto: true }}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          isLoading={isLoading}
          emptyState={
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              {t('cpq.wizards.empty', 'No wizard definitions yet. Create one via the API.')}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
