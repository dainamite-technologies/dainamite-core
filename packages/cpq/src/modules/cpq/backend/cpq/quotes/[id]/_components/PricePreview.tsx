'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { formatMoney } from '../../../../../lib/formatMoney'
import { ADJUSTMENT_ERROR_FALLBACKS, discountDepth, formatDepth, isAboveStandard, lineTypeTotals } from '../../../../../lib/priceAdjustmentView'
import { isOnTarget, targetOf, targetKey } from '../../../../../lib/targetPrice'
import { scheduleText, stateText, targetOptionLabel, type DialogCharge, type DialogLine, type StoredRow, type TargetOption } from '../../../../../lib/priceDialogView'

export type PreviewError = { adjustmentId: string; code: string; conflictsWith?: string }

/** Charges a target prices: the line's (bundle's) charges of its type, or the one charge. */
function affected(option: TargetOption, bundle: DialogLine[]): Array<{ line: DialogLine; charge: DialogCharge }> {
  const target = option.target
  return bundle.flatMap((line) => line.charges.filter((charge) => {
    if (charge.chargeType === 'usage') return false
    if (target.level === 'charge') return line.lineId === target.quoteLineId && charge.chargeCode === target.chargeCode
    return !target.chargeTypeFilter || target.chargeTypeFilter === charge.chargeType
  }).map((charge) => ({ line, charge })))
}

/**
 * Live preview (§3.4): each affected charge before → after (with "Above
 * standard" for uplifts), its schedule, the line totals, and what the save
 * replaces. Overlaps name the other target (D2) and block Save; a line target
 * hidden behind a charge adjustment is explained (most specific wins).
 */
export function PricePreview({ option, options, rows, bundle, previewBundle, errors, previewing, invalidText, currency }: {
  option: TargetOption
  options: TargetOption[]
  /** Every stored row of the quote. */
  rows: StoredRow[]
  bundle: DialogLine[]
  /** The same lines from the preview quote; null before the first preview. */
  previewBundle: DialogLine[] | null
  errors: PreviewError[]
  previewing: boolean
  /** Why no preview can run yet (invalid draft); null when it can. */
  invalidText: string | null
  currency: string
}) {
  const t = useT()
  const money = (value: number | null | undefined) => formatMoney(value ?? 0, currency)
  const message = (code: string) => t(`cpq.priceAdjustments.errors.${code}`, ADJUSTMENT_ERROR_FALLBACKS[code] ?? code)
  const conflictLabel = (id?: string) => {
    const other = rows.find((row) => row.id === id)
    const otherOption = other ? options.find((entry) => entry.key === targetKey(targetOf(other))) : undefined
    return otherOption ? targetOptionLabel(t, otherOption) : t('cpq.priceDialog.preview.otherTarget', 'another adjustment')
  }
  const hidden = option.target.level === 'line'
    ? affected(option, bundle).filter(({ line, charge }) => rows.some((row) => isOnTarget(row, { level: 'charge', quoteLineId: line.lineId, chargeCode: charge.chargeCode })))
    : []
  const replaced = stateText(t, option.state)
  const previewCharge = (line: DialogLine, charge: DialogCharge) =>
    previewBundle?.find((entry) => entry.lineId === line.lineId)?.charges.find((entry) => entry.chargeCode === charge.chargeCode)

  return (
    <div className="space-y-1 rounded border bg-muted/20 p-2 text-xs" aria-live="polite" data-testid="cpq-price-preview">
      {errors.map((error, index) => (
        <div key={`${error.adjustmentId}:${index}`} className="text-destructive" data-testid={error.code === 'ADJUSTMENT_OVERLAP' ? 'cpq-price-conflict' : 'cpq-price-preview-error'}>
          {error.code === 'ADJUSTMENT_OVERLAP'
            ? t('cpq.priceDialog.preview.overlap', 'Overlaps {target}. Remove it first, or pick it in Applies to.', { target: conflictLabel(error.conflictsWith) })
            : message(error.code)}
        </div>
      ))}
      {invalidText && <div className="text-muted-foreground">{invalidText}</div>}
      {!invalidText && previewing && <div className="text-muted-foreground">{t('cpq.priceAdjustments.dialog.previewing', 'Calculating…')}</div>}
      {!invalidText && !previewing && previewBundle && (
        <>
          {affected(option, bundle).map(({ line, charge }) => {
            const after = previewCharge(line, charge)
            if (!after) return null
            const before = charge.totalPrice ?? 0
            const offer = after.totalPrice ?? 0
            const depth = formatDepth(discountDepth(after.standardTotalPrice ?? before, offer))
            return (
              <div key={`${line.lineId}:${charge.chargeCode}`} className="flex flex-wrap items-center gap-1" data-testid="cpq-price-preview-charge">
                <span>{charge.chargeName}</span>
                <span className="font-mono text-muted-foreground">{money(before)}</span>
                <span aria-hidden>→</span>
                {after.schedule?.length
                  ? <span className="font-mono font-medium">{scheduleText(t, after.schedule, line.termMonths)}</span>
                  : <span className="font-mono font-medium">{money(offer)}</span>}
                {depth && !after.schedule?.length && <span className="font-mono">({depth})</span>}
                {isAboveStandard(after.standardTotalPrice, offer) && <Tag variant="warning" className="px-1.5 text-xs" data-testid="cpq-adjustment-above-standard">{t('cpq.priceAdjustments.aboveStandard', 'Above standard')}</Tag>}
              </div>
            )
          })}
          <div className="text-muted-foreground">
            {t('cpq.priceAdjustments.dialog.previewLine', 'Line totals')}:{' '}
            {(['mrc', 'nrc'] as const).map((type) => {
              const before = bundle.reduce((sum, line) => sum + lineTypeTotals(line, type).offer, 0)
              const after = previewBundle.reduce((sum, line) => sum + lineTypeTotals(line, type).offer, 0)
              return <span key={type} className="mr-3">{type === 'mrc' ? t('cpq.lines.mrc', 'MRC') : t('cpq.lines.nrc', 'NRC')} <span className="font-mono">{money(before)} → {money(after)}</span></span>
            })}
          </div>
        </>
      )}
      {hidden.map(({ charge }) => (
        <div key={charge.chargeCode} className="text-muted-foreground" data-testid="cpq-price-most-specific">
          {t('cpq.priceDialog.preview.mostSpecific', '{charge} keeps its own price: a charge adjustment beats a line one', { charge: charge.chargeName })}
        </div>
      ))}
      {replaced && <div className="text-muted-foreground" data-testid="cpq-price-replaces">{t('cpq.priceDialog.preview.replaces', 'Replaces {state}', { state: replaced })}</div>}
    </div>
  )
}
