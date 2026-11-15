# Billing — Spanish and German UI and Invoice Documents

**Date**: 2026-11-15
**Status**: Implemented (2026-11-15)
**Package**: `@dainamite/billing` (`packages/billing/src/modules/billing/`)

## TLDR

**Key Points:**
- Add **Spanish** (the priority) and **German** to the billing module's operator UI and to its customer-facing documents: the invoice, credit memo, debit memo and receipt PDF, plus the invoice delivery email. English and Polish already exist.
- After this spec, billing supports **EN, ES, DE, PL**. That matches the UI locales Open Mercato already ships (except Korean, which is skipped).

**Scope:**
- Billing UI dictionaries: new `i18n/es.json` and `i18n/de.json`, each with all 878 keys of `en.json`.
- Document languages: `SUPPORTED_INVOICE_LANGUAGES` grows from `en, pl` to `en, es, de, pl`. The registry becomes the single source of truth for the picklist, the validator, the `Intl` locale and the translator.
- Removes the silent fallback that would render any non-Polish document in English (`lib/pdf/invoicePdf.ts:32`).
- Guardrail tests: dictionary key and placeholder parity, registry ↔ dictionary consistency, and per-language PDF and email text extraction.

**Decisions taken (2026-11-15, user):**
- **French is skipped.** Open Mercato 0.9.0 does not ship `fr` as a UI locale. Revisit when the framework adds it.
- **Korean is skipped.**
- **Translations are drafted by the agent, with no native-speaker sign-off** (this is a demo).
- **One neutral wording per language.** The language picks the labels; there is no country dimension. Where a term is jurisdiction-specific, the most widely understood legal term wins (glossary below).

**Out of scope:** country-specific fiscal compliance (Spanish *Verifactu*/SII, German *§14 UStG* mandatory notices, *E-Rechnung*/XRechnung), per-organization language narrowing (`BillingSettings.enabled_invoice_languages`, deferred to the standalone-ledger spec), CPQ UI translations (CPQ has no i18n dictionaries), and French and Korean.

---

## Overview

Billing is the first Dainamite package that issues customer-facing legal documents. Today a Spanish or German customer gets an English invoice. Operators whose UI locale is `es` or `de` see the billing module in English, while the rest of Open Mercato (sales, customers, the shell) is already translated. This spec closes both gaps with no schema change.

> **Market reference.** Odoo, Invoice Ninja and Lago all separate the **document language** (per customer, stored on the account) from the **operator UI locale** (per user). Billing already does this (`billing_accounts.invoice_language`, D22 of the account-workspace spec), and this spec keeps it.
> - **Adopted:** endonym labels in the language picker (Invoice Ninja). Locale-aware number and date formatting through `Intl` (all three).
> - **Rejected for now:** Odoo's language × country "fiscal localization" split. It is the right long-term model but over-scoped for a demo (decision Q3).

## Problem Statement

1. **Spanish/German customers get English documents.** `SUPPORTED_INVOICE_LANGUAGES` contains only `en` and `pl`, and the Zod validator rejects anything else.
2. **Adding a language is a trap.** Even if the registry were extended, `loadDocumentTranslator` hard-codes `language === 'pl' ? 'pl' : 'en'` and `LOCALE_BY_LANGUAGE` has only `en-GB` and `pl-PL`. A new language would pass validation and still render English labels with English number formatting, and no test would fail.
3. **Operators on `es`/`de` UI locales see English billing screens.** There is no `es.json` or `de.json`, so `loadDictionary` falls back to the inline `t(key, fallback)` English strings.
4. **Hard-coded language lists drift.** The `openApi` descriptions (`api/accounts/route.ts:246`, `api/invoices/[id]/pdf/route.ts:74`) and an entity comment say "en / pl" in prose.

## Current State (verified in code, 2026-11-15)

