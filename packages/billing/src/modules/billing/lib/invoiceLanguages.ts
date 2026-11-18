import type { Locale } from '@open-mercato/shared/lib/i18n/config'

/**
 * Invoice languages the built-in billing document template can render.
 *
 * Single source of truth for the account form's language picklist, the
 * `invoiceLanguage` validator, the `Intl` locale used for money / dates on
 * documents and emails, and the dictionary the document translator loads.
 * Adding a language means adding `i18n/<code>.json` AND one entry here — the
 * dictionary-parity test fails if either is missing.
 *
 * Every `code` must be a UI locale the framework ships (`Locale`), because the
 * document translator loads the regular module dictionary for it. The
 * `satisfies` clause below turns a code the framework does not ship into a
 * compile error.
 *
 * `label` is the language's own name (endonym), so it reads correctly no
 * matter which UI locale the operator uses — it is intentionally not routed
 * through i18n. Order: default first, then product priority.
 *
 * Specs: .ai/specs/2026-11-14-billing-account-workspace.md (D22),
 * .ai/specs/2026-11-15-billing-multi-language.md. Narrowing the list per
 * organization (`BillingSettings.enabled_invoice_languages`) arrives with the
 * standalone-ledger spec; until then every supported language is selectable.
 */

export const SUPPORTED_INVOICE_LANGUAGES = [
  { code: 'en', label: 'English', intlLocale: 'en-GB' },
  { code: 'es', label: 'Español', intlLocale: 'es-ES' },
  { code: 'de', label: 'Deutsch', intlLocale: 'de-DE' },
  { code: 'pl', label: 'Polski', intlLocale: 'pl-PL' },
] as const satisfies ReadonlyArray<{ code: Locale; label: string; intlLocale: string }>

export type InvoiceLanguageCode = (typeof SUPPORTED_INVOICE_LANGUAGES)[number]['code']

export const INVOICE_LANGUAGE_CODES = SUPPORTED_INVOICE_LANGUAGES.map((l) => l.code) as [
  InvoiceLanguageCode,
  ...InvoiceLanguageCode[],
]

export const DEFAULT_INVOICE_LANGUAGE: InvoiceLanguageCode = 'en'

export function isSupportedInvoiceLanguage(value: string): value is InvoiceLanguageCode {
  return (INVOICE_LANGUAGE_CODES as readonly string[]).includes(value)
}

/** Normalizes a stored / requested language to a supported code (`' PL '` → `pl`), else the default. */
export function resolveInvoiceLanguage(value: string | null | undefined): InvoiceLanguageCode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isSupportedInvoiceLanguage(normalized) ? normalized : DEFAULT_INVOICE_LANGUAGE
}

/** The `Intl` locale documents in this language format money and dates with. */
export function invoiceIntlLocale(language: string | null | undefined): string {
  const code = resolveInvoiceLanguage(language)
  return SUPPORTED_INVOICE_LANGUAGES.find((l) => l.code === code)?.intlLocale ?? 'en-GB'
}
