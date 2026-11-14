# Billing — Billing Account Workspace, B2C Accounts, Invoice Language, Navigation (Spec E)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed, ready for implementation planning review.
**Owner**: Mac
**Target**: `@dainamite/billing`
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (WS-7, decisions D20–D23)
**Sequencing**: Phase 1 (B2C, language picklist, navigation) is independent and can ship **before Spec 0**. Phases 2–3 (workspace tabs and summaries) assemble the UI of Specs 0, B, C, D, so each tab lands with its spec.

---

## TLDR

1. **Billing Account workspace**: the account detail page becomes the operator's single place for a customer's billing. A **summary header** (balance due, overdue, credit, next bill date, and for prepaid the balance) plus **tabs**: Overview · Items · Usage · Invoices · Payments · (prepaid) Balance & Top-ups · Statements · Bill runs. Header actions: Add item, Record payment, Run billing for this account.
2. **B2C accounts**: an account can belong to a **company or a person** (`customer_kind`). The form has a Company / Person switch and the matching lookup. The tax ID is optional for persons.
3. **Invoice language picklist**: choices come from the languages the built-in PDF template supports, narrowed to those enabled in `BillingSettings`. Default from settings.
4. **Navigation**: item and usage pages opened from an account return to **that account** (back button, after save, after delete). Breadcrumbs show the account.
5. **Account list**: shows the customer name (not the raw id) and adds Balance due / Overdue columns and an "Has overdue" filter.

---

## Design Decisions

| # | Decision |
|---|---|
| E2-D1 | The name stays **"Billing Account"** everywhere (UI, API, entities, manuals). No rename. |
| E2-D2 | **Prefill from the customer record** on selection, only into empty fields and always editable: name ← `display_name`, `invoice_email` ← `primary_email`, `invoice_address` ← the customer's **primary address** (`/api/customers/addresses`, `is_primary`). (Core customers have **no tax-ID field**, so `tax_id` is not prefilled.) The account keeps its own copy, with no live sync. A failed or unavailable lookup leaves the fields blank (soft dependency). |
| E2-D3 | **"Run billing"** header action on the account: a dialog with mode (Test / Dry-run / Real, default Test) + as-of date (default today). It triggers `POST /api/billing/runs` with `scopedAccountIds: [id]` and shows the outcome inline (cycles, documents created with links, skipped items) without leaving the page. Requires `billing.run.trigger`, or `billing.run.dry_run` for dry-run only. |

---

## Current State (verified 2026-11-14)

- Account detail (`backend/billing/accounts/[id]/page.tsx`): stacked sections: account fields, PrepaidPanel (prepaid only), Items, Usage. No invoices, payments or totals.
- Account list: shows `customer_id` as a raw UUID. No financial columns.
- `AccountForm`: the customer combobox queries **`/api/customers/companies` only**. Persons can't be selected. `invoice_language` is a free-text input (default `en`).
- Core customers: companies and people share `customer_entities` (`kind`, `display_name`, `primary_email`). `customer_id` on the account already fits either. Only the lookup and the label are company-specific.
- Item detail: back → `/backend/billing/items`, delete → items list. Item create: back/cancel → items list, even when opened from an account via `?billAccountId=`. (Usage create already returns to the account correctly.)
- `@open-mercato/ui` has `tabs`, `status-badge`, `content-card` primitives.

---

## Proposed Solution

