import {
  MAX_PHASES_PER_ITEM,
  resolvePhases,
  validatePhaseSchedule,
  type PhaseDefinition,
  type PhaseDurationUnit,
  type PhasePriceType,
  type PhaseScheduleIssue,
} from './pricePhases'
import type { PhaseRow } from './itemStatusLabel'

/**
 * Form state of the price-phase editor (price-phases spec §4.1) and its
 * conversions: API read rows → editor rows → the `phases[]` payload of
 * `POST` / `PUT /api/billing/items` (contract C1). Pure — the editor
 * component only renders these rows.
 */

export type PhaseEditorRow = {
  /** Stable React key (not sent). */
  key: string
  name: string
  /** `duration` = count + unit from the phase start; `until` = an inclusive end date. */
  mode: 'duration' | 'until'
  durationCount: string
  durationUnit: PhaseDurationUnit
  untilDate: string
  priceType: PhasePriceType
  value: string
}

/** Payload shape of one phase (`billingItemPhaseInputSchema`). */
export type PhasePayload = {
  name?: string | null
  durationUnit?: PhaseDurationUnit
  durationCount?: number
  endDate?: string
  priceType: PhasePriceType
  value?: number | null
}

let keySeq = 0
function nextKey(): string {
  keySeq += 1
  return `phase-${keySeq}`
}

export function newPhaseRow(partial: Partial<PhaseEditorRow> = {}): PhaseEditorRow {
  return {
    key: nextKey(),
    name: '',
    mode: 'duration',
    durationCount: '1',
    durationUnit: 'month',
    untilDate: '',
    priceType: 'free',
    value: '',
    ...partial,
  }
}

/** Editor rows from the items list API `phases[]` (ordered by `sequence`). */
export function phaseRowsFromApi(rows: readonly PhaseRow[] | null | undefined): PhaseEditorRow[] {
  if (!rows) return []
  return rows
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((row) =>
      newPhaseRow({
        name: row.name ?? '',
        mode: row.untilDate || !row.durationUnit ? 'until' : 'duration',
        durationCount: row.durationCount != null ? String(row.durationCount) : '1',
        durationUnit: row.durationUnit ?? 'month',
        untilDate: (row.untilDate ?? row.endDate ?? '').slice(0, 10),
        priceType: row.priceType,
        value: row.priceType === 'free' || row.value == null ? '' : String(row.value),
      }),
    )
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function parseCount(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number.NaN
}

/** The `phases[]` payload for editor rows (keys dropped, free phases carry no value). */
export function phaseRowsToPayload(rows: readonly PhaseEditorRow[]): PhasePayload[] {
  return rows.map((row) => {
    const out: PhasePayload = { priceType: row.priceType }
    const name = row.name.trim()
    out.name = name ? name : null
    if (row.mode === 'until') {
      out.endDate = row.untilDate
    } else {
      out.durationUnit = row.durationUnit
      out.durationCount = parseCount(row.durationCount)
    }
    out.value = row.priceType === 'free' ? null : parseNumber(row.value)
    return out
  })
}

function toDefinitions(rows: readonly PhaseEditorRow[]): PhaseDefinition[] {
  return phaseRowsToPayload(rows).map((p) => ({
    name: p.name,
    durationUnit: p.durationUnit ?? null,
    durationCount: p.durationCount ?? null,
    endDate: p.endDate || null,
    priceType: p.priceType,
    value: p.value ?? null,
  }))
}

/** First structural problem of the schedule (same checks as the server), or null. */
export function validatePhaseRows(billStartDate: string | null, rows: readonly PhaseEditorRow[]): PhaseScheduleIssue | null {
  if (rows.length === 0) return { index: 0, path: 'phases', message: 'Add at least one phase' }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.mode === 'until' && !/^\d{4}-\d{2}-\d{2}$/.test(row.untilDate)) {
      return { index, path: 'endDate', message: 'Pick the last day of the phase' }
    }
  }
  return validatePhaseSchedule(billStartDate || null, toDefinitions(rows))
}

/**
 * Computed `[start, end]` (YYYY-MM-DD, inclusive) per editor row, back to back
 * from the bill start. A row that cannot be resolved yet (incomplete, or an
 * "until" date before its start) gets null and breaks the chain after it.
 */
export function phaseRowRanges(
  billStartDate: string | null,
  rows: readonly PhaseEditorRow[],
): Array<{ start: string; end: string } | null> {
  if (!billStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(billStartDate)) return rows.map(() => null)
  const out: Array<{ start: string; end: string } | null> = []
  const defs = toDefinitions(rows)
  for (let i = 0; i < rows.length; i++) {
    // Resolve the prefix: a dropped phase would silently shift later ones.
    const resolved = resolvePhases(billStartDate, defs.slice(0, i + 1))
    if (resolved.length !== i + 1) {
      while (out.length < rows.length) out.push(null)
      break
    }
    const last = resolved[i]
    out.push({ start: last.start.toISOString().slice(0, 10), end: last.end.toISOString().slice(0, 10) })
  }
  return out
}

/** Move a row up / down; out-of-range moves return the same rows. */
export function movePhaseRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return rows.slice()
  const next = rows.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function canAddPhase(rows: readonly unknown[]): boolean {
  return rows.length < MAX_PHASES_PER_ITEM
}

/** True when two schedules send the same payload (used to skip an unchanged `phases` on edit). */
export function samePhasePayload(a: readonly PhaseEditorRow[], b: readonly PhaseEditorRow[]): boolean {
  return JSON.stringify(phaseRowsToPayload(a)) === JSON.stringify(phaseRowsToPayload(b))
}
