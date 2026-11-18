# CPQ — Multi-language UI (EN, ES, DE, PL)

**Date**: 2026-11-15
**Status**: Implemented (2026-11-15). Playwright run pending
**Package**: `@dainamite/cpq` (`packages/cpq/src/modules/cpq/`)
**Related**: [`2026-11-15-billing-multi-language.md`](2026-11-15-billing-multi-language.md). Same language set, same guardrails.

## TLDR

**Key Points:**
- Make the CPQ operator UI translatable and ship **EN, ES, DE, PL** dictionaries, matching billing and the framework's UI locales. French and Korean stay out, as for billing.
- CPQ is **half-wired** today. About 287 keys already go through `t(key, fallback)` but **no dictionary exists**, so every screen renders English for every locale (Polish included). About 580 more user-facing strings are hard-coded in JSX, attributes and column/option definitions.

**Scope:**
1. Ship `i18n/{en,es,de,pl}.json` for CPQ.
2. **Externalize every hard-coded user-facing string** in `backend/`, `components/`, `widgets/` and `workflows/` into `t()` keys.
3. Make CPQ own its generic labels (`cpq.common.*`). Today it borrows `common.*` keys that only some unrelated modules happen to ship (see Problem 3).
4. Guardrail tests: the same key and placeholder parity test as billing, plus a **hard-coded-string scanner** that keeps the externalization from regressing.

**CPQ → Billing Connector: no work (N/A).** `@dainamite/cpq-billing-connector` has no UI, no `t()` calls and no user-facing literals. It reacts to CPQ subscription events and calls the billing API. The only text it produces is the billing-item description `${productName} — ${chargeDescription}`, which is **catalog data**, not UI copy. Translating product and charge names belongs to the framework's entity-translation feature (`translations.ts`) and is a separate future spec.

  *Verified during implementation:* when the connector creates a billing account on `cpq.subscription.activated`, it validates `invoiceLanguage` against **billing's** language registry (`isSupportedInvoiceLanguage`). Spanish and German customers therefore flow through to billing with no connector code change. Only its unit test was updated: it used `de` as the "unsupported" example and now uses `fr`, and it asserts `en/es/de/pl` pass through. Switching it to billing's new `resolveInvoiceLanguage` was deliberately **not** done, because that helper ships only in the next billing release and the connector's peer range `^0.21.0` still allows 0.21.0.

**Decisions (2026-11-15, user):** write a spec, then do the full job: dictionaries plus externalization. Translations are agent-drafted with no native sign-off (demo), and use the same terminology as the billing glossary and core `sales`.

**Out of scope:**
- ACL feature titles in `acl.ts`. The framework does not translate them; core `sales` hard-codes English too.
- Server-side API error messages (English, as across the framework).
- Seed and demo data.
- Catalog/product/charge names (data; see the connector note above).
- The Puffin public calculator (`demo_puffin`, an L3 module).
- Injection-widget `metadata.title` (see Risks).

---

## Problem Statement

1. **No CPQ dictionaries at all.** `packages/cpq/src/modules/cpq/i18n/` does not exist and `yarn generate` imports nothing for CPQ. The ~287 wired keys always fall back to their inline English.
2. **About 580 hard-coded strings** (measured 2026-11-15 by grep: JSX text nodes, `label=`/`placeholder=`/`title=` attributes, and `label:`/`header:`/`title:` properties):

| Area | Hard-coded | Already wired |
|---|---|---|
| `backend/cpq/inventory` | ~88 | 33 |
| `backend/cpq/specifications` | ~87 | 49 |
| `backend/cpq/quotes` | ~59 | 74 |
| `backend/cpq/price-rules` | ~51 (`PriceRuleForm.tsx` has no `useT` at all) | 17 |
| `backend/cpq/offerings` | ~50 | 43 |
| `widgets/injection/*` (quote configurator, order CPQ tab, customer inventory) | ~29 | 0 |
| `backend/cpq/pricing` | ~22 (`ImportPreview.tsx` has no `useT`) | 27 |
| `backend/cpq/wizards` | ~20 | 14 |
| `workflows/steps/*` (quote wizard steps) | ~18 | 0 |
| `backend/cpq/orders` | ~11 | 15 |
| `components/` | ~3 (`StatusPath.tsx` has no `useT`) | 56 |

   The counts are a lower bound. Multi-word fragments, template literals and `toast`/`flash` messages are found during the pass.
