---
'@dainamite/billing': minor
---

Spanish and German for the billing UI and billing documents.

- **Billing screens in Spanish and German.** New `i18n/es.json` and `i18n/de.json` (all 878 keys). Operators whose UI locale is `es` or `de` now see billing in their language, consistent with the core modules.
- **Invoice languages `es` and `de`.** `invoiceLanguage` on `POST`/`PUT /api/billing/accounts` now accepts `en | es | de | pl` (additive). Invoices, credit and debit memos, receipts and the invoice email render in the account's language, with `es-ES` / `de-DE` money and date formats. One neutral wording per language (e.g. ES *Factura rectificativa*, *IVA*, *NIF*; DE *Rechnungskorrektur*, *USt.*, *USt-IdNr.*). The payment transfer title still carries the invoice number.
- **Fix:** adding a language no longer falls back to English silently. `lib/invoiceLanguages.ts` is the single source for the picklist, the validator, the `Intl` locale and the document translator, and a test fails if a supported language has no dictionary or a translation drops a `{placeholder}`.
- **Fix (pl):** the weekly cycle-anchor placeholder showed `pon | wt | … | nd`, which the validator rejects. It now shows the accepted values `mon | tue | … | sun`.

No migration. After upgrading run `yarn generate` so the app picks up the new dictionaries.
