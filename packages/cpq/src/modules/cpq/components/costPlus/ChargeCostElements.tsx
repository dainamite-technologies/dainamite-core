'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Plus } from 'lucide-react'
import { costErrorMessage, type CostElementRow } from '../../lib/costPlusView'
import { CostElementDialog } from './CostElementDialog'
import { CostPreviewDialog, type PreviewAttribute } from './CostPreviewDialog'

export const CHARGE_COST_ELEMENTS_SPOT_ID = 'data-table:cpq.charge_cost_elements'
const PAGE_SIZE = 25

type Props = {
  charge: { id: string; code: string; chargeType: string; currencyCode: string | null; quantityAttributeCode: string | null; isCostPlus: boolean }
  offeringId: string
  attributes: PreviewAttribute[]
  /** Called after the list changes, so the page can refresh its charge rows. */
  onChanged?: () => void
}

/** Cost elements of one charge: paginated sub-table, add / edit / delete, and the cost preview. */
export function ChargeCostElements({ charge, offeringId, attributes, onChanged }: Props) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<CostElementRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [dialog, setDialog] = React.useState<{ element: CostElementRow | null } | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<{ items: CostElementRow[]; total: number; totalPages: number }>(
      `/api/cpq/charge-cost-elements?productChargeId=${encodeURIComponent(charge.id)}&page=${page}&pageSize=${PAGE_SIZE}`,
    )
    setLoading(false)
    if (call.ok && call.result) {
      setRows(call.result.items)
      setTotal(call.result.total)
      setTotalPages(Math.max(1, call.result.totalPages))
    } else {
      flash(t('cpq.costElements.loadError', 'Failed to load cost elements'), 'error')
    }
  }, [charge.id, page, t])

  React.useEffect(() => { void load() }, [load])

  const remove = React.useCallback(async (row: CostElementRow) => {
    const ok = await confirm({
      title: t('cpq.costElements.deleteConfirm.title', 'Delete this cost element?'),
      text: row.name,
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (!ok) return
    const call = await apiCall<{ error?: string }>(`/api/cpq/charge-cost-elements?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
    if (call.ok) { await load(); onChanged?.(); return }
    const code = call.result?.error ?? 'DELETE_FAILED'
    flash(t(`cpq.costElements.errors.${code}`, costErrorMessage(code, 'Failed to delete the cost element')), 'error')
  }, [confirm, load, onChanged, t])

  const columns = React.useMemo<ColumnDef<CostElementRow>[]>(() => [
    { accessorKey: 'name', header: t('cpq.costElements.name', 'Name'), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'code', header: t('cpq.costElements.code', 'Code'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    {
      id: 'role',
      header: t('cpq.costElements.role', 'Role'),
      cell: ({ row }) => (
        <Tag variant={row.original.role === 'price_basis' ? 'info' : 'neutral'}>
          {t(`cpq.costElements.roles.${row.original.role}`, row.original.role === 'price_basis' ? 'Price basis' : 'Margin only')}
        </Tag>
      ),
    },
    { id: 'costType', header: t('cpq.costElements.costType', 'Type'), cell: ({ row }) => row.original.costType.toUpperCase() },
    {
      id: 'source',
      header: t('cpq.costElements.source', 'Source'),
      cell: ({ row }) => {
        const el = row.original
        if (el.source === 'fixed') return `${t('cpq.costElements.sources.fixed', 'Fixed amount')}: ${el.currencyCode ?? ''} ${el.amount ?? ''}`
        if (el.source === 'table') return `${t('cpq.costElements.sources.table', 'Cost table')}: ${el.costColumnKey ?? '?'}`
        return `${t('cpq.costElements.sources.on_request', 'On request (supplier)')}${el.estimateAmount ? ` ≈ ${el.currencyCode ?? ''} ${el.estimateAmount}` : ''}`
      },
    },
    { id: 'costModel', header: t('cpq.costElements.model', 'Cost model'), cell: ({ row }) => row.original.costModel },
    {
      id: 'isActive',
      header: t('cpq.costElements.active', 'Active'),
      cell: ({ row }) => <Tag variant={row.original.isActive ? 'success' : 'neutral'} dot>{row.original.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}</Tag>,
    },
  ], [t])

  return (
    <div className="rounded-md border bg-background p-3" data-testid="cpq-charge-cost-elements">
      <DataTable<CostElementRow>
        embedded
        title={t('cpq.costElements.title', 'Cost elements')}
        actions={(
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>{t('cpq.costPreview.run', 'Preview cost')}</Button>
            <Button size="sm" onClick={() => setDialog({ element: null })}>
              <Plus className="mr-1 h-4 w-4" />{t('cpq.costElements.add', 'Add cost element')}
            </Button>
          </div>
        )}
        columns={columns}
        data={rows}
        isLoading={loading}
        injectionSpotId={CHARGE_COST_ELEMENTS_SPOT_ID}
        pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        rowActions={(row) => (
          <RowActions items={[
            { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => setDialog({ element: row }) },
            { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void remove(row) } },
          ]}
          />
        )}
        emptyState={(
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('cpq.costElements.empty', 'This charge has no costs. Add one to track margin or price it cost-plus.')}
          </p>
        )}
      />
      {dialog && (
        <CostElementDialog
          open
          charge={charge}
          element={dialog.element}
          onClose={() => setDialog(null)}
          onSaved={() => { void load(); onChanged?.() }}
        />
      )}
      <CostPreviewDialog open={previewOpen} offeringId={offeringId} attributes={attributes} chargeCode={charge.code} onClose={() => setPreviewOpen(false)} />
      {ConfirmDialogElement}
    </div>
  )
}
