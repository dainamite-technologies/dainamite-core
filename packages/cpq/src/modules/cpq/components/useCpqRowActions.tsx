"use client"
import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

// ─── Types ───────────────────────────────────────────────────────

export type UseCpqRowActionsOptions<T extends { id: string }> = {
  /** DELETE endpoint that accepts `{ id }` body (e.g. `/api/cpq/product-offerings`). */
  endpoint: string
  /**
   * Singular noun for the entity, used in confirm + flash messages.
   * E.g. `'offering'`, `'pricing table'`, `'price rule'`.
   */
  entityName: string
  /**
   * Build the href for the row's edit/detail page (e.g. `(row) =>
   * `/backend/cpq/offerings/${row.id}`).
   */
  editHref: (row: T) => string
  /** Reload the table after a successful delete. */
  onReload: () => void
  /**
   * Override the row-deletion guard. Returning `false` skips the
   * delete request without flashing an error (e.g. when the row is in a
   * lifecycle state that disallows deletion).
   */
  canDelete?: (row: T) => boolean
}

export type CpqRowActionsApi<T extends { id: string }> = {
  /**
   * Items for `<RowActions>` for a single row. Always returns
   * `Edit` + `Delete` — extras can be prepended / appended.
   */
  buildItems: (row: T, extras?: { prepend?: RowActionItem[]; append?: RowActionItem[] }) => RowActionItem[]
  /**
   * Bulk-delete handler suitable for `<DataTable bulkActions>`. Confirms once
   * for the whole selection, then issues `DELETE` requests sequentially so
   * a partial failure stops cleanly. Reports per-row failures via `flash`.
   *
   * Note: sequential by design — DELETE on the same table from N parallel
   * requests can deadlock at the row-lock level under load. Chunked
   * parallelism would be the next step if selection counts grow > ~200.
   */
  bulkDelete: (rows: T[]) => Promise<{ ok: boolean; affectedCount?: number }>
  /**
   * Render this element somewhere in the page (typically as the
   * `footerContent` slot of `<CpqListView>`) so the confirm dialog
   * portal mounts.
   */
  ConfirmDialogElement: React.ReactNode
}

// ─── Implementation ──────────────────────────────────────────────

export function useCpqRowActions<T extends { id: string }>(
  options: UseCpqRowActionsOptions<T>,
): CpqRowActionsApi<T> {
  const { endpoint, entityName, editHref, onReload, canDelete } = options
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const deleteOne = React.useCallback(
    async (id: string) => {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      return res.ok
    },
    [endpoint],
  )

  const singleDelete = React.useCallback(
    async (row: T) => {
      if (canDelete && !canDelete(row)) return
      const confirmed = await confirm({
        title: t(
          'cpq.rowActions.deleteOne.confirm',
          `Delete this ${entityName}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return
      const ok = await deleteOne(row.id)
      if (!ok) {
        flash(
          t('cpq.rowActions.deleteOne.error', `Failed to delete ${entityName}`),
          'error',
        )
        return
      }
      flash(t('cpq.rowActions.deleteOne.success', `${entityName} deleted`), 'success')
      onReload()
    },
    [canDelete, confirm, deleteOne, entityName, onReload, t],
  )

  const bulkDelete = React.useCallback(
    async (rows: T[]) => {
      if (!rows.length) return { ok: false }
      const eligible = canDelete ? rows.filter(canDelete) : rows
      if (!eligible.length) {
        flash(
          t(
            'cpq.rowActions.deleteBulk.noEligible',
            `None of the selected ${entityName}s can be deleted in their current state.`,
          ),
          'error',
        )
        return { ok: false }
      }
      const confirmed = await confirm({
        title: t(
          'cpq.rowActions.deleteBulk.confirm',
          `Delete ${eligible.length} ${entityName}${eligible.length > 1 ? 's' : ''}?`,
        ),
        variant: 'destructive',
      })
      if (!confirmed) return { ok: false }

      let failed = 0
      for (const row of eligible) {
        const ok = await deleteOne(row.id)
        if (!ok) failed += 1
      }

      if (failed > 0) {
        flash(
          t(
            'cpq.rowActions.deleteBulk.partialError',
            `Failed to delete ${failed} ${entityName}${failed > 1 ? 's' : ''}`,
          ),
          'error',
        )
      } else {
        flash(
          t('cpq.rowActions.deleteBulk.success', `${entityName}s deleted`),
          'success',
        )
      }
      onReload()
      return { ok: failed === 0, affectedCount: eligible.length - failed }
    },
    [canDelete, confirm, deleteOne, entityName, onReload, t],
  )

  const buildItems = React.useCallback(
    (row: T, extras?: { prepend?: RowActionItem[]; append?: RowActionItem[] }): RowActionItem[] => {
      const items: RowActionItem[] = []
      if (extras?.prepend) items.push(...extras.prepend)
      items.push({
        id: 'edit',
        label: t('cpq.rowActions.edit', 'Edit'),
        href: editHref(row),
      })
      if (extras?.append) items.push(...extras.append)
      const deletable = !canDelete || canDelete(row)
      if (deletable) {
        items.push({
          id: 'delete',
          label: t('cpq.rowActions.delete', 'Delete'),
          destructive: true,
          onSelect: () => {
            void singleDelete(row)
          },
        })
      }
      return items
    },
    [canDelete, editHref, singleDelete, t],
  )

  return {
    buildItems,
    bulkDelete,
    ConfirmDialogElement,
  }
}
