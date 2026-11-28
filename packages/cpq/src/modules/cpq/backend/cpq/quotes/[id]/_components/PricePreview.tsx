'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ADJUSTMENT_ERROR_FALLBACKS, isAboveStandard } from '../../../../../lib/priceAdjustmentView'
import { isOnTarget, targetOf, targetKey } from '../../../../../lib/targetPrice'
import { stateText, targetOptionLabel, type DialogCharge, type DialogLine, type StoredRow, type TargetOption } from '../../../../../lib/priceDialogView'

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
 * Preview messages (§3.4): the draft is priced live, but the dialog shows only
 * what needs attention, never the before → after prices (the Current prices
 * table is above). Overlaps name the other target (D2) and block Save; other
 * preview errors; why no preview can run yet; an uplift above standard; a line
 * target hidden behind a charge adjustment (most specific wins); what the save
 * replaces. Renders nothing when there is nothing to say.
 */
export function PricePreview({ option, options, rows, bundle, previewBundle, errors, invalidText }: {
  option: TargetOption
  options: TargetOption[]
  /** Every stored row of the quote. */
  rows: StoredRow[]
  bundle: DialogLine[]
  /** The same lines from the preview quote; null before the first preview. */
  previewBundle: DialogLine[] | null
  errors: PreviewError[]
  /** Why no preview can run yet (invalid draft); null when it can. */
  invalidText: string | null
}) {
  const t = useT()
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
  const uplifts = invalidText || !previewBundle ? [] : affected(option, bundle).filter(({ line, charge }) => {
    const after = previewCharge(line, charge)
    return !!after && isAboveStandard(after.standardTotalPrice, after.totalPrice ?? 0)
  })
  const empty = !errors.length && !invalidText && !uplifts.length && !hidden.length && !replaced

  return (
    <div aria-live="polite" data-testid="cpq-price-preview">
      {!empty && (
        <div className="space-y-1 rounded border bg-muted/20 p-2 text-xs">
          {errors.map((error, index) => (
            <div key={`${error.adjustmentId}:${index}`} className="text-destructive" data-testid={error.code === 'ADJUSTMENT_OVERLAP' ? 'cpq-price-conflict' : 'cpq-price-preview-error'}>
              {error.code === 'ADJUSTMENT_OVERLAP'
                ? t('cpq.priceDialog.preview.overlap', 'Overlaps {target}. Remove it first, or pick it in Applies to.', { target: conflictLabel(error.conflictsWith) })
                : message(error.code)}
            </div>
          ))}
          {invalidText && <div className="text-muted-foreground">{invalidText}</div>}
          {uplifts.map(({ line, charge }) => (
            <div key={`${line.lineId}:${charge.chargeCode}`} className="text-status-warning-text" data-testid="cpq-adjustment-above-standard">
              {t('cpq.priceDialog.preview.aboveStandard', '{charge}: above the standard price', { charge: charge.chargeName })}
            </div>
          ))}
          {hidden.map(({ charge }) => (
            <div key={charge.chargeCode} className="text-muted-foreground" data-testid="cpq-price-most-specific">
              {t('cpq.priceDialog.preview.mostSpecific', '{charge} keeps its own price: a charge adjustment beats a line one', { charge: charge.chargeName })}
            </div>
          ))}
          {replaced && <div className="text-muted-foreground" data-testid="cpq-price-replaces">{t('cpq.priceDialog.preview.replaces', 'Replaces {state}', { state: replaced })}</div>}
        </div>
      )}
    </div>
  )
}
