import {
  cpqCostIndexCreateSchema,
  cpqCostIndexImportSchema,
  cpqCostIndexImportRowSchema,
  cpqCostIndexUpdateSchema,
  cpqCostIndexValueCreateSchema,
} from '../cost-indices'

const valid = { code: 'BRENT', name: 'Brent', unit: 'USD/bbl', currencyCode: 'USD' }

describe('cpqCostIndexCreateSchema', () => {
  it('parses a valid index and defaults nothing silently', () => {
    expect(cpqCostIndexCreateSchema.parse({ ...valid, description: 'ICE', isActive: false })).toMatchObject({ code: 'BRENT', isActive: false })
  })

  it.each([['B'], ['brent'], ['BR ENT'], ['A'.repeat(41)], ['BRENT!']])('rejects code %j', (code) => {
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, code }).success).toBe(false)
  })

  it.each([['DEMO-DC_POWER'], ['AB'], ['A'.repeat(40)]])('accepts code %j', (code) => {
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, code }).success).toBe(true)
  })

  it.each([['usd'], ['US'], ['USDD'], ['U$D'], ['']])('rejects currency %j', (currencyCode) => {
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, currencyCode }).success).toBe(false)
  })

  it('rejects empty / oversized text and unknown fields', () => {
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false)
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, unit: 'x'.repeat(41) }).success).toBe(false)
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, description: 'x'.repeat(1001) }).success).toBe(false)
    expect(cpqCostIndexCreateSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
  })
})

describe('cpqCostIndexUpdateSchema', () => {
  it('accepts a partial patch and rejects unknown fields', () => {
    expect(cpqCostIndexUpdateSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(cpqCostIndexUpdateSchema.safeParse({ currencyCode: 'eur' }).success).toBe(false)
    expect(cpqCostIndexUpdateSchema.safeParse({ id: 'x' }).success).toBe(false)
  })
})

describe('cpqCostIndexValueCreateSchema', () => {
  const value = { effectiveDate: '2026-11-10', value: 82.4 }

  it('accepts a positive value with up to 6 decimals and a note', () => {
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, value: 0.000001, sourceNote: 'ICE Brent settlement' }).success).toBe(true)
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, value: 82.123456 }).success).toBe(true)
  })

  it.each([[0], [-5], [0.0000001], [Number.NaN], [Infinity], ['82.4'], [1_000_000_000_000]])('rejects value %j', (amount) => {
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, value: amount }).success).toBe(false)
  })

  it.each([['2026-13-01'], ['2026-02-30'], ['10/11/2026'], ['2026-1-1'], ['2026-11-10T00:00:00Z'], ['']])('rejects date %j', (effectiveDate) => {
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, effectiveDate }).success).toBe(false)
  })

  it('accepts future and leap dates, rejects an oversized note', () => {
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, effectiveDate: '2099-01-01' }).success).toBe(true)
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, effectiveDate: '2028-02-29' }).success).toBe(true)
    expect(cpqCostIndexValueCreateSchema.safeParse({ ...value, sourceNote: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('import schemas', () => {
  const row = { indexCode: 'BRENT', effectiveDate: '2026-11-10', value: 82.4 }

  it('validates a row and rejects a non-positive value', () => {
    expect(cpqCostIndexImportRowSchema.safeParse(row).success).toBe(true)
    expect(cpqCostIndexImportRowSchema.safeParse({ ...row, value: 0 }).success).toBe(false)
  })

  it('bounds the envelope at 1..1000 rows (rows are validated one by one by the service)', () => {
    expect(cpqCostIndexImportSchema.safeParse({ items: [] }).success).toBe(false)
    expect(cpqCostIndexImportSchema.safeParse({ items: Array.from({ length: 1000 }, () => row) }).success).toBe(true)
    expect(cpqCostIndexImportSchema.safeParse({ items: Array.from({ length: 1001 }, () => row) }).success).toBe(false)
    expect(cpqCostIndexImportSchema.safeParse({ items: [{ bad: 1 }], dryRun: true }).success).toBe(true)
  })
})