| Area | Today | File |
|---|---|---|
| UI dictionaries | `en.json`, `pl.json` with 878 keys each and full parity. 38 `billing.pdf.*` + 5 `billing.email.*` keys. The 29 PL values equal to EN are all legitimate (Status, VAT, IBAN, OK, ID, Bank, TEST…) | `i18n/` |
| Language registry | `[{en, English}, {pl, Polski}]`. Drives the account form picklist, the `AccountView` label and the Zod enum | `lib/invoiceLanguages.ts` |
| Number/date locale | `LOCALE_BY_LANGUAGE = { en: 'en-GB', pl: 'pl-PL' }`, fallback `en-GB` | `lib/pdf/invoiceModel.ts` |
| Document translator | `language === 'pl' ? 'pl' : 'en'` | `lib/pdf/invoicePdf.ts:32` |
| Email | Subject and body are localized through the same translator and `documentLocale()` | `lib/invoiceDelivery.ts` |
| PDF font | Noto Sans subset `U+0020-007E, U+00A0-017F, U+2010-2027, U+2030-203A, U+20AC…` covers á é í ó ú ü ñ ¿ ¡ º ª (ES) and ä ö ü ß (DE). **No font change** | `scripts/embed-pdf-fonts.mjs` |
| `Intl` spacing | `plain()` normalizes U+00A0 / U+202F. `de-DE` uses `.` grouping, so nothing new | `lib/pdf/invoiceModel.ts` |
| Table headers | Headers wrap inside their column. German compounds need a layout check | `lib/pdf/invoiceTemplate.ts` |
| Framework locales | `en, pl, es, de, ko`. `loadDictionary('es' \| 'de')` uses the normal shipped-locale path, so there is no app-level registration | `@open-mercato/shared/lib/i18n/config.ts`, `server.ts` |
| Dictionary discovery | `yarn generate` imports `@dainamite/billing/modules/billing/i18n/<locale>.json`. JSON is exported from `src/` (`package.json` `./*/*/*/*.json`), so a rebuild of `dist` is **not** needed for the dictionaries | `.mercato/generated/modules.*.generated.ts` |
| DB | `billing_accounts.invoice_language text not null`. Validated in Zod only, so **no migration** | `data/entities.ts:87` |

## Proposed Solution

### 1. Registry becomes the single source of truth

`lib/invoiceLanguages.ts`:

```ts
export const SUPPORTED_INVOICE_LANGUAGES = [
  { code: 'en', label: 'English', intlLocale: 'en-GB' },
  { code: 'es', label: 'Español', intlLocale: 'es-ES' },
  { code: 'de', label: 'Deutsch', intlLocale: 'de-DE' },
  { code: 'pl', label: 'Polski',  intlLocale: 'pl-PL' },
] as const

export function resolveInvoiceLanguage(value: string | null | undefined): InvoiceLanguageCode
// → normalized supported code, else DEFAULT_INVOICE_LANGUAGE

export function invoiceIntlLocale(code: string): string
// → registry intlLocale, else the default language's intlLocale
```

- **Order:** English stays first as the default. The rest follow the user's priority (ES, DE, PL). Polish moves from 2nd to 4th in the picklist, which is cosmetic.
- `invoiceModel.ts`: `documentLocale()` delegates to `invoiceIntlLocale()`, and `LOCALE_BY_LANGUAGE` is deleted. `invoiceModel.ts` stays pure, because the registry is a pure constant module.
- `invoicePdf.ts`: `loadDocumentTranslator` uses `resolveInvoiceLanguage(language)` as the `Locale` it passes to `loadDictionary`. The type is safe because every registry code is a shipped framework `Locale`. A compile-time assertion (`satisfies readonly { code: Locale }[]`) catches a future registry entry the framework doesn't ship.
- `invoiceDelivery.ts`: replace its own fallback (`buyer.invoice_language || …`) with `resolveInvoiceLanguage`.

### 2. Dictionaries

- `i18n/es.json` and `i18n/de.json` have the same keys as `en.json`, preserve every `{placeholder}`, and keep the existing key order to make diffs easy.
- Register: neutral Spanish (*usted* in customer-facing text, *tú*/impersonal infinitives in operator UI, consistent with the core `sales` `es.json`). German uses *Sie* for customer-facing text and the neutral imperative/infinitive in UI, consistent with the core `sales` `de.json`.
- **Terminology consistency:** before translating, read `@open-mercato/core/src/modules/sales/i18n/{es,de}.json` and `packages/cpq-billing-connector/src/modules/cpq_billing_connector/i18n/{es,de}.json`. Shared concepts (quote, order, invoice, customer, net, gross, tax, status, due date) must use **the same word** as the framework, so a Spanish operator doesn't see "Factura" in sales and "Recibo" in billing for the same thing.

### 3. Document glossary (neutral wording, decision Q3)

Customer-facing keys. EN and PL are shown for reference; PL is unchanged.

