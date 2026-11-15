/**
 * Pure display helpers for foreign-currency costs (FX feature spec §UI/UX): the converted line, the rate tooltip, the
 * missing-rate texts and the dialog's rate hint. Client-safe and free of React. Every text goes through `t(key, fallback)`.
 * The read APIs decide who gets a rate: these helpers only render what a full (`cpq.costs.view`) projection carries.
 */

export type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type FxErrorDetail = { code: string; from: string; to: string; date: string }

/** The FX snapshot fields of a full cost projection (quote, order, inventory, preview). All optional: absent = no FX. */
export type FxFields = {
  fxRate?: string | null
  fxRateDate?: string | null
  fxRateSource?: string | null
  fxRateDerivation?: string | null
  convertedInstanceAmount?: string | null
  /** Quote costs only: lets a `per_unit` row show the converted unit amount next to the unit amount. */
  costModel?: string | null
  unitAmount?: string | null
  quoteCurrencyCode?: string | null
  errorDetail?: FxErrorDetail | null
}

/** "0.92000000" -> "0.92"; keeps at most 8 decimals and never shows an exponent. */
export function formatRate(rate: string | number | null | undefined): string | null {
  if (rate === null || rate === undefined || rate === '') return null
  const value = Number(rate)
  if (!Number.isFinite(value)) return null
  return value.toFixed(8).replace(/\.?0+$/, '')
}

