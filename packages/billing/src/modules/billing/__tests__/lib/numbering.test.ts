import {
  DEFAULT_NUMBER_MASKS,
  claimDocumentNumber,
  draftNumber,
  maskFor,
  parseMask,
  renderNumber,
  sequenceScopeKey,
  testNumber,
  validateMask,
} from '../../lib/numbering'

const nov = new Date('2026-11-14T00:00:00Z')
const dec = new Date('2026-12-01T00:00:00Z')
const jan = new Date('2027-01-05T00:00:00Z')

describe('validateMask', () => {
  it('accepts the defaults and simple masks', () => {
    for (const mask of Object.values(DEFAULT_NUMBER_MASKS)) expect(validateMask(mask)).toEqual([])
    expect(validateMask('INV-{SEQUENCE_NUM}')).toEqual([])
    expect(validateMask('FV/{SEQUENCE_NUM_YEAR:5}/{YY}')).toEqual([])
  })

  it('rejects masks without or with several sequences', () => {
    expect(validateMask('INV/{YYYY}')).toContain('mask_missing_sequence')
    expect(validateMask('{SEQUENCE_NUM}/{SEQUENCE_NUM_YEAR}/{YYYY}')).toContain('mask_multiple_sequences')
    expect(validateMask('  ')).toEqual(['mask_empty'])
  })

  it('requires the date parts a scoped counter resets on', () => {
    expect(validateMask('INV/{SEQUENCE_NUM_YEAR}')).toContain('mask_year_scope_needs_year')
    expect(validateMask('INV/{YYYY}/{SEQUENCE_NUM_MONTH}')).toContain('mask_month_scope_needs_year_and_month')
    expect(validateMask('INV/{MM}/{SEQUENCE_NUM_MONTH}')).toContain('mask_month_scope_needs_year_and_month')
  })

  it('rejects unknown tokens, stray braces and overlong masks', () => {
    expect(validateMask('INV/{YEAR}/{SEQUENCE_NUM}')).toContain('mask_unknown_token')
    expect(validateMask('INV/{SEQUENCE_NUM}}')).toContain('mask_unknown_token')
    expect(validateMask(`${'X'.repeat(70)}{SEQUENCE_NUM}`)).toContain('mask_too_long')
  })
})

describe('scope keys and rendering', () => {
  it('derives the counter scope from the mask and the issue date', () => {
    expect(sequenceScopeKey('INV-{SEQUENCE_NUM}', nov)).toBe('')
    expect(sequenceScopeKey('INV/{YYYY}/{SEQUENCE_NUM_YEAR}', nov)).toBe('2026')
    expect(sequenceScopeKey('INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH}', nov)).toBe('2026-11')
    expect(sequenceScopeKey('INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH}', dec)).toBe('2026-12')
    expect(sequenceScopeKey('INV/{YYYY}/{SEQUENCE_NUM_YEAR}', jan)).toBe('2027')
  })

  it('renders every token with optional padding', () => {
    expect(renderNumber(DEFAULT_NUMBER_MASKS.invoice, { seq: 1, issueDate: nov })).toBe('INV/2026/11/0001')
    expect(renderNumber('FV/{YY}{MM}{DD}-{SEQUENCE_NUM}', { seq: 42, issueDate: nov })).toBe('FV/261114-42')
    expect(renderNumber('X{SEQUENCE_NUM_YEAR:2}', { seq: 123, issueDate: nov })).toBe('X123')
  })

  it('parses scope and padding', () => {
    expect(parseMask(DEFAULT_NUMBER_MASKS.receipt)).toEqual({ scope: 'month', pad: 4, hasYear: true, hasMonth: true })
  })

  it('falls back to the default mask when the configured one is invalid', () => {
    expect(maskFor({ invoice: 'BAD' }, 'invoice')).toBe(DEFAULT_NUMBER_MASKS.invoice)
    expect(maskFor({ invoice: 'A-{SEQUENCE_NUM}' }, 'invoice')).toBe('A-{SEQUENCE_NUM}')
    expect(maskFor(null, 'credit_memo')).toBe(DEFAULT_NUMBER_MASKS.credit_memo)
  })

  it('builds temporary numbers that can never look like a posted one', () => {
    expect(draftNumber()).toMatch(/^DRAFT-[0-9A-F]{8}$/)
    expect(testNumber()).toMatch(/^TEST-/)
  })
})

describe('claimDocumentNumber', () => {
  it('upserts the scoped counter and renders the claimed value', async () => {
    const execute = jest.fn(async () => [{ seq: '7' }])
    const em = { execute } as never
    const res = await claimDocumentNumber(em, { tenantId: 't', organizationId: 'o' }, 'invoice', DEFAULT_NUMBER_MASKS.invoice, nov)
    expect(res).toEqual({ number: 'INV/2026/11/0007', seq: 7, scopeKey: '2026-11' })
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/ON CONFLICT \(tenant_id, organization_id, series, scope_key\)/)
    expect(params.slice(0, 4)).toEqual(['t', 'o', 'invoice', '2026-11'])
  })

  it('fails loudly when the database returns no sequence', async () => {
    const em = { execute: jest.fn(async () => []) } as never
    await expect(
      claimDocumentNumber(em, { tenantId: 't', organizationId: 'o' }, 'receipt', DEFAULT_NUMBER_MASKS.receipt, nov),
    ).rejects.toThrow('Failed to claim a receipt number')
  })
})