| Key | EN | ES | DE | Rationale |
|---|---|---|---|---|
| `pdf.title.invoice` | VAT invoice | Factura | Rechnung | ES/DE don't prefix the title with the tax name |
| `pdf.title.credit_memo` | Credit memo | Factura rectificativa | Rechnungskorrektur | DE *Gutschrift* legally means self-billing (§14 UStG), so it is avoided. *Nota de crédito* is LatAm; *rectificativa* is understood everywhere |
| `pdf.title.debit_memo` | Debit memo | Nota de cargo | Belastungsanzeige | |
| `pdf.title.receipt` | Receipt | Justificante de pago | Zahlungsbestätigung | Mirrors PL "Potwierdzenie wpłaty" (a payment confirmation, not a fiscal receipt) |
| `pdf.tax_id` | Tax ID | NIF | USt-IdNr. | The field holds a VAT ID in B2B practice. ES: *NIF* is Spain's universal tax number |
| `pdf.columns.tax` / `tax_rate` | VAT / VAT % | IVA / % IVA | USt. / USt. % | *IVA* is the Spain and LatAm term. *USt.* is the legal term (*MwSt.* is colloquial). DE PDF uses `USt. %` because "USt.-Satz" splits mid-word in the 36pt column (the UI keeps "USt.-Satz") |
| `pdf.vat_summary` | VAT summary | Resumen de IVA | USt.-Übersicht | |
| `pdf.totals.net` / `tax` / `gross` | Total net / Total VAT / Total due | Base imponible / Total IVA / Total a pagar | Nettobetrag / USt.-Betrag / Zahlbetrag | |
| `pdf.totals.credited` | Total credited | Total abonado | Gutgeschriebener Betrag | |
| `pdf.columns.unit_net` | Unit net | Precio unit. | Einzelpreis netto | DE needs the header wrap check |
| `pdf.columns.quantity` | Qty | Cant. | Anz. | "Menge" splits mid-word in the 30pt column, so the PDF uses *Anz.* (the UI keeps "Menge") |
| `pdf.seller` / `buyer` | Seller / Buyer | Emisor / Cliente | Rechnungssteller / Rechnungsempfänger | Standard invoice wording, not "vendedor/comprador" |
| `pdf.meta.service_period` | Service period | Periodo de servicio | Leistungszeitraum | DE: the §14 UStG term |
| `pdf.meta.corrects` / `of` | Corrects / of | Rectifica / de | Korrigiert / vom | |
| `pdf.payment.title` | Transfer title | Concepto | Verwendungszweck | The value is the invoice number, which the payment matcher depends on. Only the label changes |
| `pdf.watermark.draft` / `test` | DRAFT / TEST | BORRADOR / PRUEBA | ENTWURF / TEST | |
| `email.invoice.greeting` | Hello {name}, | Estimado/a {name}: | Guten Tag {name}, | ES uses a colon after the salutation |
| `email.invoice.closing` | Kind regards, | Atentamente, | Mit freundlichen Grüßen | DE closes with no comma |

### 4. Contract drift cleanup

- `openApi` descriptions in `api/accounts/route.ts` and `api/invoices/[id]/pdf/route.ts` interpolate `INVOICE_LANGUAGE_CODES.join(', ')` instead of prose "en / pl".
- The `data/entities.ts:86` comment points to the registry. `manuals/billing-ui-testing.md:222` lists the 4 languages.

### Design Decisions

| Decision | Rationale |
|---|---|
| `intlLocale` lives on the registry, not in a separate map | One edit adds a language. The old two-map design caused the silent-fallback bug |
| Default region `es-ES`, `de-DE` | Matches the "Spain-first, Germany-first" glossary. Without a country dimension, `de-AT`/`de-CH` customers get German number formats, which is acceptable |
| No DB constraint on `invoice_language` | Unchanged. Validation stays in Zod so the list can grow without migrations |
| Existing accounts unaffected | Values `en`/`pl` stay valid. Unknown legacy values resolve to `en` through `resolveInvoiceLanguage`, as today |
| Frozen PDFs not re-rendered | Posted documents are frozen attachments. Changing an account's language affects only future renders and drafts, as today |

## User Stories

- A **billing operator with a Spanish or German UI locale** wants the billing screens in their language, so the whole back office reads consistently. → dictionaries (§2)
- A **billing operator** wants to set a Spanish or German customer's invoice language, so the customer gets documents they can read. → registry (§1)
- A **Spanish or German customer** wants their invoice, memo, receipt and invoice email in their language, with local number and date formats. → glossary (§3), `intlLocale`
- A **future maintainer** adding a language wants one place to edit, with a test that fails if anything is missing. → registry plus guardrail tests

## Data Models

**No entity changes, no migration.** `BillingAccount.invoiceLanguage` (`text`) accepts two more values through the Zod enum derived from the registry.