/** "276" -> "276.00"; grouping like the rest of the page (en-US). `null` for a missing or non-numeric amount. */
export function formatAmount(amount: string | number | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export const hasFxRate = (cost: FxFields): boolean => cost.fxRate !== null && cost.fxRate !== undefined && cost.fxRate !== ''

export type ConvertedLine = {
  /** "≈ 276.00 EUR" (omitted when the converted amount or the currency is unknown). */
  converted: string | null
  /** "0.92 · ECB · 2026-11-11", the "(inverse)" label after the rate when the rate was derived from the opposite pair. */
  rate: string
  /** Both joined with " · ". */
  text: string
}

/** The rate parts "0.92 (inverse) · ECB · 2026-11-11". */
export function fxRateParts(cost: FxFields, t: Translate): string {
  const rate = formatRate(cost.fxRate)
  if (!rate) return ''
  const inverse = cost.fxRateDerivation === 'inverse' ? ` ${t('cpq.fx.inverse', '(inverse)')}` : ''
  return [`${rate}${inverse}`, cost.fxRateSource, cost.fxRateDate].filter((part): part is string => Boolean(part)).join(' · ')
}

/**
 * The second line under a converted cost value: "≈ 276.00 EUR · 0.92 · ECB · 2026-11-11". `quoteCurrency` falls back to the
 * projection's own `quoteCurrencyCode`. Null when the cost carries no rate (a quote-currency cost, or no rate found).
 *
 * A `per_unit` cost shows the value cell's UNIT amount, so its converted line reconciles with it: the converted unit amount
 * first, then the instance total: "≈ 276.00 EUR / unit · ≈ 2,760.00 EUR total · 0.92 · ...". When unit and instance
 * amounts are equal (quantity 1) the plain single amount is kept.
 */
export function formatConverted(cost: FxFields, quoteCurrency: string | null | undefined, t: Translate): ConvertedLine | null {
  if (!hasFxRate(cost)) return null
  const currency = quoteCurrency ?? cost.quoteCurrencyCode ?? null
  const total = formatAmount(cost.convertedInstanceAmount)
  const unitValue = cost.costModel === 'per_unit' && cost.unitAmount ? Number(cost.unitAmount) * Number(cost.fxRate) : null
  const unit = unitValue !== null && Number.isFinite(unitValue) ? formatAmount(unitValue) : null
  const perUnit = unit !== null && total !== null && unit !== total
  const converted = !currency
    ? null
    : perUnit
      ? `≈ ${unit} ${currency} ${t('cpq.fx.perUnit', '/ unit')} · ≈ ${total} ${currency} ${t('cpq.fx.total', 'total')}`
      : total ? `≈ ${total} ${currency}` : null
  const rate = fxRateParts(cost, t)
  return { converted, rate, text: [converted, rate].filter(Boolean).join(' · ') }
}

/**
 * Order / subscription / asset costs show the value in the document currency (`totalAmount`), so the note names where it came
 * from: "from 100.00 USD · 0.92 · ECB · 2026-11-11". Always a snapshot: never "frozen" wording.
 */
export function snapshotNote(cost: FxFields & { instanceAmount?: string | null; currencyCode?: string | null }, t: Translate): string | null {
  if (!hasFxRate(cost)) return null
  const amount = formatAmount(cost.instanceAmount)
  const origin = amount && cost.currencyCode ? t('cpq.fx.from', 'from {value} {code}', { value: amount, code: cost.currencyCode }) : null
  return [origin, fxRateParts(cost, t)].filter(Boolean).join(' · ')
}

/** Tooltip of the converted line: the rate's date / source / derivation, and the frozen note while the quote is locked. */
export function fxTooltip(cost: FxFields, opts: { locked?: boolean }, t: Translate): string | null {
  if (!hasFxRate(cost)) return null
  const detail = t('cpq.fx.tooltip.detail', 'Rate of {date} from {source} ({derivation})', {
    date: cost.fxRateDate ?? '—',
    source: cost.fxRateSource ?? '—',
    derivation: cost.fxRateDerivation === 'inverse' ? t('cpq.fx.tooltip.inverse', 'inverse of the opposite pair') : t('cpq.fx.tooltip.direct', 'direct rate'),
  })
  return opts.locked ? `${t('cpq.fx.frozen', 'Rate frozen while the quote is locked')}. ${detail}` : detail
}

/** "No USD→EUR rate for 2026-11-12" plus " (looked back 7 days)" when the look-back is known. */
export function missingRateMessage(detail: FxErrorDetail, t: Translate, maxDaysBack?: number | null): string {
  const base = t('cpq.fx.missing', 'No {from}→{to} rate for {date}', { from: detail.from, to: detail.to, date: detail.date })
  return typeof maxDaysBack === 'number'
    ? `${base} ${t('cpq.fx.lookedBack', '(looked back {days} days)', { days: maxDaysBack })}`
    : base
}

/** True for a cost line stuck on a missing rate (the redacted projection carries only this code). */
export const isMissingRate = (cost: { error?: string | null }): boolean => cost.error === 'CURRENCY_NO_RATE'

/** The text of a cost line's error: the pair-naming message when the full projection names the pair, else the plain code text. */
export function costErrorText(cost: { error?: string | null; errorDetail?: FxErrorDetail | null }, t: Translate, fallback: (code: string) => string): string | null {
  if (!cost.error) return null
  if (isMissingRate(cost) && cost.errorDetail) return missingRateMessage(cost.errorDetail, t)
  return t(`cpq.quoteCosts.errors.${cost.error}`, fallback(cost.error))
}

/**
 * Whether the redacted "Cost pending — currency rate missing" badge replaces the generic "Cost pending" one: every pending
 * line is pending only because of a missing rate. Carries no currency, so non-holders learn nothing more than the code.
 */
export function pendingIsRateOnly(costs: ReadonlyArray<{ valueStatus: string; error?: string | null }>): boolean {
  const pending = costs.filter((cost) => cost.valueStatus === 'none')
  return pending.length > 0 && pending.every(isMissingRate)
}

/** The hint `cost-preview` answers for the dialog's currency (`fxHint`). Null/absent = same currency or unavailable. */
export type FxHint = FxFields & { from: string; to: string; error?: string }

/** The dialog's read-only hint under the currency field; null when there is nothing to say. */
export function fxHintMessage(hint: FxHint | null | undefined, t: Translate): string | null {
  if (!hint) return null
  if (hint.error === 'CURRENCY_NO_RATE' || !hasFxRate(hint)) {
    return t('cpq.fx.hint.noRate', 'No {from}→{to} rate maintained — the line will stay not ready until a rate is entered in Currencies', { from: hint.from, to: hint.to })
  }
  const inverse = hint.fxRateDerivation === 'inverse' ? ` ${t('cpq.fx.inverse', '(inverse)')}` : ''
  return t('cpq.fx.hint.rate', 'Converted at the latest rate on save (currently {rate}{inverse} from {source}, {date})', {
    rate: formatRate(hint.fxRate) ?? '', inverse, source: hint.fxRateSource ?? '—', date: hint.fxRateDate ?? '—',
  })
}

/** A currency worth asking the preview about: three letters and not the quote currency. */
export const isHintableCurrency = (currency: string, quoteCurrency: string): boolean => /^[A-Z]{3}$/.test(currency) && currency !== quoteCurrency
