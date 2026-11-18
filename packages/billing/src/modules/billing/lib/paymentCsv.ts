import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PAYMENT_IMPORT_MAX_ROWS } from '../data/validators'

/**
 * Bank payment CSV parser (Spec C, demo-grade fixed format). Pure.
 *
 *   date,amount,currency,reference,payer_name,payer_account
 *   2026-11-20,123.00,PLN,"Payment for INV/2026/11/0003",ACME Sp. z o.o.,PL61…
 *
 * UTF-8 (BOM tolerated), comma separated, RFC-4180 quoting (`""` escapes,
 * commas and newlines inside quotes), header required, `.` decimal
 * separator, amount > 0 (refunds are out of scope), ≤ 5,000 data rows.
 * Invalid rows are reported with their line number and skipped; they never
 * abort the file.
 */

export const PAYMENT_CSV_HEADER = ['date', 'amount', 'currency', 'reference', 'payer_name', 'payer_account'] as const

export type PaymentCsvRow = {
  line: number
  receivedAt: string
  amount: string
  currency: string
  reference: string | null
  payerName: string | null
  payerAccount: string | null
}

export type PaymentCsvResult = {
  rows: PaymentCsvRow[]
  errors: Array<{ row: number; message: string }>
  fatal: string | null
}

const rowSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'date is not a valid day'),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'amount must be a positive number with "." as decimal separator')
    .refine((value) => Number.parseFloat(value) > 0, 'amount must be greater than 0'),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code'),
  reference: z.string().max(500, 'reference is longer than 500 characters'),
  payer_name: z.string().max(255),
  payer_account: z.string().max(64),
})

/** Splits CSV text into records of fields (RFC 4180). Returns the 1-based start line of each record. */
export function splitCsv(text: string): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  const pushRecord = () => {
    fields.push(field)
    if (!(fields.length === 1 && fields[0].trim() === '')) records.push({ line: recordLine, fields })
    fields = []
    field = ''
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        if (char === '\n') line += 1
        field += char
      }
      continue
    }
    if (char === '"' && field.trim() === '') {
      field = ''
      inQuotes = true
    } else if (char === ',') {
      fields.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      pushRecord()
      line += 1
      recordLine = line
    } else {
      field += char
    }
  }
  if (field !== '' || fields.length > 0) pushRecord()
  return records
}

export function parsePaymentCsv(text: string): PaymentCsvResult {
  const records = splitCsv(text.replace(/^﻿/, ''))
  if (records.length === 0) return { rows: [], errors: [], fatal: 'The file is empty' }
  const header = records[0].fields.map((f) => f.trim().toLowerCase())
  if (header.join(',') !== PAYMENT_CSV_HEADER.join(',')) {
    return { rows: [], errors: [], fatal: `The header must be: ${PAYMENT_CSV_HEADER.join(',')}` }
  }
  const data = records.slice(1)
  if (data.length > PAYMENT_IMPORT_MAX_ROWS) {
    return { rows: [], errors: [], fatal: `The file has more than ${PAYMENT_IMPORT_MAX_ROWS} rows` }
  }
  const rows: PaymentCsvRow[] = []
  const errors: PaymentCsvResult['errors'] = []
  for (const record of data) {
    if (record.fields.length !== PAYMENT_CSV_HEADER.length) {
      errors.push({ row: record.line, message: `expected ${PAYMENT_CSV_HEADER.length} columns, got ${record.fields.length}` })
      continue
    }
    const raw = Object.fromEntries(PAYMENT_CSV_HEADER.map((key, i) => [key, record.fields[i].trim()]))
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ row: record.line, message: parsed.error.issues.map((issue) => issue.message).join('; ') })
      continue
    }
    rows.push({
      line: record.line,
      receivedAt: parsed.data.date,
      amount: Number.parseFloat(parsed.data.amount).toFixed(4),
      currency: parsed.data.currency.toUpperCase(),
      reference: parsed.data.reference || null,
      payerName: parsed.data.payer_name || null,
      payerAccount: parsed.data.payer_account ? parsed.data.payer_account.replace(/\s+/g, '').toUpperCase() : null,
    })
  }
  return { rows, errors, fatal: null }
}

/**
 * Duplicate guard (P-D7): the same bank line uploaded again yields the same
 * key; identical lines inside one file differ by their occurrence index.
 */
export function paymentSourceRef(
  scope: { tenantId: string; organizationId: string },
  row: Pick<PaymentCsvRow, 'receivedAt' | 'amount' | 'currency' | 'reference' | 'payerAccount'>,
  occurrence: number,
): string {
  const key = [
    scope.tenantId,
    scope.organizationId,
    row.receivedAt,
    row.amount,
    row.currency,
    row.reference ?? '',
    row.payerAccount ?? '',
    String(occurrence),
  ].join('|')
  return `csv:${createHash('sha256').update(key).digest('hex')}`
}

/** Source refs for all rows of a file, counting identical lines (occurrence index). */
export function sourceRefsForRows(
  scope: { tenantId: string; organizationId: string },
  rows: PaymentCsvRow[],
): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const identity = [row.receivedAt, row.amount, row.currency, row.reference ?? '', row.payerAccount ?? ''].join('|')
    const occurrence = (seen.get(identity) ?? 0) + 1
    seen.set(identity, occurrence)
    return paymentSourceRef(scope, row, occurrence)
  })
}
