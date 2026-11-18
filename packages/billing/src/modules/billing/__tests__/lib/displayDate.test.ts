import { promises as fs } from 'node:fs'
import path from 'node:path'
import { formatDisplayDate, formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { EMPTY_DATE_LABEL, formatBillingDateTime, formatBillingDay } from '../../lib/displayDate'

// Issue #129: billing screens must format dates exactly like DataTable's
// auto-detected `*_at` columns (formatDisplayDate[Time] in the app locale,
// honouring NEXT_PUBLIC_OM_DATE_FORMAT / NEXT_PUBLIC_OM_DATE_TIME_FORMAT).

const DATE_ENV = ['NEXT_PUBLIC_OM_DATE_FORMAT', 'NEXT_PUBLIC_DATE_FORMAT', 'NEXT_PUBLIC_OM_DATE_TIME_FORMAT', 'NEXT_PUBLIC_DATE_TIME_FORMAT'] as const

describe('displayDate', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of DATE_ENV) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of DATE_ENV) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  describe('formatBillingDateTime', () => {
    it('matches the DataTable `*_at` rendering for the same locale', () => {
      const value = '2026-11-16T16:28:29.000Z'
      expect(formatBillingDateTime(value, 'es-CO')).toBe(formatDisplayDateTime(value, 'es-CO'))
      expect(formatBillingDateTime(value, 'en')).toBe(formatDisplayDateTime(value, 'en'))
    })

    it('follows the app locale, not the browser default', () => {
      const value = '2026-11-16T16:28:29.000Z'
      expect(formatBillingDateTime(value, 'en')).not.toBe(formatBillingDateTime(value, 'de'))
    })

    it('honours NEXT_PUBLIC_OM_DATE_TIME_FORMAT', () => {
      process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd/MM/yyyy HH:mm'
      const local = new Date(2026, 10, 16, 16, 28, 29)
      expect(formatBillingDateTime(local.toISOString(), 'en')).toBe('16/11/2026 16:28')
    })

    it('renders an em dash for empty values and the raw text for garbage', () => {
      expect(formatBillingDateTime(null)).toBe(EMPTY_DATE_LABEL)
      expect(formatBillingDateTime(undefined)).toBe(EMPTY_DATE_LABEL)
      expect(formatBillingDateTime('  ')).toBe(EMPTY_DATE_LABEL)
      expect(formatBillingDateTime('not a date')).toBe('not a date')
    })
  })

  describe('formatBillingDay', () => {
    it('matches formatDisplayDate for a calendar day', () => {
      expect(formatBillingDay('2026-12-01', 'es-CO')).toBe(formatDisplayDate('2026-12-01', 'es-CO'))
    })

    it('keeps the stored UTC day of a date column serialized as UTC midnight', () => {
      expect(formatBillingDay('2026-12-01T00:00:00.000Z', 'en')).toBe(formatDisplayDate('2026-12-01', 'en'))
      expect(formatBillingDay(new Date('2026-12-31T00:00:00Z'), 'en')).toBe(formatDisplayDate('2026-12-31', 'en'))
    })

    it('honours NEXT_PUBLIC_OM_DATE_FORMAT', () => {
      process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd/MM/yyyy'
      expect(formatBillingDay('2026-11-16', 'en')).toBe('16/11/2026')
    })

    it('renders an em dash for empty values and the raw text for garbage', () => {
      expect(formatBillingDay(null)).toBe(EMPTY_DATE_LABEL)
      expect(formatBillingDay('')).toBe(EMPTY_DATE_LABEL)
      expect(formatBillingDay('soon')).toBe('soon')
    })
  })
})

// Regression guard: the scattered `toLocaleString()` / `toLocaleDateString()`
// helpers (browser locale, different style from DataTable) must not return.
describe('billing UI date formatting', () => {
  const MODULE_ROOT = path.resolve(__dirname, '../..')

  async function uiFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : uiFiles(full)
        return entry.name.endsWith('.tsx') ? [full] : []
      }),
    )
    return nested.flat()
  }

  it('no .tsx file formats dates with toLocaleString / toLocaleDateString / toLocaleTimeString', async () => {
    const files = [...(await uiFiles(path.join(MODULE_ROOT, 'backend'))), ...(await uiFiles(path.join(MODULE_ROOT, 'components')))]
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      if (/\.toLocale(?:Date|Time)?String\(/.test(source)) offenders.push(path.relative(MODULE_ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})
