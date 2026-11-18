import {
  DEFAULT_INVOICE_LANGUAGE,
  INVOICE_LANGUAGE_CODES,
  SUPPORTED_INVOICE_LANGUAGES,
  invoiceIntlLocale,
  isSupportedInvoiceLanguage,
  resolveInvoiceLanguage,
} from '../../lib/invoiceLanguages'
import { documentLocale } from '../../lib/pdf/invoiceModel'

describe('invoice language registry', () => {
  it('lists the default first and derives the code list from the registry', () => {
    expect(SUPPORTED_INVOICE_LANGUAGES[0].code).toBe(DEFAULT_INVOICE_LANGUAGE)
    expect(INVOICE_LANGUAGE_CODES).toEqual(SUPPORTED_INVOICE_LANGUAGES.map((l) => l.code))
    expect(new Set(INVOICE_LANGUAGE_CODES).size).toBe(INVOICE_LANGUAGE_CODES.length)
  })

  it('gives every language an endonym label and a valid Intl locale', () => {
    for (const language of SUPPORTED_INVOICE_LANGUAGES) {
      expect(language.label.trim()).not.toBe('')
      expect(Intl.DateTimeFormat.supportedLocalesOf([language.intlLocale])).toEqual([language.intlLocale])
      expect(language.intlLocale.toLowerCase().startsWith(`${language.code}-`)).toBe(true)
    }
  })

  it('resolves stored values: normalizes case / whitespace, falls back to the default', () => {
    expect(resolveInvoiceLanguage(' PL ')).toBe('pl')
    expect(resolveInvoiceLanguage('en')).toBe('en')
    expect(resolveInvoiceLanguage('xx')).toBe(DEFAULT_INVOICE_LANGUAGE)
    expect(resolveInvoiceLanguage('')).toBe(DEFAULT_INVOICE_LANGUAGE)
    expect(resolveInvoiceLanguage(null)).toBe(DEFAULT_INVOICE_LANGUAGE)
    expect(resolveInvoiceLanguage(undefined)).toBe(DEFAULT_INVOICE_LANGUAGE)
  })

  it('checks support strictly (no normalization)', () => {
    expect(isSupportedInvoiceLanguage('pl')).toBe(true)
    expect(isSupportedInvoiceLanguage('PL')).toBe(false)
    expect(isSupportedInvoiceLanguage('xx')).toBe(false)
  })

  it('maps languages to their Intl locale; documentLocale delegates to the registry', () => {
    for (const language of SUPPORTED_INVOICE_LANGUAGES) {
      expect(invoiceIntlLocale(language.code)).toBe(language.intlLocale)
      expect(documentLocale(language.code)).toBe(language.intlLocale)
    }
    expect(invoiceIntlLocale('xx')).toBe('en-GB')
    expect(documentLocale('xx')).toBe('en-GB')
  })
})
