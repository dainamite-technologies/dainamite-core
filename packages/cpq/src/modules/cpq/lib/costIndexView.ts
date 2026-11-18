/**
 * Pure view helpers for the cost index pages (index-costs spec §UI/UX): list / detail shapes, the CSV → import body
 * parser, error-code messages and value-list helpers. Client-safe (no service imports). The API stays the authority;
 * this only decides what to show and shapes the request.
 */

// ─── API shapes ─────────────────────────────────────────────────

export type CostIndexCurrent = { effectiveDate: string; value: string; revision: number }

export type CostIndexItem = {
  id: string
  code: string
  name: string
  unit: string
  currencyCode: string
  description: string | null
  isActive: boolean
}

export type CostIndexListRow = CostIndexItem & { current: CostIndexCurrent | null; elementCount: number }

export type CostIndexElementRef = {
  id: string
  code: string
  name: string
  role: string
  productChargeId: string
  chargeCode: string | null
  isActive: boolean
}

export type CostIndexDetail = {
  item: CostIndexItem
  current: CostIndexCurrent | null
  futureValueCount: number
  elements: CostIndexElementRef[]
}

export type CostIndexValueRow = {
  id: string
  effectiveDate: string
  value: string
  revision: number
  sourceNote: string | null
  createdByUserId: string | null
  createdAt: string
  inForceToday: boolean
  superseded: boolean
  future: boolean
}

// ─── Formatting ─────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-10` → `10 Nov 2026` (no timezone shift: the date is a plain calendar day). */
export function formatIndexDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : isoDate
}

/** Index values are stored with up to 6 decimals; show at least 2 and drop trailing zeros beyond that. */
export function formatIndexValue(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text
  const [whole, fraction = ''] = text.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  return `${whole}.${trimmed.padEnd(2, '0')}`
}

/** "82.40 · 10 Nov 2026 · r2", or null when the index has no value in force yet (callers show "No value yet"). */
export function formatCurrentValue(current: CostIndexCurrent | null): string | null {
  if (!current) return null
  return `${formatIndexValue(current.value)} · ${formatIndexDate(current.effectiveDate)} · r${current.revision}`
}

// ─── Value list helpers ─────────────────────────────────────────

export type ValueBadge = 'inForce' | 'future' | 'superseded'

export const VALUE_BADGE_FALLBACKS: Record<ValueBadge, string> = {
  inForce: 'In force today',
  future: 'Future',
  superseded: 'Superseded',
}

export const VALUE_BADGE_VARIANTS: Record<ValueBadge, 'success' | 'info' | 'neutral'> = {
  inForce: 'success',
  future: 'info',
  superseded: 'neutral',
}

/** Badges of one value row, in display order. A superseded row is never "in force". */
export function valueBadges(row: Pick<CostIndexValueRow, 'inForceToday' | 'superseded' | 'future'>): ValueBadge[] {
  const badges: ValueBadge[] = []
  if (row.inForceToday && !row.superseded) badges.push('inForce')
  if (row.future) badges.push('future')
  if (row.superseded) badges.push('superseded')
  return badges
}

export type ValueDateGroup = { effectiveDate: string; latest: CostIndexValueRow; corrections: CostIndexValueRow[] }

/**
 * Group a value list (API order: effective date desc, revision desc) by effective date: the highest revision is
 * `latest`, older revisions of the date are its `corrections`. Order of first appearance is kept.
 */
export function groupValuesByDate(rows: readonly CostIndexValueRow[]): ValueDateGroup[] {
  const groups = new Map<string, ValueDateGroup>()
  for (const row of rows) {
    const group = groups.get(row.effectiveDate)
    if (!group) {
      groups.set(row.effectiveDate, { effectiveDate: row.effectiveDate, latest: row, corrections: [] })
      continue
    }
    if (row.revision > group.latest.revision) {
      group.corrections.push(group.latest)
      group.latest = row
    } else {
      group.corrections.push(row)
    }
    group.corrections.sort((a, b) => b.revision - a.revision)
  }
  return [...groups.values()]
}

export type SameDateNotice = { nextRevision: number; replaces: string }

/** The "creates revision n+1 and replaces X" notice for a date that already has a value; null when the date is new. */
export function sameDateNotice(existingLatest: Pick<CostIndexValueRow, 'revision' | 'value'> | null | undefined): SameDateNotice | null {
  if (!existingLatest) return null
  return { nextRevision: existingLatest.revision + 1, replaces: formatIndexValue(existingLatest.value) }
}

// ─── Forms ──────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE_DECIMAL_RE = /^\d+(\.\d{1,6})?$/
const CODE_RE = /^[A-Z0-9_-]{2,40}$/
const CURRENCY_RE = /^[A-Z]{3}$/

export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isPositiveIndexValue(value: string): boolean {
  return POSITIVE_DECIMAL_RE.test(value.trim()) && Number(value) > 0 && Number(value) <= 999_999_999_999
}

export type IndexFormIssue = 'code' | 'name' | 'unit' | 'currency'

