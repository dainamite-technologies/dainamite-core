import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { INVOICE_LANGUAGE_CODES } from '../../lib/invoiceLanguages'

/**
 * Guardrails for billing dictionaries (spec 2026-11-15-billing-multi-language):
 * every `i18n/<locale>.json` mirrors `en.json` key for key and keeps every
 * `{placeholder}` intact — a translated placeholder would print as a raw token
 * on a customer's invoice or email. Picks up new dictionaries automatically.
 */

const I18N_DIR = join(__dirname, '..', '..', 'i18n')

function load(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')) as Record<string, string>
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

const locales = readdirSync(I18N_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort()
const en = load('en')
const enKeys = Object.keys(en)
const translated = locales.filter((locale) => locale !== 'en')

describe('billing i18n dictionaries', () => {
  it('ships an English base dictionary and at least one translation', () => {
    expect(locales).toContain('en')
    expect(translated.length).toBeGreaterThan(0)
  })

  describe.each(translated)('%s.json', (locale) => {
    const dict = load(locale)

    it('has exactly the keys of en.json, in the same order', () => {
      expect(Object.keys(dict)).toEqual(enKeys)
    })

    it('keeps every {placeholder} of the English value', () => {
      const mismatches = enKeys
        .filter((key) => typeof dict[key] === 'string')
        .filter((key) => placeholders(dict[key]).join(',') !== placeholders(en[key]).join(','))
      expect(mismatches).toEqual([])
    })

    it('has no empty values', () => {
      expect(enKeys.filter((key) => typeof dict[key] !== 'string' || dict[key].trim() === '')).toEqual([])
    })
  })

  it('has a dictionary for every supported invoice language, covering every document and email key', () => {
    const documentKeys = enKeys.filter((key) => key.startsWith('billing.pdf.') || key.startsWith('billing.email.'))
    expect(documentKeys.length).toBeGreaterThan(0)
    for (const code of INVOICE_LANGUAGE_CODES) {
      expect(locales).toContain(code)
      const dict = load(code)
      expect(documentKeys.filter((key) => !dict[key])).toEqual([])
    }
  })
})
