// Browser-side Excel export for pricing tables.
//
// Single sheet, dimensions-as-columns per user spec. Tier columns are
// emitted only when at least one entry is tiered, to keep the file
// uncluttered for dimensions-only tables. Each price column becomes one
// numeric column.

import * as XLSX from 'xlsx'

type Dimension = { key: string; label: string }
type PriceColumn = { key: string; label: string }

type Entry = {
  id: string
  dimensionValues: Record<string, string>
  tierNumber: number | null
  rangeFrom: string | null
  rangeTo: string | null
  currencyCode: string
  prices: Record<string, number>
}

type Table = {
  code: string
  name: string
  dimensions: Dimension[]
  priceColumns: PriceColumn[]
  currencyCodeList: string[]
}

export function exportPricingTableToXlsx(table: Table, entries: Entry[]): void {
  const hasTiers = entries.some((e) => e.tierNumber != null)

  // Column order: id, [tier columns?], dimensions, price columns, currency.
  // The id column is intentionally last-of-leading so it doesn't bury data,
  // but kept exposed so a future re-import can match rows by UUID.
  const headers: string[] = ['id']
  if (hasTiers) {
    headers.push('tier_number', 'range_from', 'range_to')
  }
  for (const d of table.dimensions) headers.push(d.key)
  for (const c of table.priceColumns) headers.push(c.key)
  headers.push('currency_code')

  const rows: Array<Record<string, unknown>> = entries.map((e) => {
    const row: Record<string, unknown> = { id: e.id }
    if (hasTiers) {
      row.tier_number = e.tierNumber ?? ''
      row.range_from = e.rangeFrom ?? ''
      row.range_to = e.rangeTo ?? ''
    }
    for (const d of table.dimensions) {
      row[d.key] = e.dimensionValues?.[d.key] ?? ''
    }
    for (const c of table.priceColumns) {
      row[c.key] = e.prices?.[c.key] ?? ''
    }
    row.currency_code = e.currencyCode
    return row
  })

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers })

  // Replace technical keys with human labels in the header row so the file
  // reads naturally in Excel. The first row is the only one with labels;
  // keep `id` / tier_* / currency_code as-is because they have no label.
  const labelRow: Record<string, string> = {}
  for (const d of table.dimensions) labelRow[d.key] = d.label
  for (const c of table.priceColumns) labelRow[c.key] = c.label
  XLSX.utils.sheet_add_aoa(
    worksheet,
    [headers.map((h) => labelRow[h] ?? h)],
    { origin: 'A1' },
  )

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetSafeName(table.code || table.name || 'Pricing'))

  const filename = `${slugForFile(table.code || table.name || 'pricing-table')}.xlsx`
  XLSX.writeFile(workbook, filename)
}

// Excel sheet names: max 31 chars, no `[]:*?/\`.
function sheetSafeName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31)
}

function slugForFile(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_.]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'pricing-table'
}
