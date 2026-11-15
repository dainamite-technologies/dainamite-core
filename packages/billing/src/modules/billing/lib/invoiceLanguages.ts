/**
 * Invoice languages the built-in billing document template can render.
 *
 * Single source of truth for the account form's language picklist and the
 * `invoiceLanguage` validator. Adding a language means adding the template
 * labels for it AND one entry here — never one without the other.
 *
 * `label` is the language's own name (endonym), so it reads correctly no
 * matter which UI locale the operator uses — it is intentionally not routed
 * through i18n.
 *
 * Spec: .ai/specs/2026-11-14-billing-account-workspace.md (D22). Narrowing the
 * list per organization (`BillingSettings.enabled_invoice_languages`) arrives
 * with the standalone-ledger spec; until then every supported language is
 * selectable.
 */

export const SUPPORTED_INVOICE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
] as const

export type InvoiceLanguageCode = (typeof SUPPORTED_INVOICE_LANGUAGES)[number]['code']

export const INVOICE_LANGUAGE_CODES = SUPPORTED_INVOICE_LANGUAGES.map((l) => l.code) as [
  InvoiceLanguageCode,
  ...InvoiceLanguageCode[],
]

export const DEFAULT_INVOICE_LANGUAGE: InvoiceLanguageCode = 'en'

export function isSupportedInvoiceLanguage(value: string): value is InvoiceLanguageCode {
  return (INVOICE_LANGUAGE_CODES as readonly string[]).includes(value)
}
