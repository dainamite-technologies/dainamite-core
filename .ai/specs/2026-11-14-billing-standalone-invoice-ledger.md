# Billing — Standalone Invoice Ledger: Decouple from Core Sales (Spec 0)

**Date**: 2026-11-14
**Status**: Draft. Decisions agreed, ready for implementation planning review.
**Owner**: Mac
**Target**: `@dainamite/billing` (breaking → 0.21.0, reseed required per D14)
**Umbrella**: [`2026-11-14-billing-improvements-requirements.md`](2026-11-14-billing-improvements-requirements.md) (decision D19)
**Sequencing**: **first**, before Specs A–D. Every later spec writes to the tables introduced here.

---

## TLDR

`@dainamite/billing` stops recording anything in Open Mercato's **core `sales`** module. Billing owns its documents end to end:

- **`BillingInvoice` + `BillingInvoiceLine`** (`billing_invoices`, `billing_invoice_lines`) replace `sales_invoices` / `sales_invoice_lines`. They hold invoices, credit memos, debit memos and prepaid top-up receipts (`document_type`).
- **Own numbering** (`BillingDocumentSequence`, gap-free, per org and series), replacing `salesDocumentNumberGenerator`.
- **Own status enum** on the entity, replacing the `sales.invoice_status` dictionary.
- **Own VAT math** (rate × net, per line), replacing core `taxCalculationService`.
- Real columns instead of `metadata` JSON (`bill_account_id`, `bill_run_id`, `bill_date`, `document_type`, `corrects_invoice_id`, `due_date`, …), all indexed. Spec D's cross-module index question disappears.

What billing **keeps** from the platform: auth/RBAC, directory (organizations), events and queue, the shared email transport, attachments (PDF storage). These are framework services, not business records.

---

## Design Decisions

| # | Decision |
|---|---|
| E-D1 | `payment_gateways` stays as an **optional** integration. Billing's `requires` no longer lists it. `paymentGatewayService` is resolved with `container.hasRegistration(...)`. When it's absent: `POST /api/billing/accounts/{id}/topups` returns 501 `billing.topup.gateway_unavailable`, the "Top up" button is hidden, and the gateway subscribers are inert. Bank top-ups still work through Spec C "Convert to top-up". |
| E-D2 | Prepaid settings move from core `configs` (`ModuleConfig`) into the per-organization **`BillingSettings`** (Spec B): `low_balance_threshold_default`, `near_limit_buffer_default`, `statement_enabled`, `topup_tax_rate`. `lib/prepaidConfig.ts` reads `BillingSettings`. `setup.ts` stops seeding `configs`. |
| E-D4 | Drop the unused `billing.uom` dictionary seed, so billing no longer requires `dictionaries` (for now). |
| E-D5 | A minimal Billing settings page ships here (prepaid defaults + number masks). Spec B extends it. |
| E-D6 | Number masks with scoped sequence tokens `{SEQUENCE_NUM}` / `{SEQUENCE_NUM_YEAR}` / `{SEQUENCE_NUM_MONTH}` (see Numbering). |
| E-D3 | Top-up VAT receipts become `BillingInvoice` rows with `document_type = receipt`, series `receipt` (`RC/{yyyy}/{mm}/{seq:5}`), status `paid` at creation, and `topup_id` set. `BillingTopup.receipt_invoice_id` points to `billing_invoices`. Prepaid behaviour is unchanged (D8). |

---

## Problem Statement (verified 2026-11-14)

Billing is coupled to core `sales` in 16 non-test files:

| Dependency | Where | Replaced by |
|---|---|---|
| `SalesInvoice`, `SalesInvoiceLine` entities (10 imports) | `invoiceWriter`, `commands/invoices`, invoice API routes, `run-outcomes`, `test-invoices/wipe`, `accountStatus`, `usageRater`, `topupReceipt`, `export/account`, `payment-captured-to-paid` | `BillingInvoice`, `BillingInvoiceLine` |
| `salesDocumentNumberGenerator` (3) | writer, post command, top-up receipt | `BillingDocumentSequence` + `billingNumberGenerator` |
| `taxCalculationService` (2) | `topupReceipt`, commands | `lib/vat.ts` (pure) |
| `dictionaries` (`sales.invoice_status`) (2) | `invoiceStatus.ts`, `setup.ts` | enum column on `BillingInvoice` |
| `configs` `ModuleConfig` (2) | `prepaidConfig.ts`, setup | `BillingSettings` (E-D2) |
| `payment_gateways` (1 + events) | `commands/topups`, 2 subscribers | optional integration (E-D1) |
| `query_index` subscriber scope (1) | `index.ts` / subscribers | review: keep if billing entities are indexed |
| Raw SQL `metadata->>'bill_account_id'` | invoices list, engine dedupe | indexed columns |
| `index.ts` `requires: [... 'sales', 'dictionaries', 'configs', 'payment_gateways']` | | `requires: ['auth', 'directory']` |

