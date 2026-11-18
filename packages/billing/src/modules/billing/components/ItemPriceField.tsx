"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MoneyInput } from './MoneyInput'
import { counterpartAmount, type PriceBasis } from '../lib/lineAmounts'

export type ItemPriceFieldProps = {
  label: string
  value: string
  onChange: (next: string) => void
  step: string
  currencyCode: string
  priceBasis: PriceBasis
  /** VAT rate in percent as typed in the form ('' = unknown). */
  taxRate: string
  /** False when VAT does not apply to this price (prepaid, tax at top-up). */
  showCounterpart: boolean
  /**
   * Decimals of the preview. 2 = the line rule (`lineVat`). Higher values are
   * for per-unit usage prices, where 2 dp would read as 0.00; those are
   * indicative only — the invoice rounds the extended line once.
   */
  precision?: number
  help?: React.ReactNode
}

function parse(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * One item price input (Spec F, F2 + F3): the currency suffix from the
 * account, and below it the other side of the price, computed with the same
 * `lineVat` rule the invoice uses ("Gross 60.27 EUR" / "Net 49.00 EUR").
 */
export function ItemPriceField({
  label,
  value,
  onChange,
  step,
  currencyCode,
  priceBasis,
  taxRate,
  showCounterpart,
  precision = 2,
  help,
}: ItemPriceFieldProps) {
  const t = useT()
  const amount = parse(value)
  const rate = parse(taxRate) ?? 0
  const counterpart =
    showCounterpart && amount !== null
      ? precision > 2
        ? priceBasis === 'gross'
          ? amount / (1 + rate / 100)
          : amount * (1 + rate / 100)
        : counterpartAmount(amount, priceBasis, rate)
      : null
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">
        {label}
        <span className="text-destructive"> *</span>
      </span>
      <MoneyInput currencyCode={currencyCode} step={step} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      {counterpart !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {priceBasis === 'gross'
            ? t('billing.items.form.price.net_preview', 'Net')
            : t('billing.items.form.price.gross_preview', 'Gross')}{' '}
          <span className="font-medium text-foreground">{counterpart.toFixed(precision)}</span>
          {currencyCode ? ` ${currencyCode}` : ''}
          {` · ${t('billing.items.form.price.vat_preview', 'VAT')} ${rate} %`}
        </span>
      ) : null}
      {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
    </label>
  )
}
