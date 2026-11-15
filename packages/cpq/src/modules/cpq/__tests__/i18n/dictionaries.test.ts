import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { MODULE_ROOT, collectTranslationKeys, listSourceFiles } from './sourceScan'

/**
 * CPQ dictionary guardrails (spec 2026-11-15-cpq-multi-language):
 *   - every `i18n/<locale>.json` mirrors `en.json` key for key, keeps every
 *     `{placeholder}` and has no empty value;
 *   - every key the source uses exists in `en.json` (a missing key renders
 *     its English fallback in every language), and every dynamic key prefix
 *     has at least one entry;
 *   - `en.json` carries no orphaned keys.
 */

const I18N_DIR = join(MODULE_ROOT, 'i18n')
const load = (locale: string) => JSON.parse(readFileSync(join(I18N_DIR, `${locale}.json`), 'utf8')) as Record<string, string>
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

const locales = readdirSync(I18N_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
const en = load('en')
const enKeys = Object.keys(en)
const translated = locales.filter((l) => l !== 'en')
// `describe.each` rejects an empty table; en vs en is a trivially-true row.
const parityRows = translated.length ? translated : ['en']
const { keys: usedKeys, prefixes } = collectTranslationKeys(listSourceFiles(MODULE_ROOT))

describe('cpq i18n dictionaries', () => {
  it('ships en plus the supported translations', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'es', 'de', 'pl']))
  })

  it('en.json is sorted by key and has no empty values', () => {
    expect(enKeys).toEqual([...enKeys].sort())
    expect(enKeys.filter((k) => !en[k]?.trim())).toEqual([])
  })

  it('every key used in source exists in en.json', () => {
    expect([...usedKeys].filter((k) => !(k in en)).sort()).toEqual([])
  })

  it('every dynamic key prefix has entries in en.json', () => {
    expect([...prefixes].filter((p) => !enKeys.some((k) => k.startsWith(p))).sort()).toEqual([])
  })

  it('en.json has no orphaned keys', () => {
    const orphans = enKeys.filter((k) => !usedKeys.has(k) && ![...prefixes].some((p) => k.startsWith(p)))
    expect(orphans).toEqual([])
  })

  describe.each(parityRows)('%s.json', (locale) => {
    const dict = load(locale)
    it('has exactly the keys of en.json, in the same order', () => {
      expect(Object.keys(dict)).toEqual(enKeys)
    })
    it('keeps every {placeholder} of the English value', () => {
      expect(enKeys.filter((k) => typeof dict[k] === 'string' && placeholders(dict[k]) !== placeholders(en[k]))).toEqual([])
    })
    it('has no empty values', () => {
      expect(enKeys.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim())).toEqual([])
    })
  })
})