Consequences today: billing invoices appear in core Sales UIs, core sales rules apply to them, the package can't be installed without core `sales`, filtering runs on unindexed JSON, and the xd-249 design premise ("draft invoices in core/sales") contradicts the L2 standalone goal (SPEC-001).

The CPQ connector is already clean (no core imports, `requires: ['cpq', 'billing', 'auth', 'directory']`).

---

## Proposed Solution

### BillingInvoice: `billing_invoices`

| Column | Type | Notes |
|---|---|---|
| `id`, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at` | standard | |
| `bill_account_id` | uuid | FK string (billing's isolation guard forbids all ORM relations, even within the module) |
| `document_type` | text | `invoice \| credit_memo \| debit_memo \| receipt` |
| `number` | text | `DRAFT-…` / `TEST-…` until posted, then the series number. Unique per org when posted. |
| `series` | text, null | `invoice \| credit_memo \| receipt` (debit memos use `invoice`, D-Q1) |
| `status` | text | `draft \| posted \| partially_paid \| paid \| credited` (see below) |
| `test_run` | boolean | |
| `bill_run_id` | uuid, null | |
| `bill_date`, `period_start`, `period_end` | date, null | Spec A |
| `issue_date`, `due_date` | date, null | Spec B |
| `currency_code` | text | |
| `subtotal_net`, `tax_total`, `total_gross` | numeric(18,4) | |
| `paid_total`, `credited_total`, `outstanding` | numeric(18,4) | Spec C/D, recomputed from allocations |
| `corrects_invoice_id` | uuid, null | Spec D (self-reference) |
| `correction_reason` | text, null | Spec D |
| `buyer_snapshot` | jsonb | name, `invoice_address`, `tax_id`, `invoice_email`, language: frozen at post |
| `seller_snapshot` | jsonb | from `BillingSettings` at post |
| `pdf_attachment_id` | uuid, null | Spec B |
| `topup_id` | uuid, null | for `receipt` |
| `metadata` | jsonb | free-form extras only (deliveries log, …) |

Indexes: `(tenant_id, organization_id, status)`, `(bill_account_id, status, due_date)`, `(bill_run_id)`, `(corrects_invoice_id)`, unique `(tenant_id, organization_id, bill_account_id, bill_date, test_run, document_type)` where `document_type='invoice' and deleted_at is null` (the Spec A dedupe guard, now DB-enforced), unique `(tenant_id, organization_id, number)` where `status <> 'draft'`.

### BillingInvoiceLine: `billing_invoice_lines`
Standard columns + `invoice_id`, `line_number`, `billing_item_id?`, `billing_type` (`one_time|recurring|usage|manual`), `description`, `quantity`, `unit_price_net`, `tax_rate`, `net_amount`, `tax_amount`, `gross_amount`, `service_period_start/end?`, `corrects_line_id?`, `metadata` (usage tier breakdown, proration).

### Status model
`draft → posted → partially_paid → paid`, derived after every allocation change. `credited` = fully settled where credit-memo allocations ≥ gross (the honest label for "cancelled by credit memo"). **There is no `void` status.** Per the user's decision, a posted document is only neutralised by a credit memo. Drafts are deleted, never voided.

### Numbering: masks + `BillingDocumentSequence`
Each series (`invoice`, `credit_memo`, `receipt`) has a **number mask** in `BillingSettings`, editable on the Billing settings page. Tokens:
- `{YYYY}` `{YY}` `{MM}` `{DD}` for the issue date;
- exactly one sequence token, which also decides when the counter resets:
  - `{SEQUENCE_NUM}`: never resets;
  - `{SEQUENCE_NUM_YEAR}`: resets every year (needs a year token);
  - `{SEQUENCE_NUM_MONTH}`: resets every month (needs year + month tokens);
- an optional `:N` zero-pad.

Defaults: `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}` → `INV/2026/11/0001` (and `CN/…`, `RC/…`).

`BillingDocumentSequence` holds one counter per `(tenant_id, organization_id, series, scope_key)`, where `scope_key` is `''`, `'2026'` or `'2026-11'`. The counter is claimed at post with a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the post transaction, so it's gap-free (a rollback releases the number). The unique `(org, number)` index prevents repeats after a mask change.

### VAT: `lib/vat.ts`
Pure: `lineVat(net, ratePercent) → { tax, gross }`, half-up 2 dp. Top-up receipts use the gross → net split (`net = gross / (1 + r)`). Unit-tested against the current core service outputs for parity.

### Removal plan
- Delete `lib/invoiceStatus.ts` and the dictionary seeding of `sales.invoice_status`.
- Rewrite `invoiceWriter`, `commands/invoices`, invoice routes, `test-invoices/wipe`, `run-outcomes`, `accountStatus`, `usageRater`, `export/account`, `topupReceipt` onto the billing entities.
- `BillingRunOutcome.draft_invoice_id` keeps its name and now points to `billing_invoices`.
- `payment-captured-to-paid` → becomes the Spec C gateway-payment path (E-D1, inert without the gateway module).
- `index.ts` `requires` is trimmed. `package.json` peer deps reviewed (`@open-mercato/core` stays a peer for auth/directory/attachments).
- A guard test (`package-isolation.test.ts` exists) is extended: **fail if any file imports `@open-mercato/core/modules/sales`, `dictionaries` or `configs`**.

### Data
No data migration (D14): existing billing rows in `sales_invoices` are left in place. Instances are reseeded. The billing seed and `scripts/seed-demo.mjs` are updated.

### API
Routes keep their paths (`/api/billing/invoices…`). Response field names move from core names to billing names (`grand_total_gross_amount` → `total_gross`, `invoice_number` → `number`, plus the flattened metadata). This is a breaking change, documented in CHANGELOG 0.21.0 with a field map. `openApi` is updated on every route.

---

## Impact on Specs A–D

| Spec | Change |
|---|---|
| A | Writes `BillingInvoice` rows. Dedupe guard = DB unique index on `bill_date`. `bill_date` and service periods are real columns. |
| B | Numbering = `BillingDocumentSequence` (no core generator). Statuses = enum (no dictionary seeding). VAT = `lib/vat.ts`. Seller/buyer snapshots frozen at post. Number formats on the settings page. |
| C | Allocations update `billing_invoices.paid_total/outstanding/status`. No `sales_invoices` writes. |
| D | Memos = `document_type` + `corrects_invoice_id` columns. Credit memos on the `credit_memo` series, debit memos on the `invoice` series. **No void** (D-D7). Index risk resolved. |

---

## Implementation Plan

1. **Entities + numbering + VAT**: `BillingInvoice`, `BillingInvoiceLine`, `BillingDocumentSequence`, `lib/vat.ts`, `billingNumberGenerator`. Migration via `yarn mercato db generate`. Unit tests (sequence gap-freedom under rollback, VAT parity).
2. **Writer + engine + post**: rewrite onto the new entities. Engine tests updated.
3. **Routes + UI**: invoice list/detail, run outcomes, wipe, export. Field-map changes in pages.
4. **Prepaid receipts** (E-D3) + settings move into `BillingSettings` (E-D2). This pulls the `BillingSettings` entity forward from Spec B into this spec (Spec B then adds the seller/PDF fields).
5. **Gateway decoupling** (E-D1): optional resolution of `paymentGatewayService`, `requires` trimmed.
6. **Isolation guard test**, seeds, manuals (`billing-ui-testing.md`, `cpq-billing-end-to-end.md`), README, CHANGELOG, and an xd-249 erratum note ("invoices are billing-owned since 0.21.0").

---

## Risks

| Risk | Mitigation |
|---|---|
| Large refactor touching every invoice path | Done first, before features. The existing unit + integration suites are the safety net. Isolation guard test. |
| Losing core Sales UI features (document history, notes, tags) for invoices | Not needed for billing. Our own detail page already exists. |
| VAT rounding drift vs the old core service | Parity tests on representative amounts. |
| Downstream consumers reading `sales_invoices` | None found in repo (the connector reads only billing items). Field map in CHANGELOG. |

---

## Changelog
- 2026-11-14 — Draft. User decision: billing must not record invoices in core sales. Remove core business-module dependencies.
- 2026-11-14 — E-Q1..E-Q3 resolved → E-D1..E-D3 (optional gateway, prepaid settings → BillingSettings, receipts as billing documents). `BillingSettings` entity introduced here.
- 2026-11-14 — Execution plan: `.ai/runs/2026-11-14-billing-invoice-ledger/PLAN.md`. Spec D stays separate; its data groundwork (document types, correction columns, series, `credited` status) is built here. Open items P-Q1..P-Q3 in the plan.
- 2026-11-14 — E-D4..E-D6: drop `billing.uom` dictionary, settings page now, number masks with scoped sequence tokens.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 — Foundations (VAT, entities, masks, settings) | Done | 2026-11-14 | Hand-written migration `Migration20261115000000_billing_invoice_ledger` |
| 2 — Writer, engine, post, draft lines | Done | 2026-11-14 | Number claimed at post under a row lock; unique-index backstop on bill date |
| 3 — Prepaid receipts + settings | Done | 2026-11-14 | Receipts = `document_type receipt`, `RC/…`; prepaid config per org |
| 4 — Optional gateway, `requires`, isolation guard | Done | 2026-11-14 | `requires: ['auth','directory']` |
| 5 — API + UI + settings page | Done | 2026-11-14 | `/backend/config/billing`; invoice API renamed fields |
| 6 — Tests + docs + gate | Done | 2026-11-14 | TC-BILL-006 written, not run (migration pending) |

Deviations: invoice list/detail remain hand-written SQL (no query-index entries for engine-written documents); the settings page follows the framework settings path `/backend/config/billing`.