export type CreateIndexForm = { code: string; name: string; unit: string; currencyCode: string; description: string }

export const emptyCreateIndexForm = (currencyCode = ''): CreateIndexForm => ({ code: '', name: '', unit: '', currencyCode, description: '' })

export const INDEX_FORM_ISSUE_FALLBACKS: Record<IndexFormIssue, string> = {
  code: 'Code: 2 to 40 characters, A-Z, 0-9, _ or -',
  name: 'Name is required',
  unit: 'Unit is required (for example EUR/MWh)',
  currency: 'Currency must be a 3-letter ISO code',
}

export function createIndexFormIssues(form: CreateIndexForm): IndexFormIssue[] {
  const issues: IndexFormIssue[] = []
  if (!CODE_RE.test(form.code.trim())) issues.push('code')
  if (!form.name.trim()) issues.push('name')
  if (!form.unit.trim()) issues.push('unit')
  if (!CURRENCY_RE.test(form.currencyCode.trim())) issues.push('currency')
  return issues
}

export function buildCreateIndexBody(form: CreateIndexForm) {
  const description = form.description.trim()
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    unit: form.unit.trim(),
    currencyCode: form.currencyCode.trim(),
    ...(description ? { description } : {}),
  }
}

export type ValueFormIssue = 'date' | 'value'

export type AddValueForm = { effectiveDate: string; value: string; sourceNote: string }

export const emptyAddValueForm = (today: string): AddValueForm => ({ effectiveDate: today, value: '', sourceNote: '' })

export const VALUE_FORM_ISSUE_FALLBACKS: Record<ValueFormIssue, string> = {
  date: 'Enter a valid effective date',
  value: 'Value must be greater than 0 (up to 6 decimals)',
}

export function addValueFormIssues(form: AddValueForm): ValueFormIssue[] {
  const issues: ValueFormIssue[] = []
  if (!isRealIsoDate(form.effectiveDate)) issues.push('date')
  if (!isPositiveIndexValue(form.value)) issues.push('value')
  return issues
}

export function buildAddValueBody(form: AddValueForm) {
  const sourceNote = form.sourceNote.trim()
  return { effectiveDate: form.effectiveDate, value: Number(form.value), ...(sourceNote ? { sourceNote } : {}) }
}

// ─── CSV import ─────────────────────────────────────────────────

export const IMPORT_MAX_ROWS = 1000

export type ImportItem = { indexCode: string; effectiveDate: string; value: number; sourceNote?: string }
export type CsvIssueCode = 'EMPTY' | 'TOO_MANY_ROWS' | 'BAD_COLUMNS' | 'BAD_DATE' | 'BAD_VALUE'
export type CsvIssue = { line: number; code: CsvIssueCode }
export type CsvParseResult = {
  items: ImportItem[]
  /** `lines[i]` is the 1-based source line of `items[i]` (server row `i + 1`), so row errors map back to the text. */
  lines: number[]
  issues: CsvIssue[]
}

/** Split one CSV record, honouring double-quoted fields (`""` escapes a quote). */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { cells.push(current); current = '' }
    else current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

