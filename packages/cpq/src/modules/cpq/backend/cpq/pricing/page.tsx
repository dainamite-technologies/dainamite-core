"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { type BulkAction } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { CpqListView, useCpqListData } from '../../../components/CpqListView'

type PricingTable = {
  id: string
  code: string
  name: string
  priceColumns: Array<{ key: string; label: string }>
  currencyCodeList: string[]
  isActive: boolean
}

const PAGE_SIZE = 50

function buildFilterParams(values: FilterValues, params: URLSearchParams) {
  if (values.isActive === true) params.set('isActive', 'true')
  if (values.isActive === false) params.set('isActive', 'false')
}

export default function PricingTablesPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const data = useCpqListData<PricingTable>({
    endpoint: '/api/cpq/pricing-tables',
    pageSize: PAGE_SIZE,
    buildFilterParams,
    loadErrorMessage: t('cpq.pricing.list.error.load', 'Failed to load pricing tables'),
  })

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'isActive',
        label: t('cpq.pricing.filters.isActive', 'Active'),
        type: 'checkbox',
      },
    ],
    [t],
  )

  const columns = React.useMemo<ColumnDef<PricingTable>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('cpq.pricing.name', 'Name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'code',
        header: t('cpq.pricing.code', 'Code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: 'priceColumns',
        header: t('cpq.pricing.priceColumns', 'Price Columns'),
        cell: ({ row }) => <span>{row.original.priceColumns?.length ?? 0}</span>,
      },
      {
        id: 'currencies',
        header: t('cpq.pricing.currencies', 'Currencies'),
        cell: ({ row }) => <span>{row.original.currencyCodeList?.join(', ') ?? '—'}</span>,
      },
      {
        accessorKey: 'isActive',
        header: t('cpq.pricing.status', 'Status'),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              row.original.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            {row.original.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
          </span>
        ),
      },
    ],
    [t],
  )

  const deleteSelected = React.useCallback(
    async (selectedRows: PricingTable[]) => {
      if (!selectedRows.length) return { ok: false as const }
      const confirmed = await confirm({
        title: t(
          'cpq.pricing.bulk.deleteConfirm',
          `Delete ${selectedRows.length} pricing table${selectedRows.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false as const }
      let failed = 0
      for (const row of selectedRows) {
        const res = await fetch('/api/cpq/pricing-tables', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        if (!res.ok) failed += 1
      }
      if (failed > 0) {
        flash(
          t('cpq.pricing.flash.deleteFailed', `Failed to delete ${failed} pricing table(s)`),
          'error',
        )
      } else {
        flash(t('cpq.pricing.flash.deleted', 'Pricing tables deleted'), 'success')
      }
      data.reload()
      return { ok: failed === 0, affectedCount: selectedRows.length - failed }
    },
    [confirm, data, t],
  )

  const bulkActions = React.useMemo<BulkAction<PricingTable>[]>(
    () => [
      {
        id: 'delete',
        label: t('cpq.pricing.bulk.deleteSelected', 'Delete selected'),
        destructive: true,
        onExecute: deleteSelected,
      },
    ],
    [deleteSelected, t],
  )

  return (
    <CpqListView<PricingTable>
      title={t('cpq.pricing.list.title', 'Pricing Tables')}
      tableId="cpq.pricing.list"
      data={data}
      columns={columns}
      filters={filters}
      pageSize={PAGE_SIZE}
      searchPlaceholder={t('cpq.pricing.search.placeholder', 'Search pricing tables...')}
      actions={
        <Button asChild>
          <a href="/backend/cpq/pricing/new">{t('cpq.pricing.add', 'New Pricing Table')}</a>
        </Button>
      }
      bulkActions={bulkActions}
      onRowClick={(row) => router.push(`/backend/cpq/pricing/${row.id}`)}
      emptyState={
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          {t('cpq.pricing.empty', 'No pricing tables found.')}
        </div>
      }
      footerContent={ConfirmDialogElement}
    />
  )
}