3. **Borrowed `common.*` keys break package isolation.** CPQ calls `t('common.back' | 'common.cancel' | 'common.loading' | 'common.inactive', …)`.
   - `common.back`, `common.cancel` and `common.loading` exist only in core `workflows` / `business_rules` dictionaries. Disable those modules and CPQ loses the translation.
   - `common.inactive` exists **nowhere**.
   - CPQ will be published as a standalone package, so it must ship every key it renders.
4. **Locale-blind formatting.** About 46 call sites use `toLocaleString()`/`toFixed` directly. Numbers and dates follow the browser rather than the UI locale. This is in scope only where a string is concatenated around a number (e.g. `"3 items"` becomes `t('…', '{count} items', { count })`). A wider formatting refactor is not in scope.

## Proposed Solution

### 1. Dictionary files

- `i18n/en.json` is the **source of truth**. It holds every key CPQ renders: the existing ~287 plus the new ones. Flat keys, sorted by key.
- `i18n/es.json`, `de.json` and `pl.json` mirror its keys and placeholders exactly.
- They are discovered by `yarn generate` as for billing. `package.json` already exports `./*/*/*/*.json` from `src/`.

### 2. Key naming

The existing convention is kept: `cpq.<area>.<screen|component>.<element>`, with camelCase area segments as already used (`cpq.priceRules`, `cpq.priceAdjustments`).

| Area | Prefix |
|---|---|
| Shared generic labels | `cpq.common.*` (back, cancel, loading, active, inactive, yes, no, save, saving, edit, delete) |
| Status values / enums | `cpq.<area>.status.<value>`, `cpq.<area>.<enum>.<value>` — the enum value is the key, never the label |
| Quote wizard steps | `cpq.wizard.steps.<step>.*` |
| Injection widgets | `cpq.widgets.<widget>.*` |

Each existing `t('common.x', …)` call is renamed to `t('cpq.common.x', …)`.

### 3. Externalization rules

- **Client components:** `const t = useT()`, then `t('key', 'English fallback')`. Always pass the English fallback, matching the existing CPQ style. **Server components / page loaders:** `resolveTranslations()`.
- **Interpolation, not concatenation:** `` `${n} items` `` becomes `t('…', '{count} items', { count: n })`. Word order differs in ES/DE/PL.
- **Column, option and step definitions at module scope:** move them inside the component (or a `build…(t)` factory) so they can call `t`. Never translate at import time.
- **Enum display:** the value stays the key (`status: 'active'`) and only the rendered label goes through `t`. Persisted values, API payloads, query params and test ids **never change**.
- **Not externalized:** product, charge and customer names and other data; `data-testid`/`id`/`key` values; units and codes (EUR, `kWh`, ISO dates); `console.*` logs; `openApi` text.
- `page.meta.ts`: the 3 pages without `pageTitleKey` get one, and breadcrumbs get `labelKey`.

### 4. Terminology

Reuse the billing glossary and core `sales` wording.

| Concept | ES | DE | PL (core sales) |
|---|---|---|---|
| quote | Presupuesto | Angebot | Oferta |
| order | Pedido | Auftrag / Bestellung (follow core sales `de.json`) | Zamówienie |
| offering | Oferta comercial | Angebot (Produktangebot) | Oferta produktowa |
| specification | Especificación | Spezifikation | Specyfikacja |
| charge | Cargo | Gebühr / Preisposition | Opłata |
| price rule | Regla de precio | Preisregel | Reguła cenowa |
| pricing table | Tabla de precios | Preistabelle | Tabela cen |
| inventory (customer) | Inventario | Bestand | Inwentarz |
| subscription | Suscripción | Abonnement | Subskrypcja |
| amend / renew / cancel (ARC) | Modificar / Renovar / Cancelar | Ändern / Verlängern / Kündigen | Zmień / Odnów / Anuluj |
| wizard | Asistente | Assistent | Kreator |

