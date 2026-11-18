"use client"
import * as React from 'react'
import type { RowData } from '@tanstack/react-table'
import { DataTable, type DataTableProps } from '@open-mercato/ui/backend/DataTable'

/**
 * Billing's DataTable, with two billing-wide layout defaults:
 *
 *  1. Flush alignment — the framework card container carries a small side
 *     margin (`mx-1 sm:mx-2`) that is not overridable, so billing tables sat
 *     a few pixels inset from everything around them (tabs, detail cards,
 *     page header). The wrapper cancels exactly that margin. Embedded tables
 *     have no card / margin and are left alone.
 *  2. Wrapped cells — the framework truncates every cell at a per-column-type
 *     max width (e.g. 250px for `description`), which cut invoice lines and
 *     item terms off mid-word while the rest of the row stayed empty. Billing
 *     columns wrap instead; a column can still opt back in with
 *     `meta: { truncate: true }`.
 */
export function BillingDataTable<T extends RowData>(props: DataTableProps<T>) {
  const columns = React.useMemo(
    () =>
      props.columns.map((column) => {
        const meta = (column.meta ?? {}) as Record<string, unknown>
        if (typeof meta.truncate === 'boolean') return column
        return { ...column, meta: { ...meta, truncate: false } }
      }),
    [props.columns],
  ) as DataTableProps<T>['columns']

  const table = <DataTable<T> {...props} columns={columns} />
  if (props.embedded) return table
  return <div className="-mx-1 sm:-mx-2">{table}</div>
}
