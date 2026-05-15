"use client"
import * as React from 'react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { ImportDiff } from './xlsxImport'

export function ImportPreview({
  diff,
  saving,
  onConfirm,
  onCancel,
}: {
  diff: ImportDiff
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const total = diff.inserts.length + diff.updates.length + diff.deletes.length
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Import preview</h3>
        <div className="flex gap-2 items-center text-sm">
          <Tag variant="success" dot>{diff.inserts.length} new</Tag>
          <Tag variant="warning" dot>{diff.updates.length} updated</Tag>
          <Tag variant="error" dot>{diff.deletes.length} deleted</Tag>
          <span className="text-muted-foreground">({diff.unchanged.length} unchanged)</span>
        </div>
      </div>

      {diff.warnings.length > 0 && (
        <Alert variant="default">
          <div className="font-medium mb-1">Warnings</div>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {diff.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Alert>
      )}

      {total === 0 ? (
        <Alert>
          The file contains no changes — every row matches an existing entry.
        </Alert>
      ) : (
        <div className="space-y-2 text-xs">
          {diff.inserts.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-success">
                {diff.inserts.length} new entries will be created
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.inserts.map((r) => (
                  <li key={r.rowNumber}>
                    Row {r.rowNumber}: {summarizeRow(r)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {diff.updates.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-warning">
                {diff.updates.length} entries will be updated
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.updates.map((u) => (
                  <li key={u.before.id}>
                    Row {u.after.rowNumber} (id <code className="font-mono">{u.before.id.slice(0, 8)}…</code>): {summarizeRow(u.after)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {diff.deletes.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-destructive">
                {diff.deletes.length} entries will be deleted
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.deletes.map((e) => (
                  <li key={e.id}>
                    <code className="font-mono">{e.id.slice(0, 8)}…</code>: {summarizeEntry(e)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        <Button type="button" onClick={onConfirm} disabled={saving || total === 0}>
          {saving ? 'Applying...' : `Apply changes (${total})`}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function summarizeRow(r: ImportDiff['inserts'][number] | ImportDiff['updates'][number]['after']): string {
  const bits: string[] = []
  if (r.tierNumber != null) bits.push(`tier ${r.tierNumber}`)
  if (r.rangeFrom != null || r.rangeTo != null) bits.push(`[${r.rangeFrom ?? '0'}..${r.rangeTo ?? '∞'}]`)
  for (const [k, v] of Object.entries(r.dimensionValues)) if (v) bits.push(`${k}=${v}`)
  bits.push(r.currencyCode)
  const priceBits = Object.entries(r.prices).map(([k, v]) => `${k}:${v}`)
  if (priceBits.length > 0) bits.push(`{${priceBits.join(', ')}}`)
  return bits.join(' · ')
}

function summarizeEntry(e: ImportDiff['deletes'][number]): string {
  const bits: string[] = []
  if (e.tierNumber != null) bits.push(`tier ${e.tierNumber}`)
  if (e.rangeFrom != null || e.rangeTo != null) bits.push(`[${e.rangeFrom ?? '0'}..${e.rangeTo ?? '∞'}]`)
  for (const [k, v] of Object.entries(e.dimensionValues)) if (v) bits.push(`${k}=${v}`)
  bits.push(e.currencyCode)
  return bits.join(' · ')
}