The translation agents confirm each term against core `sales/i18n/<lang>.json` first, and the core term wins wherever it exists. The "quote" vs "offering" clash in ES/PL ("Oferta") is resolved by keeping *Oferta* for offering only where the core does not already use it for quote. The chosen terms are recorded in the Implementation notes.

## Data Models / API Contracts

**None.** No entity, migration, route, ACL or event changes. Labels and the `i18n/` folder are the only public-surface changes. The package gets a **minor** bump because the new dictionaries are additive, and a changeset is required.

## Implementation Plan

### Phase 1 — Foundation

1. Create `i18n/en.json` from every existing `t(key, fallback)` call: key → fallback. Where the same key has divergent fallbacks, pick one and report it.
2. Add the `cpq.common.*` keys and rename the borrowed `common.*` calls.
3. `__tests__/i18n/dictionaries.test.ts`: the same as billing (key and order parity, placeholder parity, no empty values), plus **"every `t('cpq.…')` key used in source exists in `en.json`"**. Missing keys and orphaned keys are both reported.
4. `__tests__/i18n/hardcodedStrings.test.ts`: scans `backend/ components/ widgets/ workflows/ *.tsx` for JSX text nodes and `label|placeholder|title|aria-label=` string literals that start with a letter. It allows only an explicit, commented allowlist for brand and units. It is written now with the current offenders as an allowlist **baseline** that each phase shrinks, and it ends at zero.

### Phase 2 — Externalization (parallel by area; areas touch disjoint files)

| Batch | Files |
|---|---|
| A | `backend/cpq/quotes`, `backend/cpq/orders`, `workflows/` (wizard steps), `widgets/injection/quote-configurator`, `widgets/injection/order-cpq-tab` |
| B | `backend/cpq/specifications`, `backend/cpq/offerings` |
| C | `backend/cpq/inventory`, `widgets/injection/customer-inventory` |
| D | `backend/cpq/price-rules`, `backend/cpq/pricing`, `backend/cpq/wizards`, `components/` |

Each batch:
- writes its new keys to a fragment file (merged into `en.json` by the coordinator, so no concurrent writes to one file);
- removes its files from the scanner baseline;
- keeps behavior identical, so existing unit tests stay green;
- uses no new `any`.

### Phase 3 — Translations

1. Draft `es.json`, `de.json` and `pl.json` (one agent each) with full parity, following the terminology table and the billing glossary.
2. Run the parity tests.

### Phase 4 — Verification and release

1. `yarn generate` (check that CPQ i18n imports appear), `yarn typecheck`, CPQ and billing unit tests, `node build.mjs` in `packages/cpq`, and the app `yarn build`.
2. Run the existing CPQ Playwright specs that select by visible English text, because the English fallbacks are unchanged and they must still pass. Run at least the quote-wizard spec.
3. Add a changeset for `@dainamite/cpq` (minor).
4. Update this spec's status and notes.

## Risks

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Refactor changes behavior (column defs moved, enum value accidentally translated and sent to the API) | High | Rule: values never pass through `t`. The existing unit and integration tests must stay green, and per-batch diff review | Low |
| Integration tests select by English text and break | Medium | English fallbacks are byte-identical to the current literals. `en.json` values are copied from the literals, not reworded | — |
| Missed strings leave a mixed-language UI | Medium | Scanner test with a shrinking baseline | Multi-line or template-built strings the regex can't see. Click-through check |
| Injection-widget tab labels | Low | **Resolved for sales:** the sales document page translates `placement.groupLabel` as a key (`t(groupLabel, metadata.title)`), so the quote and order tabs use `cpq.widgets.*.tab` keys. **Not for customers:** legacy customer detail pages render `groupLabel` verbatim (v2 pages translate it) | The customer "Inventory" tab label and the widget `metadata` title/description stay English. Framework gap: v1 customer pages should translate `groupLabel` |
| ES/PL "Oferta" ambiguity (quote vs offering) | Medium | Terminology table; the core term wins; recorded in notes | Native review later |
| Dictionary drift in future CPQ work | Medium | The "every used key exists" test fails CI on any `t('cpq.x')` without an `en.json` entry | — |