## API Contracts

Additive and non-breaking. No new routes, no auth or ACL changes, no tenant-scoping changes.

| Route | Change |
|---|---|
| `POST /api/billing/accounts`, `PUT /api/billing/accounts` | `invoiceLanguage` enum `en \| pl` → `en \| es \| de \| pl` (default `en`). Error unchanged: 422 with Zod issue on `invoiceLanguage` for unsupported values |
| `GET /api/billing/accounts` (list/detail) | Unchanged shape. May now return `es`/`de` |
| `GET /api/billing/invoices/{id}/pdf` | Unchanged shape. Labels follow `invoice_language` across the 4 languages. `openApi` description updated |
| Invoice email delivery (internal) | Subject and body follow `invoice_language` |

Versioning: `@dainamite/billing` **minor** bump through a changeset (`.changeset/billing-multi-language.md`). Consumers need no action beyond `yarn generate`.

## Implementation Plan

### Phase 1 — Registry and plumbing (no new strings yet)

1. Extend the `lib/invoiceLanguages.ts` registry with `intlLocale`, plus `resolveInvoiceLanguage()` and `invoiceIntlLocale()`. Assert that the codes are framework `Locale`s at compile time. **Test:** `__tests__/lib/invoiceLanguages.test.ts` covers resolve and normalize (`' ES '` → `es`), the unknown → `en` fallback, and the intl mapping.
2. Make `documentLocale()` delegate to the registry and delete `LOCALE_BY_LANGUAGE`. **Test:** extend `invoiceModel` tests to check `es` money `1234,56 €`-style output and `de` `1.234,56 €` / `15.11.2026`.
3. Make `loadDocumentTranslator` and `invoiceDelivery` use `resolveInvoiceLanguage`. **Test:** the loader is called with `es` for an `es` account (injected `loadTranslator` spy).
4. Replace the "en / pl" prose in the `openApi` descriptions, the entity comment and the manual.

Until Phase 2 lands the registry still contains only en/pl. This phase is a behavior-preserving refactor and can merge on its own.

### Phase 2 — Spanish (priority)

1. Add `i18n/es.json` with all 878 keys, following the glossary in §3 and checking terminology against core `sales/i18n/es.json`.
2. Add `{ code: 'es', label: 'Español', intlLocale: 'es-ES' }` to the registry.
3. Run `yarn generate` and check that `modules.app.generated.ts` imports `billing/i18n/es.json`.
4. **Tests:**
   - The `__tests__/i18n/dictionaries.test.ts` parity test covers every `i18n/*.json`: same key set as `en.json`, the same `{placeholder}` set per key, no empty values. It is written generically so it picks up `de.json` automatically.
   - Registry ↔ dictionary: every registry code has an `i18n/<code>.json` containing every `billing.pdf.*` and `billing.email.*` key.
   - PDF text extraction (`invoicePdf.test.ts`, widen `model(language: InvoiceLanguageCode)`) for an `es` invoice and an `es` credit memo: title, column headers, totals and the `Concepto` line carrying the invoice number.
   - Email builder: `es` subject and body.
5. **Manual check:** switch the UI locale to Español and click through accounts, items, runs, invoices, payments and settings to check for clipped labels. Render a draft PDF for a Spanish account.

### Phase 3 — German

1. Add `i18n/de.json` with all 878 keys, following the glossary and checking terminology against core `sales/i18n/de.json`.
2. Add the registry entry, then run `yarn generate`.
3. **Tests:** the parity test picks up `de` automatically. Add PDF extraction for a `de` invoice and memo, plus a **layout case**: every column header, in every language, wraps with the real embedded font into ≤ 3 lines and no word is cut mid-word.
4. **Manual check:** German UI click-through, plus a draft PDF render.

### Phase 4 — Release

1. Add the changeset (minor), with release notes listing the new languages and the "no action besides `yarn generate`" note.
2. Validation gate: `yarn typecheck`, `yarn test` (billing), the i18n check, `yarn build`.
3. Update the Changelog and the implementation status below.

