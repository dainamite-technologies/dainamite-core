import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Document numbering (Spec 0, decision E-D6 / P-D3).
 *
 * Each series has a mask, e.g. `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}`:
 *   {YYYY} {YY} {MM} {DD}     — parts of the issue date
 *   {SEQUENCE_NUM}            — counter never resets
 *   {SEQUENCE_NUM_YEAR}       — counter resets every year
 *   {SEQUENCE_NUM_MONTH}      — counter resets every month
 *   …:N                       — optional zero-pad to N digits
 *
 * The counter row is `(tenant, org, series, scope_key)` where scope_key is
 * '' / 'YYYY' / 'YYYY-MM'. A number is claimed only at post, by one upsert
 * inside the caller's transaction — a rollback releases it (gap-free) and
 * concurrent posts serialize on the row.
 */

export const DOCUMENT_SERIES = ['invoice', 'credit_memo', 'receipt'] as const
export type DocumentSeries = (typeof DOCUMENT_SERIES)[number]

export const DEFAULT_NUMBER_MASKS: Record<DocumentSeries, string> = {
  invoice: 'INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}',
  credit_memo: 'CN/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}',
  receipt: 'RC/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}',
}

export type SequenceScope = 'none' | 'year' | 'month'

export type ParsedMask = {
  scope: SequenceScope
  pad: number
  hasYear: boolean
  hasMonth: boolean
}

export type MaskError =
  | 'mask_empty'
  | 'mask_too_long'
  | 'mask_unknown_token'
  | 'mask_missing_sequence'
  | 'mask_multiple_sequences'
  | 'mask_year_scope_needs_year'
  | 'mask_month_scope_needs_year_and_month'

export const MAX_MASK_LENGTH = 64

const TOKEN_RE = /\{([A-Z_]+)(?::(\d{1,2}))?\}/g
const DATE_TOKENS = new Set(['YYYY', 'YY', 'MM', 'DD'])
const SEQUENCE_TOKENS: Record<string, SequenceScope> = {
  SEQUENCE_NUM: 'none',
  SEQUENCE_NUM_YEAR: 'year',
  SEQUENCE_NUM_MONTH: 'month',
}

function tokensOf(mask: string): Array<{ name: string; pad: number }> {
  return Array.from(mask.matchAll(TOKEN_RE), (m) => ({ name: m[1], pad: m[2] ? Number(m[2]) : 0 }))
}

/** Validation errors for a mask; empty array = valid. */
export function validateMask(mask: string): MaskError[] {
  const trimmed = (mask ?? '').trim()
  if (!trimmed) return ['mask_empty']
  const errors: MaskError[] = []
  if (trimmed.length > MAX_MASK_LENGTH) errors.push('mask_too_long')
  const tokens = tokensOf(trimmed)
  // Any brace not consumed by a known-shaped token is an unknown token.
  const stripped = trimmed.replace(TOKEN_RE, '')
  if (/[{}]/.test(stripped) || tokens.some((t) => !DATE_TOKENS.has(t.name) && !(t.name in SEQUENCE_TOKENS))) {
    errors.push('mask_unknown_token')
  }
  const sequences = tokens.filter((t) => t.name in SEQUENCE_TOKENS)
  if (sequences.length === 0) errors.push('mask_missing_sequence')
  if (sequences.length > 1) errors.push('mask_multiple_sequences')
  const hasYear = tokens.some((t) => t.name === 'YYYY' || t.name === 'YY')
  const hasMonth = tokens.some((t) => t.name === 'MM')
  const scope = sequences[0] ? SEQUENCE_TOKENS[sequences[0].name] : 'none'
  if (scope === 'year' && !hasYear) errors.push('mask_year_scope_needs_year')
  if (scope === 'month' && (!hasYear || !hasMonth)) errors.push('mask_month_scope_needs_year_and_month')
  return errors
}

