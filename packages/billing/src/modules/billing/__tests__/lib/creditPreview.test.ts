import { billedBeyond, previewCredit } from '../../lib/creditPreview'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const item = (overrides: Record<string, unknown> = {}) => ({
  type: 'recurring',
  prorate: true,
  billStartDate: '2026-11-01',
  billedToDate: '2026-12-14',
  ...overrides,
})

describe('previewCredit', () => {
  it('credits the billed days after the new end date', () => {
    expect(previewCredit(item(), '2026-11-15')).toEqual({ credited: true, from: d('2026-11-16'), to: d('2026-12-14'), days: 29 })
  })

  it('credits from the start when the item is ended before it started billing days', () => {
    expect(previewCredit(item({ billStartDate: '2026-11-20' }), '2026-11-10')).toMatchObject({ credited: true, from: d('2026-11-20') })
  })

  it.each([
    ['ended on the billed-to date', item(), '2026-12-14'],
    ['ended after it', item(), '2026-12-31'],
    ['never billed', item({ billedToDate: null }), '2026-11-15'],
    ['proration off', item({ prorate: false }), '2026-11-15'],
    ['one-time item', item({ type: 'one_time' }), '2026-11-15'],
    ['open-ended', item(), null],
  ] as const)('no credit: %s', (_label, it, end) => {
    expect(previewCredit(it, end)).toEqual({ credited: false })
  })

  it('billedBeyond flags proration-off items that keep billed days', () => {
    expect(billedBeyond(item({ prorate: false }), '2026-11-15')).toBe(true)
    expect(billedBeyond(item(), '2026-12-14')).toBe(false)
  })
})
