/**
 * Pure display helpers for index costs (index-costs spec §UI/UX): the Costs sub-panel's snapshot line and lock hint, the
 * `INDEX_NO_VALUE` badge, and the cost element dialog's read-only "Today" help. Client-safe and free of React; every text
 * goes through `t(key, fallback)`. The read APIs decide who gets a snapshot (`cpq.costs.view` only): these helpers only
 * render what a full projection carries.
 */
import { computeIndexUnitAmount, normalizeDecimal } from './indexMath'
import type { Translate } from './fxView'

/** The `index_snapshot` of a full cost projection (numbers are trimmed decimal strings). */
export type IndexSnapshotView = {
  indexId: string
  currencyCode: string
  effectiveDate: string
  revision: number
  value: string
  factor: string
  offset: string
  asOfDate: string
}

/** What the snapshot line needs to name the index: the snapshot only carries its id. */
export type IndexLabel = { code?: string | null; unit?: string | null }

export const INDEX_NO_VALUE = 'INDEX_NO_VALUE'

export const INDEX_NO_VALUE_FALLBACK = 'No index value'

/** Narrows the loosely typed `indexSnapshot` of a projection; null when absent or malformed. */
export function readIndexSnapshot(raw: unknown): IndexSnapshotView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const text = (key: string) => (typeof record[key] === 'string' && record[key] !== '' ? (record[key] as string) : null)
  const indexId = text('indexId'); const currencyCode = text('currencyCode'); const effectiveDate = text('effectiveDate')
  const value = text('value'); const factor = text('factor'); const offset = text('offset'); const asOfDate = text('asOfDate')
  const revision = Number(record.revision)
  if (!indexId || !currencyCode || !effectiveDate || !value || !factor || !offset || !asOfDate || !Number.isInteger(revision)) return null
  return { indexId, currencyCode, effectiveDate, revision, value, factor, offset, asOfDate }
}

/** "82.4" -> "82.40", "0.5" -> "0.50", "82.4125" kept; at least 2 and at most 4 decimals. */
export function formatIndexNumber(text: string | number | null | undefined): string {
  const normalized = normalizeDecimal(text, '')
  if (!normalized) return ''
  const [whole, fraction = ''] = normalized.split('.')
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 4)}`
}

/** "USD/bbl" (or just "USD" when the index has no unit). */
export function indexRateLabel(currencyCode: string, unit: string | null | undefined): string {
  return unit ? `${currencyCode}/${unit}` : currencyCode
}

/**
 * The snapshot line under an index cost value: "DEMO-DC-POWER 82.40 EUR/MWh · 2026-11-01 r2 × 0.5" (the formula's offset
 * is appended as " + 2.00" only when it is not zero). Without a label the index code and unit are left out.
 */
export function indexSnapshotLine(snapshot: IndexSnapshotView, label: IndexLabel | null | undefined, t: Translate): string {
  const head = [label?.code, `${formatIndexNumber(snapshot.value)} ${indexRateLabel(snapshot.currencyCode, label?.unit)}`].filter(Boolean).join(' ')
  const factor = `× ${normalizeDecimal(snapshot.factor, '1')}`
  const offset = Number(snapshot.offset) > 0 ? ` + ${formatIndexNumber(snapshot.offset)}` : ''
  return [head, t('cpq.indexCosts.revision', '{date} r{revision}', { date: snapshot.effectiveDate, revision: snapshot.revision }), `${factor}${offset}`].join(' · ')
}

/** Tooltip of the snapshot line: which day the value was read for, and the freeze rule while the quote is locked. */
export function indexSnapshotTooltip(snapshot: IndexSnapshotView, opts: { locked?: boolean }, t: Translate): string {
  const detail = t('cpq.indexCosts.tooltip', 'Value in force on {asOf}, effective {date} (revision {revision})', {
    asOf: snapshot.asOfDate, date: snapshot.effectiveDate, revision: snapshot.revision,
  })
  return opts.locked ? `${indexLockHint(t)}. ${detail}` : detail
}

/** The lock hint: an index line stops following the market once the cost lock applies. */
export function indexLockHint(t: Translate): string {
  return t('cpq.indexCosts.frozen', 'Frozen while the quote is locked')
}

/** An `INDEX_NO_VALUE` line (the redacted projection carries the code for everyone). */
export const hasIndexNoValue = (cost: { error?: string | null }): boolean => cost.error === INDEX_NO_VALUE

export type IndexCurrent = { effectiveDate: string; value: string; revision: number } | null

/**
 * The dialog's read-only help under the index fields: "Today: 82.40 USD/bbl (2026-11-10, r2) → unit cost 43.20 USD", or the
 * no-value warning. Null while no index is picked. The unit cost is the engine's own exact computation.
 */
export function indexTodayHelp(
  input: { current: IndexCurrent; currencyCode: string; unit?: string | null; factor: string; offset: string } | null,
  t: Translate,
): string | null {
  if (!input) return null
  if (!input.current) {
    return t('cpq.indexCosts.help.noValue', 'No value in force today — the cost stays not ready until a value is added to the index.')
  }
  const unitCost = computeIndexUnitAmount(input.current.value, input.factor.trim() || '1', input.offset.trim() || '0')
  const today = t('cpq.indexCosts.help.today', 'Today: {value} {rate} ({date}, r{revision})', {
    value: formatIndexNumber(input.current.value), rate: indexRateLabel(input.currencyCode, input.unit), date: input.current.effectiveDate, revision: input.current.revision,
  })
  if (unitCost === null) return today
  return `${today} → ${t('cpq.indexCosts.help.unitCost', 'unit cost {cost} {currency}', { cost: formatIndexNumber(unitCost), currency: input.currencyCode })}`
}