### Implementation notes

- **Final terminology** (core `sales` wins):

  | | ES | DE | PL |
  |---|---|---|---|
  | quote | **Cotización** (not *Presupuesto*) | Angebot | Oferta |
  | offering | Oferta comercial | Produktangebot | **Produkt handlowy** (avoids the "Oferta" clash) |
  | order | Pedido | **Bestellung** (core sales majority; it also uses *Auftrag*) | Zamówienie |
  | charge | Cargo | Gebühr | Opłata |
  | inventory | Inventario | Bestand | Inwentarz |
  | wizard "surface" (backend/portal) | Interfaz | Oberfläche | Interfejs |

- **Sentences with inline `<strong>`/`<em>`/`<a>`** are split into fragment keys (no rich-text `t` helper exists). Translators checked render order; DE `bulk.notice` was reworded after review.
- **Polish plurals:** only `.one`/`.other` keys exist, so `.other` uses count-neutral forms ("Pozycje: {count}").
- **Structural refactors:**
  - module-scope label maps became `build…(t)` factories or `switch` helpers with static keys (rule types are deduplicated in `PriceRuleForm.tsx`);
  - `xlsxImport` takes `t`;
  - `KeyLabelListEditor` gets an `addLabel` prop (it was `title.slice(0,-1)`);
  - wizard step registry entries carry `labelKey`/`descriptionKey`.
- **Left English on purpose:** raw enum values shown as data, the XLSX export headers (file format; the importer matches them), the developer invariant errors in `workflows/engine.tsx`, and wizard definition names (data).
- **Lint:** two detail-page mount effects call `t` without listing it in their dependencies, to keep behavior identical. `exhaustive-deps` may warn.

- **Row-action messages are noun-free.** `useCpqRowActions` spliced `entityName` into sentences (`Delete this ${entityName}?`, `${entityName}s deleted`), which can't be grammatical in ES/DE/PL. Messages are now count-based (`Delete selected items ({count})?`), and `entityName` is optional and `@deprecated`. This is a deliberate English copy change; no test depended on it.
- **`cpq.inventory.title` conflict.** The sidebar/page meta said "CPQ Subscriptions" while the page heading said "Customer Inventory" under the same key. The sidebar now uses `cpq.inventory.nav.title`, so both labels stay unchanged.
- **Borrowed keys removed.** `common.back`, `common.cancel` and `common.loading` were found only in core `workflows`/`business_rules`. `common.inactive` existed nowhere.

## Changelog

- 2026-11-15 — Spec created from user request ("add these languages to CPQ and CPQ→Billing Connector"). The connector is assessed as N/A. Scope chosen by user: full externalization plus EN/ES/DE/PL dictionaries.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Foundation | Done | 2026-11-15 | `en.json` built from source with a TS-AST extractor (327 keys, including 4 expanded fallback maps). `cpq.common.*` replaces the borrowed `common.*`. Parity, used-key, orphan and hard-coded-string tests added. The AST scanner found **829** hard-coded strings (the grep estimate was ~580) |
| Phase 2 — Externalization | Done | 2026-11-15 | 4 parallel batches; scanner at **0 offenders** (6 allowlisted widget-metadata strings). `en.json` regenerated from source: **1218 keys**, 0 fallback conflicts, no dynamic keys added (the 4 existing fallback maps were expanded). English text byte-identical except the row-action messages (see notes) |
| Phase 3 — Translations | Done | 2026-11-15 | `es/de/pl.json`, 1218 keys each, parity and placeholder tests green |
| Phase 4 — Verification and release | Partly done | 2026-11-15 | `yarn generate` ✓ (4 CPQ dictionaries imported), `yarn typecheck` ✓, unit tests across cpq, connector, billing and app modules 1661/1661 ✓, `@dainamite/cpq` build ✓, app `yarn build` ✓, changeset `.changeset/cpq-multi-language.md` ✓. **Playwright CPQ suite (TC-CPQ-*, TC-CPQ-ARC-*) not run:** port 3000 was serving a different project, so it needs this repo's app running |