### 1. B2C: company or person
- `BillingAccount.customer_kind text not null default 'company'` (`company | person`). Immutable after create, like `customer_id`.
- Form: a segmented control **Company / Person**. The lookup switches between `/api/customers/companies` and `/api/customers/people`. The label shows `display_name` + email. Prefill per E2-D2.
- Validation: `tax_id` required for `company`? *No. Kept optional for both* (today it's optional). The PDF prints the buyer tax ID only when present.
- The account list and detail show a kind icon (`Building2` / `User` from lucide) next to the customer name. Names are resolved with **one batched call per page** (no per-row fetch). The API enriches list rows with `customer_name` via a batched lookup on `customer_entities` by id.
- Connector: `cpq.subscription.activated` passes `customerKind` when CPQ knows it. Default `company`.
- *Dependency note:* the customer lookup is a **UI/REST soft dependency** on the customers module (FK-string `customer_id`, no import). Billing still works if the lookup is unavailable: the form falls back to a plain customer-ID input. This keeps D19 ("no core business-module dependency").

### 2. Invoice language picklist
- Code registry `lib/pdf/languages.ts`: `SUPPORTED_INVOICE_LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'pl', label: 'Polski' }]`. This is the set the built-in template has labels for (Spec B). Adding a language = adding template labels + one registry entry.
- `BillingSettings` (+): `enabled_invoice_languages text[]` (default all supported), `default_invoice_language` (default `en`).
- `GET /api/billing/settings` returns `{ supportedInvoiceLanguages, enabledInvoiceLanguages, defaultInvoiceLanguage }`. The account form renders a select from the **enabled** list, preselects the default, and the validator rejects values outside the enabled list (422 `billing.account.invoice_language_unsupported`).
- Settings page: a multi-select of supported languages + the default.

### 3. Navigation
- Rule: **an item or usage page opened in the context of an account returns to that account.**
  - Item create with `?billAccountId=` → cancel/back/after-save → `/backend/billing/accounts/{id}` (Items tab).
  - Item detail → back → the item's own account (`bill_account_id`) by default. When opened from the global Items list (`?from=items`), back → the Items list. Delete → the same target.
  - Breadcrumbs stay static (`page.meta.ts` can't render the account name). The back button and redirects carry the return-to-account behaviour.
- Tabs are deep-linkable (`?tab=items|usage|invoices|payments|…`), so "back to account" lands on the tab the user came from (`returnTo` includes the tab).
- The same rule applies to the new pages from Specs C/D (payment detail, invoice detail opened from an account → back to the account's tab).

### 4. Billing Account workspace

**Summary header** (cards, from `GET /api/billing/accounts/{id}/summary`, a single query set, no per-row fetch):

| Card | Postpaid | Prepaid |
|---|---|---|
| Balance due | Σ outstanding of posted invoices + debit memos | — |
| Overdue | amount + count (computed, Spec B) | — |
| Available credit | unallocated payments + credit memos (Spec C/D) | — |
| Balance | — | current balance + status badge (ok / low / exhausted, existing) |
| Credit limit | existing credit status | existing credit status |
| Next bill date | `next_bill_date` + cycle | same |
| Last invoice / statement | number, date, gross | statement period, closing |

`ar-summary` from Spec B is folded into this endpoint.

**Tabs**

| Tab | Content | Source spec |
|---|---|---|
| Overview | Account details (view/edit), invoice settings (language, terms, auto-send, email), recent activity: last 5 documents + last 5 payments | E, B |
| Items | Existing items table + "Add item" (returns here) | existing + E |
| Usage | Existing usage table + "Add usage" | existing |
| Invoices | All documents of the account: invoices, credit / debit memos, receipts. Type, number, dates, gross, outstanding, status, overdue badge. Row actions: open, PDF, send | 0, B, D |
| Payments | Payments assigned to the account + allocations. "Record payment" (manual entry, Spec C) | C |
| Balance & Top-ups *(prepaid)* | Existing PrepaidPanel content (balance, transactions, top-ups) | existing |
| Statements *(prepaid)* | Existing statements filtered to the account | existing |
| Bill runs | Run outcomes for this account (status, cycles, documents) | A |

Header actions: **Edit**, **Add item**, **Record payment** (postpaid), **Top up** (prepaid, when the gateway is available, E-D1), **Run billing** (E2-D3), **Soft delete**.

**Account list**: columns Customer (name + kind icon), Mode, Currency, Next bill date, **Balance due**, **Overdue** (red when > 0). Filter **Has overdue**. Totals come from a batched aggregate in the list API (`GROUP BY bill_account_id` over the page's ids). No N+1.

All tables use DataTable with pagination props (repo rule). Tab content is lazy-loaded on first open.

---

## Data Models
- `BillingAccount` (+): `customer_kind text not null default 'company'`.
- `BillingSettings` (+): `enabled_invoice_languages text[]`, `default_invoice_language text`.

## API Contracts

| Method + path | Change |
|---|---|
| `POST /api/billing/accounts` | + `customerKind`. `invoiceLanguage` validated against enabled languages. |
| `GET /api/billing/accounts` | + `customer_kind`, `customer_name`, `balance_due`, `overdue_amount`. Filter `hasOverdue=true`. |
| `GET /api/billing/accounts/{id}/summary` | **new** (replaces Spec B's `ar-summary`) |
| `GET /api/billing/settings` | + language lists |
| `POST /api/billing/runs` | existing `scopedAccountIds` used by "Run billing" (E2-D3). The response must include per-account outcome + cycles for the inline result. |

All routes export `openApi`. No new ACL features (uses `billing.account.view` / `manage`, `billing.run.trigger`).

---

## Implementation Plan

### Phase 1: Quick wins (can ship now, before Spec 0)
1. `customer_kind` + form switch + people lookup + prefill (E2-D2, including the primary address). Customer name in the list (batched). Connector passthrough.
2. Language registry + settings fields + picklist (if `BillingSettings` isn't there yet, the registry list alone drives the picklist and settings narrowing comes with Spec 0).
3. Navigation rule for item create/detail/delete + breadcrumbs. Usage create already conforms.
4. Unit tests: validators (kind, language), the return-target resolver (pure function). Integration: create account → add item → back lands on the account.

### Phase 2: Workspace shell
0. "Run billing" dialog + inline outcome (E2-D3). Works today against the existing engine, and shows multiple cycles once Spec A lands.
1. Tabs layout, deep-linkable, lazy tabs. Move existing sections into tabs. Summary endpoint (postpaid fields filled as Specs B/C/D land; prepaid fields from existing services).
2. Account list financial columns + filter.

### Phase 3: Tabs per spec
Invoices tab with Spec 0/B. Payments tab + Record payment with Spec C. Memos in the Invoices tab with Spec D. Bill runs tab + Run billing with Spec A.

### Docs
`manuals/billing-ui-testing.md`: new walkthrough "Billing account workspace" (B2C person account → item → test run → invoice → payment → summary).

---

## Risks

| Risk | Mitigation |
|---|---|
| The summary gets slow on accounts with many documents | Indexed columns on `billing_invoices` (Spec 0). Aggregate SQL, no ORM hydration. |
| Customers module not installed | Fallback to the raw ID input. Names show as the id. |
| Tab sprawl on small accounts | Prepaid-only tabs hidden for postpaid and vice versa. Empty states with a primary action. |

---

## Changelog
- 2026-11-14 — Draft from user requests: account workspace UI, B2C person accounts, invoice language picklist, return-to-account navigation.
- 2026-11-14 — E2-Q1..E2-Q3 resolved: keep "Billing Account", prefill name/email/primary address, "Run billing" per account.
- 2026-11-14 — Phase 1 plan: `.ai/runs/2026-11-14-billing-account-workspace-phase1/PLAN.md`. Tax-ID prefill dropped (no core field). Breadcrumbs stay static.
