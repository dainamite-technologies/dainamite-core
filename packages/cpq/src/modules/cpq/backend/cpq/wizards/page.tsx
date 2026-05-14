"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'

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

const PAGE_SIZE = 50

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.surface === 'string' && values.surface.trim()) {
    params.set('surface', values.surface.trim())
  }
  if (values.isActive === true) params.set('isActive', 'true')
  if (values.isActive === false) params.set('isActive', 'false')
}

export default function CpqWizardsPage() {
  const router = useRouter()
  const t = useT()

  const data = useCpqListData<WizardDefinition>({
    endpoint: '/api/cpq/wizards',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.wizards.list.error.load', 'Failed to load wizards'),
  })

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

  const handlePreviewWizard = React.useCallback(
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
          <Tag variant={row.original.isActive ? 'success' : 'neutral'} dot>
            {row.original.isActive ? 'Yes' : 'No'}
          </Tag>
        ),
      },
    ],
    [t],
  )

  return (
    <CpqListView<WizardDefinition>
      title={t('cpq.wizards.list.title', 'Wizards')}
      tableId="cpq.wizards.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.wizards.search.placeholder', 'Search wizards...')}
      onRowClick={(row) => router.push(`/backend/cpq/wizards/${row.code}/detail`)}
      // Wizards are read-only in the admin UI for now: no Edit / Delete
      // entries — only `Preview` (run the wizard) and `View details`.
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: 'preview',
              label: t('cpq.wizards.actions.preview', 'Preview'),
              onSelect: () => handlePreviewWizard(row.code),
            },
            {
              id: 'details',
              label: t('cpq.wizards.actions.details', 'View details'),
              href: `/backend/cpq/wizards/${row.code}/detail`,
            },
          ]}
        />
      )}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.wizards.empty', 'No wizard definitions yet. Create one via the API.')}
        </div>
      }
    />
  )
}
