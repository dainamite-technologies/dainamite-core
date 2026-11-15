// Browser-side Excel import for pricing tables.
//
// Parses an .xlsx produced by `exportPricingTableToXlsx` (or any sheet with
// the matching column shape) and computes a diff against the current
// in-memory entries. Reconciliation key is the `id` UUID column from the
// export — rows without an id are treated as INSERTS, entries whose id is
// absent from the file are treated as DELETES.

import * as XLSX from 'xlsx'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

type Dimension = { key: string; label: string }
type PriceColumn = { key: string; label: string }

export type ImportEntry = {
  id: string
  dimensionValues: Record<string, string>
  tierNumber: number | null
  rangeFrom: string | null
  rangeTo: string | null
  currencyCode: string
  prices: Record<string, number>
}

type TableShape = {
  dimensions: Dimension[]
  priceColumns: PriceColumn[]
  currencyCodeList: string[]
}

type ParsedRow = {
  rowNumber: number // 1-indexed (excluding header)
  id: string | null
  dimensionValues: Record<string, string>
  tierNumber: number | null
  rangeFrom: string | null
  rangeTo: string | null
  currencyCode: string
  prices: Record<string, number>
}

export type ImportDiff = {
  inserts: ParsedRow[]
  updates: Array<{ before: ImportEntry; after: ParsedRow }>
  deletes: ImportEntry[]
  unchanged: ImportEntry[]
  warnings: string[]
}

export type ImportResult =
  | { ok: true; diff: ImportDiff }
  | { ok: false; error: string }

