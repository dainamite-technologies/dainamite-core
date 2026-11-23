'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { formatMoney } from '../lib/formatMoney'
import { arcDiffCostRows, type ArcDiffCostRow } from '../lib/arcCostView'
import type { ArcCostsView } from '../lib/quoteCostView'

export type LineAction = 'add' | 'modify' | 'cancel'

const ACTION_VARIANTS: Record<LineAction, 'info' | 'warning' | 'error'> = {
  add: 'info',
  modify: 'warning',
  cancel: 'error',
}

/** Coloured add / modify / cancel tag on quote and order lines. */
export function LineActionBadge({ action, label, title }: { action: string; label?: string; title?: string }) {
  const variant = ACTION_VARIANTS[action as LineAction] ?? 'info'
  return (
    <Tag variant={variant} className="px-1.5 text-xs" title={title}>
      {label ?? action}
    </Tag>
  )
}

export type ArcDiffLine = {
  action: string
  quantity: number
  nrcTotal: number
  mrcTotal: number
  arcSource: { mrcAmount: number; nrcAmount: number; quantity: number } | null
}

/** Before / after / Δ preview for a line that changes an existing subscription item. */
export function ArcLineDiff({ line, currency, costs }: { line: ArcDiffLine; currency: string; costs?: ArcCostsView | null }) {
  const t = useT()
  const src = line.arcSource
  if (!src) return null
  const isCancel = line.action === 'cancel'
  const rows: Array<{ label: string; before: number; after: number; asCurrency: boolean; key?: string }> = [
    { label: t('cpq.arc.diff.quantity', 'Quantity'), before: src.quantity, after: isCancel ? 0 : line.quantity, asCurrency: false },
    { label: t('cpq.arc.diff.mrc', 'MRC'), before: src.mrcAmount, after: isCancel ? 0 : line.mrcTotal, asCurrency: true },
    { label: t('cpq.arc.diff.nrc', 'NRC'), before: src.nrcAmount, after: isCancel ? 0 : line.nrcTotal, asCurrency: true },
  ]
  // Cost and margin rows only with `costs` (the server sends them to `cpq.costs.view` holders only).
  const costRows = arcDiffCostRows(costs, { beforeMrc: src.mrcAmount, afterMrc: isCancel ? 0 : line.mrcTotal })
  const costLabels: Record<ArcDiffCostRow['key'], string> = {
    mrcCost: t('cpq.arc.diff.mrcCost', 'MRC cost'),
    mrcMargin: t('cpq.arc.diff.mrcMargin', 'MRC margin'),
    nrcCost: t('cpq.arc.diff.nrcCost', 'NRC cost'),
  }
  rows.push(...(costRows ?? []).map((row) => ({ label: costLabels[row.key], before: row.before, after: row.after, asCurrency: true, key: row.key })))
  const fmtVal = (value: number, asCurrency: boolean) => (asCurrency ? formatMoney(value, currency) : String(value))

  return (
    <div className="space-y-1.5" data-testid="cpq-arc-line-diff">
      <p className="text-xs font-medium text-muted-foreground">{t('cpq.arc.diff.title', 'Change Preview')}</p>
      <div className="rounded border bg-background overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium" />
              <th className="text-right px-3 py-1.5 font-medium">{t('cpq.arc.diff.before', 'Before')}</th>
              <th className="text-right px-3 py-1.5 font-medium">{t('cpq.arc.diff.after', 'After')}</th>
              <th className="text-right px-3 py-1.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.after - r.before
              const showDelta = delta !== 0
              return (
                <tr key={r.label} className="border-t border-dashed border-border/40" data-testid={r.key ? `cpq-arc-diff-${r.key}` : undefined}>
                  <td className="px-3 py-1 text-muted-foreground">{r.label}</td>
                  <td className="px-3 py-1 text-right font-mono">{fmtVal(r.before, r.asCurrency)}</td>
                  <td className={`px-3 py-1 text-right font-mono ${isCancel ? 'text-muted-foreground line-through' : ''}`}>
                    {fmtVal(r.after, r.asCurrency)}
                  </td>
                  <td className={`px-3 py-1 text-right font-mono font-medium ${showDelta ? (delta > 0 ? 'text-status-success-text' : 'text-destructive') : 'text-muted-foreground'}`}>
                    {showDelta ? `${delta > 0 ? '+' : ''}${fmtVal(delta, r.asCurrency)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {isCancel && (
        <p className="text-xs text-destructive italic">
          {t('cpq.arc.diff.cancelNote', 'Cancellation — item will be terminated on activation.')}
        </p>
      )}
    </div>
  )
}