/** Pasted spreadsheet cells are tab-separated; files are comma-separated; some locales export semicolons. */
function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t'
  const semicolons = (line.match(/;/g) ?? []).length
  const commas = (line.match(/,/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

/**
 * Parse `indexCode,effectiveDate,value,note` text (header line optional) into the import body items. Pure and total:
 * problems come back as `issues` with the source line, never as an exception.
 */
export function parseIndexValuesCsv(text: string): CsvParseResult {
  const items: ImportItem[] = []
  const lines: number[] = []
  const issues: CsvIssue[] = []
  const rawLines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  let delimiter: string | null = null
  let sawRecord = false
  rawLines.forEach((raw, index) => {
    if (!raw.trim()) return
    const lineNo = index + 1
    delimiter ??= detectDelimiter(raw)
    const cells = splitCsvLine(raw, delimiter)
    if (!sawRecord) {
      sawRecord = true
      if (cells[0]?.toLowerCase() === 'indexcode') return // header
    }
    if (cells.length < 3 || cells.length > 4) { issues.push({ line: lineNo, code: 'BAD_COLUMNS' }); return }
    const [indexCode, effectiveDate, value, note] = cells
    if (!indexCode) { issues.push({ line: lineNo, code: 'BAD_COLUMNS' }); return }
    if (!isRealIsoDate(effectiveDate)) { issues.push({ line: lineNo, code: 'BAD_DATE' }); return }
    if (!isPositiveIndexValue(value)) { issues.push({ line: lineNo, code: 'BAD_VALUE' }); return }
    items.push({ indexCode, effectiveDate, value: Number(value), ...(note ? { sourceNote: note } : {}) })
    lines.push(lineNo)
  })
  if (items.length === 0 && issues.length === 0) issues.push({ line: 0, code: 'EMPTY' })
  if (items.length > IMPORT_MAX_ROWS) issues.push({ line: 0, code: 'TOO_MANY_ROWS' })
  return { items, lines, issues }
}

export const CSV_ISSUE_FALLBACKS: Record<CsvIssueCode, string> = {
  EMPTY: 'Paste or upload at least one row',
  TOO_MANY_ROWS: `An import takes at most ${IMPORT_MAX_ROWS} rows`,
  BAD_COLUMNS: 'Expected indexCode, effectiveDate, value and an optional note',
  BAD_DATE: 'Effective date must be a valid YYYY-MM-DD date',
  BAD_VALUE: 'Value must be greater than 0 (up to 6 decimals)',
}

// ─── Import responses ───────────────────────────────────────────

export type ImportRowResult = { row: number; indexCode: string; effectiveDate: string; status: 'created' | 'unchanged'; revision: number }
export type ImportRowError = { row: number; code: string; indexCode?: string }

export type ImportPreviewSummary = { created: number; unchanged: number }

export function summarizeImport(results: readonly ImportRowResult[]): ImportPreviewSummary {
  let created = 0
  let unchanged = 0
  for (const result of results) {
    if (result.status === 'created') created++
    else unchanged++
  }
  return { created, unchanged }
}

/** Server row errors with the pasted-text line they came from (row is 1-based into `lines`). */
export function importErrorLines(errors: readonly ImportRowError[], lines: readonly number[]): Array<ImportRowError & { line: number | null }> {
  return errors.map((error) => ({ ...error, line: lines[error.row - 1] ?? null }))
}

/** Row errors of a `422 IMPORT_VALIDATION_FAILED` body; empty for any other body. */
export function readImportErrors(body: unknown): ImportRowError[] {
  const errors = (body as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((entry): ImportRowError[] => {
    const record = entry as { row?: unknown; code?: unknown; indexCode?: unknown } | null
    if (!record || typeof record.row !== 'number' || typeof record.code !== 'string') return []
    return [{ row: record.row, code: record.code, ...(typeof record.indexCode === 'string' ? { indexCode: record.indexCode } : {}) }]
  })
}

// ─── Error codes ────────────────────────────────────────────────

export const COST_INDEX_ERROR_FALLBACKS: Record<string, string> = {
  INDEX_IN_USE: 'Cost elements still use this index. Switch them to another source first.',
  INDEX_CURRENCY_LOCKED: 'The currency cannot change once the index has values or elements.',
  CODE_IMMUTABLE: 'The code of an index cannot be changed.',
  DUPLICATE_CODE: 'An index with this code already exists.',
  UNKNOWN_CURRENCY: 'Unknown currency code.',
  INDEX_INACTIVE: 'This index is inactive. Reactivate it first.',
  CONCURRENT_INDEX_WRITE: 'Someone else just added a value — retry.',
  IMPORT_VALIDATION_FAILED: 'Some rows are invalid. Nothing was imported.',
  UNKNOWN_INDEX: 'No index with this code',
  INVALID_VALUE: 'Value must be greater than 0',
  DUPLICATE_ROW: 'Duplicate row for the same index and date',
  FORBIDDEN: 'You do not have permission to do this.',
  VALIDATION: 'Please check the entered values.',
  COST_PLUS_DISABLED: 'Cost-plus pricing is off for this tenant.',
}

export const COST_PLUS_OFF_FALLBACK = 'Cost-plus pricing is off for this tenant.'

export const costIndexErrorFallback = (code: string): string => COST_INDEX_ERROR_FALLBACKS[code] ?? code

export type CostIndexFailure = {
  code: string
  /** Referencing elements of an `INDEX_IN_USE` refusal. */
  elements: CostIndexElementRef[]
  /** The tenant has cost-plus switched off (the API answers a bare `404 Not found`). */
  toggleOff: boolean
}

/** Classify a failed index API call into a stable code plus the details the UI renders inline. */
export function classifyIndexError(status: number, body: unknown): CostIndexFailure {
  const record = (body ?? {}) as { error?: unknown; elements?: unknown }
  const error = typeof record.error === 'string' ? record.error : ''
  const elements = Array.isArray(record.elements) ? (record.elements as CostIndexElementRef[]) : []
  if (status === 404 && error === 'Not found') return { code: 'COST_PLUS_DISABLED', elements: [], toggleOff: true }
  if (/^[A-Z][A-Z_]+$/.test(error)) return { code: error, elements, toggleOff: false }
  if (status === 403) return { code: 'FORBIDDEN', elements: [], toggleOff: false }
  if (status === 409) return { code: 'CONCURRENT_INDEX_WRITE', elements: [], toggleOff: false }
  if (status === 400) return { code: 'VALIDATION', elements: [], toggleOff: false }
  return { code: error || 'UNKNOWN', elements, toggleOff: false }
}

/** Deep link to the charge editor of an element's offering / specification is resolved by the page; the charge id is the anchor. */
export function elementChargeLabel(element: Pick<CostIndexElementRef, 'chargeCode' | 'name'>): string {
  return element.chargeCode ? `${element.chargeCode} · ${element.name}` : element.name
}