export function parseMask(mask: string): ParsedMask {
  const tokens = tokensOf(mask)
  const sequence = tokens.find((t) => t.name in SEQUENCE_TOKENS)
  return {
    scope: sequence ? SEQUENCE_TOKENS[sequence.name] : 'none',
    pad: sequence?.pad ?? 0,
    hasYear: tokens.some((t) => t.name === 'YYYY' || t.name === 'YY'),
    hasMonth: tokens.some((t) => t.name === 'MM'),
  }
}

function datePart(date: Date, part: 'YYYY' | 'YY' | 'MM' | 'DD'): string {
  const d = new Date(date)
  switch (part) {
    case 'YYYY':
      return String(d.getUTCFullYear())
    case 'YY':
      return String(d.getUTCFullYear()).slice(-2)
    case 'MM':
      return String(d.getUTCMonth() + 1).padStart(2, '0')
    case 'DD':
      return String(d.getUTCDate()).padStart(2, '0')
  }
}

/** Counter scope for a mask on a given issue date: '', 'YYYY' or 'YYYY-MM'. */
export function sequenceScopeKey(mask: string, issueDate: Date): string {
  const { scope } = parseMask(mask)
  if (scope === 'year') return datePart(issueDate, 'YYYY')
  if (scope === 'month') return `${datePart(issueDate, 'YYYY')}-${datePart(issueDate, 'MM')}`
  return ''
}

export function renderNumber(mask: string, params: { seq: number; issueDate: Date }): string {
  return mask.replace(TOKEN_RE, (_match, name: string, pad?: string) => {
    if (name in SEQUENCE_TOKENS) return String(params.seq).padStart(pad ? Number(pad) : 0, '0')
    if (DATE_TOKENS.has(name)) return datePart(params.issueDate, name as 'YYYY' | 'YY' | 'MM' | 'DD')
    return _match
  })
}

export function maskFor(masks: Partial<Record<string, string>> | null | undefined, series: DocumentSeries): string {
  const candidate = masks?.[series]
  return candidate && validateMask(candidate).length === 0 ? candidate : DEFAULT_NUMBER_MASKS[series]
}

function randomHex(length: number): string {
  let out = ''
  while (out.length < length) out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return out.slice(0, length)
}

/** Temporary number for an unposted real draft (no sequence consumed). */
export function draftNumber(): string {
  return `DRAFT-${randomHex(8).toUpperCase()}`
}

/** Number for test-run drafts — never posted, never numbered. */
export function testNumber(): string {
  return `TEST-${Date.now().toString(16)}-${randomHex(8)}`
}

export type NumberScope = { tenantId: string; organizationId: string }

/**
 * Claims the next number of a series. MUST run inside the caller's
 * transaction (post command / receipt capture) so a rollback releases it.
 */
export async function claimDocumentNumber(
  em: EntityManager,
  scope: NumberScope,
  series: DocumentSeries,
  mask: string,
  issueDate: Date,
): Promise<{ number: string; seq: number; scopeKey: string }> {
  const scopeKey = sequenceScopeKey(mask, issueDate)
  const now = new Date()
  const rows = (await em.execute(
    `INSERT INTO billing_document_sequences
       (tenant_id, organization_id, series, scope_key, next_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, 2, ?, ?)
     ON CONFLICT (tenant_id, organization_id, series, scope_key)
     DO UPDATE SET next_value = billing_document_sequences.next_value + 1, updated_at = EXCLUDED.updated_at
     RETURNING next_value - 1 AS seq`,
    [scope.tenantId, scope.organizationId, series, scopeKey, now, now],
  )) as unknown as Array<{ seq: number | string }> | undefined
  const seq = Number(rows?.[0]?.seq)
  if (!Number.isFinite(seq) || seq < 1) {
    throw new Error(`Failed to claim a ${series} number`)
  }
  return { number: renderNumber(mask, { seq, issueDate }), seq, scopeKey }
}
