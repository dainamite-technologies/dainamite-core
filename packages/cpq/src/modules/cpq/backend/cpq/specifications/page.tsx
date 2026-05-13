"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'

type Specification = {
  id: string
  productId: string
  code: string
  name: string
  description: string | null
  specType: string
  isAssetizable: boolean
  lifecycleStatus: string
  version: number
  isActive: boolean
  createdAt: string
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  deprecated: 'bg-yellow-100 text-yellow-800',
  retired: 'bg-red-100 text-red-700',
}

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (typeof values.lifecycleStatus === 'string' && values.lifecycleStatus) {
    params.set('lifecycleStatus', values.lifecycleStatus)
  }
  if (typeof values.specType === 'string' && values.specType) {
    params.set('specType', values.specType)
  }
  if (values.isActive === true) params.set('isActive', 'true')
  if (values.isActive === false) params.set('isActive', 'false')
  if (values.isAssetizable === true) params.set('isAssetizable', 'true')
  if (values.isAssetizable === false) params.set('isAssetizable', 'false')
}

export default function SpecificationsListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const data = useCpqListData<Specification>({
    endpoint: '/api/cpq/product-specifications',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.specifications.list.error.load', 'Failed to load specifications'),
  })

  const lifecycleOptions = React.useMemo(
    () => [
      { value: 'draft', label: t('cpq.specifications.lifecycle.draft', 'Draft') },
      { value: 'active', label: t('cpq.specifications.lifecycle.active', 'Active') },
      { value: 'deprecated', label: t('cpq.specifications.lifecycle.deprecated', 'Deprecated') },
      { value: 'retired', label: t('cpq.specifications.lifecycle.retired', 'Retired') },
    ],
    [t],
  )

  const specTypeOptions = React.useMemo(
    () => [
      { value: 'simple', label: t('cpq.specifications.type.simple', 'Simple') },
      { value: 'bundle', label: t('cpq.specifications.type.bundle', 'Bundle') },
    ],
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'lifecycleStatus',
        label: t('cpq.specifications.filters.lifecycleStatus', 'Lifecycle Status'),
        type: 'select',
        options: lifecycleOptions,
      },
      {
        id: 'specType',
        label: t('cpq.specifications.filters.specType', 'Type'),
        type: 'select',
        options: specTypeOptions,
      },
      {
        id: 'isActive',
        label: t('cpq.specifications.filters.isActive', 'Active'),
        type: 'checkbox',
      },
      {
        id: 'isAssetizable',
        label: t('cpq.specifications.filters.isAssetizable', 'Assetizable'),
        type: 'checkbox',
      },
    ],
    [lifecycleOptions, specTypeOptions, t],
  )

  const columns = React.useMemo<ColumnDef<Specification>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('cpq.specifications.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: 'name',
        header: t('cpq.specifications.name', 'Name'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.name}
            {row.original.specType === 'bundle' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-medium">
                bundle
              </span>
            )}
            {row.original.isAssetizable && (
              <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 text-orange-800 px-2 py-0.5 text-[10px] font-medium">
                asset
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.specifications.isActive', 'Is Active?'),
        cell: ({ row }) => <Checkbox checked={row.original.isActive} disabled />,
      },
      {
        accessorKey: 'lifecycleStatus',
        header: t('cpq.specifications.lifecycleStatus', 'Lifecycle Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_COLORS[row.original.lifecycleStatus] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {row.original.lifecycleStatus}
          </span>
        ),
      },
      {
        accessorKey: 'version',
        header: t('cpq.specifications.version', 'Version'),
        cell: ({ row }) => <span>v{row.original.version}</span>,
      },
      {
        accessorKey: 'description',
        header: t('cpq.specifications.description', 'Description'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.description ?? '—'}</span>
        ),
        meta: { truncate: true, maxWidth: 320 },
      },
    ],
    [t],
  )

  const deleteSelected = React.useCallback(
    async (selectedRows: Specification[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.specifications.bulk.deleteConfirm',
          `Delete ${selectedRows.length} specification${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/product-specifications', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.specifications.flash.deleteFailed', `Failed to delete ${failed} specification(s)`),
          'error',
        )
      } else {
        flash(t('cpq.specifications.flash.deleted', 'Specifications deleted'), 'success')
      }
      data.reload()
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, data, t],
  )

  const bulkActions = React.useMemo<BulkAction<Specification>[]>(
    () => [
      {
        id: 'delete',
        label: t('cpq.specifications.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, t],
  )

  return (
    <CpqListView<Specification>
      title={t('cpq.specifications.list.title', 'Product Specifications')}
      tableId="cpq.specifications.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.specifications.search.placeholder', 'Search specifications...')}
      actions={
        <Button asChild>
          <a href="/backend/cpq/specifications/new">
            {t('cpq.specifications.add', 'New Specification')}
          </a>
        </Button>
      }
      bulkActions={bulkActions}
      onRowClick={(row) => router.push(`/backend/cpq/specifications/${row.id}`)}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(
            'cpq.specifications.empty',
            'No product specifications found. Create one to define your product catalogue.',
          )}
        </div>
      }
      footerContent={ConfirmDialogElement}
    />
  )
}