export async function parsePricingTableXlsx(
  file: File,
  table: TableShape,
  existingEntries: ImportEntry[],
  t: TranslateFn,
): Promise<ImportResult> {
  let workbook: XLSX.WorkBook
  try {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: 'array' })
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? t('cpq.pricing.import.errors.readFailedWithReason', 'Failed to read file: {reason}', { reason: err.message })
        : t('cpq.pricing.import.errors.readFailed', 'Failed to read file'),
    }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { ok: false, error: t('cpq.pricing.import.errors.noSheets', 'Workbook has no sheets') }
  const sheet = workbook.Sheets[sheetName]

  // Two-row header strategy: row 1 is human labels (from export), row 2+ is
  // data. But during round-trip the original technical keys are not in the
  // file — only labels. Re-derive keys from the table's `dimensions` and
  // `priceColumns` by matching labels first; fall back to keys for the
  // fixed columns (id, tier_number, range_from, range_to, currency_code).
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false, // keep strings, parse numbers ourselves
  })

  if (rows.length === 0) {
    return { ok: false, error: t('cpq.pricing.import.errors.noDataRows', 'Sheet has no data rows') }
  }

  // Build label→key map for dimensions and price columns so we can match
  // either the label or the technical key (both are valid header forms).
  const headerToKey = new Map<string, { kind: 'dimension' | 'price'; key: string }>()
  for (const d of table.dimensions) {
    headerToKey.set(d.label.toLowerCase(), { kind: 'dimension', key: d.key })
    headerToKey.set(d.key.toLowerCase(), { kind: 'dimension', key: d.key })
  }
  for (const c of table.priceColumns) {
    headerToKey.set(c.label.toLowerCase(), { kind: 'price', key: c.key })
    headerToKey.set(c.key.toLowerCase(), { kind: 'price', key: c.key })
  }

  // Inspect first row to discover which technical keys each column maps to.
  const firstRow = rows[0]
  const headers = Object.keys(firstRow)
  const dimensionHeaders: Array<{ header: string; key: string }> = []
  const priceHeaders: Array<{ header: string; key: string }> = []
  let idHeader: string | null = null
  let tierHeader: string | null = null
  let rangeFromHeader: string | null = null
  let rangeToHeader: string | null = null
  let currencyHeader: string | null = null

  for (const header of headers) {
    const lower = header.trim().toLowerCase()
    if (lower === 'id') { idHeader = header; continue }
    if (lower === 'tier_number' || lower === 'tier #' || lower === 'tier number') { tierHeader = header; continue }
    if (lower === 'range_from' || lower === 'range from') { rangeFromHeader = header; continue }
    if (lower === 'range_to' || lower === 'range to') { rangeToHeader = header; continue }
    if (lower === 'currency_code' || lower === 'currency code' || lower === 'currency') { currencyHeader = header; continue }
    const mapped = headerToKey.get(lower)
    if (!mapped) continue // unknown column — silently ignored (with warning later)
    if (mapped.kind === 'dimension') dimensionHeaders.push({ header, key: mapped.key })
    else priceHeaders.push({ header, key: mapped.key })
  }

  const warnings: string[] = []

  // Unknown columns → warning (not error — Excel files often have stray
  // columns from user notes).
  const knownHeaders = new Set<string>([
    idHeader,
    tierHeader,
    rangeFromHeader,
    rangeToHeader,
    currencyHeader,
    ...dimensionHeaders.map((d) => d.header),
    ...priceHeaders.map((p) => p.header),
  ].filter((h): h is string => h !== null))
  for (const h of headers) {
    if (!knownHeaders.has(h)) warnings.push(t('cpq.pricing.import.warnings.unknownColumn', 'Ignored unknown column "{column}"', { column: h }))
  }

  // Missing required columns from the table → error.
  const missingDims = table.dimensions.filter((d) => !dimensionHeaders.some((h) => h.key === d.key))
  const missingPrices = table.priceColumns.filter((c) => !priceHeaders.some((h) => h.key === c.key))
  if (missingDims.length > 0) {
    return { ok: false, error: t('cpq.pricing.import.errors.missingDimensionColumns', 'Missing dimension column(s): {columns}', { columns: missingDims.map((d) => d.label).join(', ') }) }
  }
  if (missingPrices.length > 0) {
    return { ok: false, error: t('cpq.pricing.import.errors.missingPriceColumns', 'Missing price column(s): {columns}', { columns: missingPrices.map((c) => c.label).join(', ') }) }
  }
  if (!currencyHeader) {
    return { ok: false, error: t('cpq.pricing.import.errors.missingCurrencyColumn', 'Missing "currency_code" column') }
  }

  // ─── Parse rows ──────────────────────────────────────────────

  const parsed: ParsedRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const rowNumber = i + 2 // +1 for header, +1 because rows are 1-indexed in Excel

    const id = idHeader ? toStringOrNull(raw[idHeader]) : null
    const tierStr = tierHeader ? toStringOrNull(raw[tierHeader]) : null
    const rangeFromStr = rangeFromHeader ? toStringOrNull(raw[rangeFromHeader]) : null
    const rangeToStr = rangeToHeader ? toStringOrNull(raw[rangeToHeader]) : null
    const currency = toStringOrNull(raw[currencyHeader]) ?? ''

    if (!currency) {
      return { ok: false, error: t('cpq.pricing.import.errors.rowMissingCurrency', 'Row {row}: missing currency_code', { row: rowNumber }) }
    }
    if (!table.currencyCodeList.includes(currency.toUpperCase())) {
      return { ok: false, error: t('cpq.pricing.import.errors.rowCurrencyNotAllowed', 'Row {row}: currency "{currency}" is not in the table\'s currency list ({currencies})', { row: rowNumber, currency, currencies: table.currencyCodeList.join(', ') }) }
    }

    const tierNumber = tierStr ? Number(tierStr) : null
    if (tierNumber !== null && Number.isNaN(tierNumber)) {
      return { ok: false, error: t('cpq.pricing.import.errors.rowTierNotNumber', 'Row {row}: tier_number must be a number, got "{value}"', { row: rowNumber, value: tierStr ?? '' }) }
    }

    const dimensionValues: Record<string, string> = {}
    for (const { header, key } of dimensionHeaders) {
      dimensionValues[key] = toStringOrNull(raw[header]) ?? ''
    }

    const prices: Record<string, number> = {}
    for (const { header, key } of priceHeaders) {
      const v = raw[header]
      if (v === '' || v === null || v === undefined) {
        prices[key] = 0
        continue
      }
      const num = Number(v)
      if (Number.isNaN(num)) {
        return { ok: false, error: t('cpq.pricing.import.errors.rowPriceNotNumber', 'Row {row}: price column "{column}" must be a number, got "{value}"', { row: rowNumber, column: header, value: String(v) }) }
      }
      prices[key] = num
    }

    parsed.push({
      rowNumber,
      id,
      dimensionValues,
      tierNumber,
      rangeFrom: rangeFromStr,
      rangeTo: rangeToStr,
      currencyCode: currency.toUpperCase(),
      prices,
    })
  }

  // ─── Compute diff ────────────────────────────────────────────

  const existingById = new Map<string, ImportEntry>(existingEntries.map((e) => [e.id, e]))
  const fileIds = new Set<string>(parsed.map((p) => p.id).filter((id): id is string => !!id))

  const inserts: ParsedRow[] = []
  const updates: Array<{ before: ImportEntry; after: ParsedRow }> = []
  const unchanged: ImportEntry[] = []

  for (const row of parsed) {
    if (!row.id) {
      inserts.push(row)
      continue
    }
    const existing = existingById.get(row.id)
    if (!existing) {
      warnings.push(t('cpq.pricing.import.warnings.idNotFound', 'Row {row}: id "{id}" not found in current entries — will be inserted as new', { row: row.rowNumber, id: row.id }))
      inserts.push({ ...row, id: null })
      continue
    }
    if (rowMatchesEntry(row, existing)) {
      unchanged.push(existing)
    } else {
      updates.push({ before: existing, after: row })
    }
  }

  const deletes = existingEntries.filter((e) => !fileIds.has(e.id))

  return {
    ok: true,
    diff: { inserts, updates, deletes, unchanged, warnings },
  }
}

