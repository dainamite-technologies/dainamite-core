"use client"
import * as React from 'react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
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
  const t = useT()
  const total = diff.inserts.length + diff.updates.length + diff.deletes.length
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t('cpq.pricing.import.preview.title', 'Import preview')}</h3>
        <div className="flex gap-2 items-center text-sm">
          <Tag variant="success" dot>{t('cpq.pricing.import.preview.newCount', '{count} new', { count: diff.inserts.length })}</Tag>
          <Tag variant="warning" dot>{t('cpq.pricing.import.preview.updatedCount', '{count} updated', { count: diff.updates.length })}</Tag>
          <Tag variant="error" dot>{t('cpq.pricing.import.preview.deletedCount', '{count} deleted', { count: diff.deletes.length })}</Tag>
          <span className="text-muted-foreground">{t('cpq.pricing.import.preview.unchangedCount', '({count} unchanged)', { count: diff.unchanged.length })}</span>
        </div>
      </div>

      {diff.warnings.length > 0 && (
        <Alert variant="default">
          <div className="font-medium mb-1">{t('cpq.pricing.import.preview.warnings', 'Warnings')}</div>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {diff.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Alert>
      )}

      {total === 0 ? (
        <Alert>
          {t('cpq.pricing.import.preview.noChanges', 'The file contains no changes — every row matches an existing entry.')}
        </Alert>
      ) : (
        <div className="space-y-2 text-xs">
          {diff.inserts.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-success">
                {t('cpq.pricing.import.preview.insertsSummary', '{count} new entries will be created', { count: diff.inserts.length })}
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.inserts.map((r) => (
                  <li key={r.rowNumber}>
                    {t('cpq.pricing.import.preview.insertRow', 'Row {row}: {summary}', { row: r.rowNumber, summary: summarizeRow(r, t) })}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {diff.updates.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-warning">
                {t('cpq.pricing.import.preview.updatesSummary', '{count} entries will be updated', { count: diff.updates.length })}
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.updates.map((u) => (
                  <li key={u.before.id}>
                    {/* The truncated id renders as <code> between prefix and suffix. */}
                    {t('cpq.pricing.import.preview.updateRowPrefix', 'Row {row} (id ', { row: u.after.rowNumber })}
                    <code className="font-mono">{u.before.id.slice(0, 8)}…</code>
                    {t('cpq.pricing.import.preview.updateRowSuffix', '): {summary}', { summary: summarizeRow(u.after, t) })}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {diff.deletes.length > 0 && (
            <details className="rounded border p-2">
              <summary className="cursor-pointer font-medium text-destructive">
                {t('cpq.pricing.import.preview.deletesSummary', '{count} entries will be deleted', { count: diff.deletes.length })}
              </summary>
              <ul className="mt-2 pl-5 list-disc space-y-0.5 max-h-40 overflow-y-auto">
                {diff.deletes.map((e) => (
                  <li key={e.id}>
                    <code className="font-mono">{e.id.slice(0, 8)}…</code>: {summarizeEntry(e, t)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        <Button type="button" onClick={onConfirm} disabled={saving || total === 0}>
          {saving
            ? t('cpq.pricing.import.preview.applying', 'Applying...')
            : t('cpq.pricing.import.preview.apply', 'Apply changes ({count})', { count: total })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t('cpq.common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

function summarizeRow(
  r: ImportDiff['inserts'][number] | ImportDiff['updates'][number]['after'],
  t: TranslateFn,
): string {
  const bits: string[] = []
  if (r.tierNumber != null) bits.push(t('cpq.pricing.import.preview.tier', 'tier {tier}', { tier: r.tierNumber }))
  if (r.rangeFrom != null || r.rangeTo != null) bits.push(`[${r.rangeFrom ?? '0'}..${r.rangeTo ?? '∞'}]`)
  for (const [k, v] of Object.entries(r.dimensionValues)) if (v) bits.push(`${k}=${v}`)
  bits.push(r.currencyCode)
  const priceBits = Object.entries(r.prices).map(([k, v]) => `${k}:${v}`)
  if (priceBits.length > 0) bits.push(`{${priceBits.join(', ')}}`)
  return bits.join(' · ')
}

function summarizeEntry(e: ImportDiff['deletes'][number], t: TranslateFn): string {
  const bits: string[] = []
  if (e.tierNumber != null) bits.push(t('cpq.pricing.import.preview.tier', 'tier {tier}', { tier: e.tierNumber }))
  if (e.rangeFrom != null || e.rangeTo != null) bits.push(`[${e.rangeFrom ?? '0'}..${e.rangeTo ?? '∞'}]`)
  for (const [k, v] of Object.entries(e.dimensionValues)) if (v) bits.push(`${k}=${v}`)
  bits.push(e.currencyCode)
  return bits.join(' · ')
}