## Risks

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Machine-drafted legal terms are wrong or awkward for a native reader | Medium | The glossary pins every customer-facing term with a rationale. Terminology matches the framework's own `es`/`de` dictionaries | No native review (accepted for the demo). Revisit before a paying ES/DE customer |
| A neutral wording is legally wrong in one jurisdiction (e.g. Austrian *Leistungszeitraum* nuances, LatAm *Nota de crédito*) | Low | Spain-first and Germany-first choices are documented | A country split is a future spec |
| German labels overflow table columns | Medium | Headers already wrap. A dedicated layout test is added in Phase 3 | Very long customer-entered descriptions still wrap, as today |
| A future language is added to the registry but its dictionary is forgotten (or the reverse) | Medium | The registry ↔ dictionary test plus the compile-time `Locale` assertion | — |
| A placeholder is mistranslated (`{numero}` instead of `{number}`), so a raw token appears on the PDF or email | High | The parity test asserts identical placeholder sets per key | — |
| The payment matcher breaks because the transfer-title label changed | Low | The matcher looks for the invoice **number**, not the label. The PDF test asserts the number is on the `Concepto` / `Verwendungszweck` line | — |
| Picklist reorder (PL moves to 4th) confuses existing Polish operators | Low | Endonym labels; cosmetic only | — |

## Spec Checklist

| Item | Status |
|---|---|
| TLDR scope, value and boundaries | ✓ |
| MVP explicit, future work deferred (FR, KO, country split, settings narrowing) | ✓ |
| Stories map to sections | ✓ |
| Phases testable and incrementally deliverable (Phase 1 behavior-preserving) | ✓ |
| Cross-module links: none added. Terminology is read from core/sales dictionaries, not imported | ✓ |
| Tenant isolation | N/A: no queries or entities added |
| DI | N/A: pure modules. The translator loader stays injectable for tests |
| Events | N/A: none added or changed |
| Entities / migrations | N/A: no schema change |
| Zod validation | ✓ enum derived from the registry |
| Auth guards | N/A: routes unchanged |
| Commands / undo | N/A: no new mutations. Changing an account's language goes through the existing undoable account update command |
| `openApi` | ✓ descriptions derived from the registry |
| i18n keys planned | ✓ that is the feature |
| Pagination | N/A |
| Risks with severity and mitigation | ✓ |

## Changelog

- 2026-11-15 — Skeleton from user request (Spanish UI and invoice template, plus FR/DE alongside EN/PL). Open questions Q1–Q3 raised.
- 2026-11-15 — Answers applied: French and Korean skipped, agent-drafted translations with no sign-off, one neutral wording per language. Added glossary, design, API contract and phases. Dropped the "PL identical-to-EN" tidy-up: all 29 cases are legitimate.
- 2026-11-15 — Implemented Phases 1–4. Glossary amended: DE PDF `Anz.` and `USt. %`, so headers fit their columns.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Registry and plumbing | Done | 2026-11-15 | Registry carries `intlLocale` + `satisfies Locale` guard; `resolveInvoiceLanguage` used by PDF + email; `openApi` descriptions derived from the registry |
| Phase 2 — Spanish | Done | 2026-11-15 | `es.json` (878 keys), registry entry, model + render tests |
| Phase 3 — German | Done | 2026-11-15 | `de.json` (878 keys), registry entry, model + render tests; real-font header test caught 2 overflowing labels (see glossary) |
| Phase 4 — Release | Done | 2026-11-15 | Changeset `.changeset/billing-multi-language.md` (minor). Gate: `yarn generate` ✓, `yarn typecheck` ✓, billing unit tests 698/698 ✓, package build ✓, app `yarn build` ✓. Manual UI click-through (Phase 2.5 / 3.4) not run |

### Implementation notes

- The `cpq-billing-connector` package has **no** i18n dictionaries (§2 assumed `{es,de}.json` there). Terminology is aligned with core `sales` only.
- UI terms chosen beyond the glossary — ES: bill run *Ejecución de facturación*, billing item *Concepto*, usage *Consumo*, top-up *Recarga*, statement *Extracto*, post *Emitir*, credit memo *Factura rectificativa* (sales says *Nota de crédito*). DE: *Abrechnungslauf*, *Abrechnungsposition*, *Nutzung*, *Aufladung*, *Kontoauszug*, *buchen*. Prepaid/Postpaid stay as loanwords in DE. *Gutschrift* is not used anywhere in `de.json`.
- `billing.accounts.form.cycle_anchor.weekly_hint` is the placeholder of a free-text input that accepts only `mon`–`sun`, so it stays literal in every language. This also fixes the pre-existing PL value `pon | wt | … | nd`.
- `invoiceTemplate.ts` now exports `wrap` and `TABLE_COLUMNS` (test-only use).
- The app consumes billing from `dist/`, so code changes need `node build.mjs` in `packages/billing`. Dictionaries are served from `src/` (§ Current State).