// ─── Commit ────────────────────────────────────────────────────

export async function commitImportDiff(
  pricingTableId: string,
  diff: ImportDiff,
  t: TranslateFn,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // INSERTS (batch — route accepts arrays)
  if (diff.inserts.length > 0) {
    const payload = diff.inserts.map((r) => ({
      pricingTableId,
      dimensionValues: r.dimensionValues,
      tierNumber: r.tierNumber ?? undefined,
      rangeFrom: r.rangeFrom !== null ? Number(r.rangeFrom) : undefined,
      rangeTo: r.rangeTo !== null ? Number(r.rangeTo) : undefined,
      currencyCode: r.currencyCode,
      prices: r.prices,
    }))
    const res = await fetch('/api/cpq/pricing-table-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error ?? t('cpq.pricing.import.errors.insertFailed', 'Failed to insert entries') }
    }
  }

  // UPDATES (one-by-one)
  for (const { before, after } of diff.updates) {
    const res = await fetch('/api/cpq/pricing-table-entries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: before.id,
        dimensionValues: after.dimensionValues,
        tierNumber: after.tierNumber ?? null,
        rangeFrom: after.rangeFrom !== null ? Number(after.rangeFrom) : null,
        rangeTo: after.rangeTo !== null ? Number(after.rangeTo) : null,
        currencyCode: after.currencyCode,
        prices: after.prices,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error ?? t('cpq.pricing.entries.errors.updateFailed', 'Failed to update entry {id}', { id: before.id }) }
    }
  }

  // DELETES (one-by-one)
  for (const entry of diff.deletes) {
    const res = await fetch('/api/cpq/pricing-table-entries', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error ?? t('cpq.pricing.entries.errors.deleteFailed', 'Failed to delete entry {id}', { id: entry.id }) }
    }
  }

  return { ok: true }
}

// ─── helpers ───────────────────────────────────────────────────

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function rowMatchesEntry(row: ParsedRow, entry: ImportEntry): boolean {
  if (row.currencyCode !== entry.currencyCode) return false
  if ((row.tierNumber ?? null) !== (entry.tierNumber ?? null)) return false
  if (!numericEqual(row.rangeFrom, entry.rangeFrom)) return false
  if (!numericEqual(row.rangeTo, entry.rangeTo)) return false
  // dimensions
  const dimKeys = new Set([...Object.keys(row.dimensionValues), ...Object.keys(entry.dimensionValues)])
  for (const k of dimKeys) {
    if ((row.dimensionValues[k] ?? '') !== (entry.dimensionValues[k] ?? '')) return false
  }
  // prices
  const priceKeys = new Set([...Object.keys(row.prices), ...Object.keys(entry.prices)])
  for (const k of priceKeys) {
    if ((row.prices[k] ?? 0) !== (entry.prices[k] ?? 0)) return false
  }
  return true
}

function numericEqual(a: string | null, b: string | null): boolean {
  const an = a == null ? null : Number(a)
  const bn = b == null ? null : Number(b)
  if (an === null && bn === null) return true
  if (an === null || bn === null) return false
  return an === bn
}
