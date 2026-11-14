# @dainamite/billing — migration notes

Schema changes ship as MikroORM migrations under
`src/modules/billing/migrations/`. After upgrading the package, run:

```bash
yarn mercato db migrate
```

Migrations are additive and tenant-safe — they never drop or rewrite existing
billing data.

---

## Spec 0 — Standalone invoice ledger (no core sales)

**Migration:** `Migration20261115000000_billing_invoice_ledger.ts`

Creates `billing_invoices`, `billing_invoice_lines`, `billing_document_sequences`
and `billing_settings`. **Billing no longer writes core `sales_invoices`**, and
it no longer depends on core `sales`, `configs` or `dictionaries`
(`requires: ['auth', 'directory']`). `payment_gateways` is optional: without it,
online top-ups return 501 `billing.topup.gateway_unavailable` and the Top up
button is hidden.

### Behaviour changes

- **Numbering at post.** Real drafts carry a temporary `DRAFT-…` number. The
  series number is claimed when the invoice is posted (gap-free). Masks are set per
  organization on the Billing settings page (`/backend/config/billing`).
  The default mask is `INV/{YYYY}/{MM}/{SEQUENCE_NUM_MONTH:4}` (credit memos use `CN/…`,
  top-up receipts `RC/…`). Sequence tokens are `{SEQUENCE_NUM}` (never resets),
  `{SEQUENCE_NUM_YEAR}` and `{SEQUENCE_NUM_MONTH}`.
- **Statuses:** `draft | posted | partially_paid | paid | credited`. **`void` is
  removed.** A posted document is only corrected with a credit memo.
- **Top-up receipts** are billing documents (`document_type = 'receipt'`,
  status `paid`), and `billing_topups.receipt_invoice_id` points to them.
- **Prepaid settings** move from core `configs` rows (tenant-wide) to
  `billing_settings` (per organization, same defaults). Any values you changed in
  `configs` must be re-entered on the settings page.
- **No data migration.** Billing rows already in `sales_invoices` are left
  untouched (D14: reseed). To remove them on an instance:
  `DELETE FROM sales_invoice_lines WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE jsonb_exists(metadata, 'bill_account_id'));`
  then the same predicate on `sales_invoices`.

### Invoice API field map (`GET /api/billing/invoices`, `/invoices/{id}`)

| Before (core sales names) | Now |
|---|---|
| `invoice_number` | `number` |
| `subtotal_net_amount` | `subtotal_net` |
| `tax_total_amount` | `tax_total` |
| `grand_total_gross_amount` | `total_gross` |
| `paid_total_amount` | `paid_total` |
| `outstanding_amount` | `outstanding` |
| `metadata.bill_account_id` / `bill_run_id` / `bill_date` / `test_run` | `bill_account_id` / `bill_run_id` / `bill_date` / `test_run` |
| `metadata.bill_period_start` / `_end` | `period_start` / `period_end` |
| line `total_net_amount` / `total_gross_amount` | `net_amount` / `gross_amount` |
| line `metadata.billing_type` / `service_period_*` | `billing_type` / `service_period_*` |
| — | new: `document_type`, `series`, `credited_total`, `bill_account_name`, `buyer_snapshot`, `seller_snapshot`, `corrects_invoice_id` |

The account export (`GET /api/billing/export/account/{id}`) is `schemaVersion: 3`
with the same names.

---

## Spec A — Billing cycle semantics

**Migration:** `Migration20261114100000_billing_cycle_semantics.ts`

- Adds `billing_items.charge_timing` (`in_advance` default) and
  `billing_items.prorate` (default `true`), plus `billing_run_outcomes.cycles`.
- **Drops `billing_runs.catch_up`.** Every run now catches up on all due cycles.

### Behaviour changes — reseed or review existing data

- **Recurring items are billed in advance by default.** An account's
  `next_bill_date` now marks the START of the period billed in advance (it
  used to mark the day after the period billed in arrears). On existing data,
  the first run after upgrading bills the coming period. Items created before
  the upgrade get `in_advance` too. Per the billing improvements decision D14,
  instances are reseeded instead of migrated.
- **Every run catches up**, whether manual or scheduled, in real, test or dry
  mode: one draft per due bill date up to `asOfDate`, capped at 60 per account.
  `catchUp` is gone from the API; if a client still sends it, it is ignored.
- **Partial periods are prorated, not skipped.** An in-advance item that ends
  after it was billed gets a credit line on the next invoice.
- **Release with `@dainamite/cpq-billing-connector`.** The connector stops
  posting `one_time` proration items. An older connector next to this billing
  version would double-charge mid-cycle additions.

---

## Spec E Phase 1 — B2C billing accounts

**Migration:** `Migration20261114000000_billing_customer_kind.ts`

Additive only. Adds `billing_accounts.customer_kind text not null default
'company'`. Every existing account becomes `company`, which is what it was:
the account form could only pick companies before this release.

### Notes

- Hand-written like the earlier billing migrations: `yarn mercato db
  generate` only diffs `@app` modules, so it does not reach this package
  module. The column mirrors `data/entities.ts` 1:1.
- **API behaviour change:** `invoiceLanguage` is now validated against the
  languages the invoice template supports (`en`, `pl`). Before upgrading, check
  that no integration sends other codes. The CPQ connector falls back to `en`.

---

## SPEC-002 — Prepaid balance billing (XD-304)

**Migration:** `Migration20260619000000_billing_prepaid.ts`

Additive only. Existing (postpaid) accounts are untouched:
`billing_mode` defaults to `'postpaid'`, `credit_limit` to `0`.

### What it adds

| Change | Detail |
|---|---|
| `billing_accounts.billing_mode` | `text not null default 'postpaid'` — `postpaid` \| `prepaid`, immutable after create |
| `billing_accounts.credit_limit` | `numeric(18,4) not null default 0` — credit line (both modes), reported never enforced |
| `billing_run_outcomes.statement_id` | `uuid null` — prepaid analogue of `draft_invoice_id` |
| `billing_account_balances` | 1:1 running-balance cache (the atomic-decrement row); unique `(tenant_id, bill_account_id)` |
| `billing_account_transactions` | append-only ledger, `balance = SUM(amount)`; unique `(tenant_id, bill_account_id, source_ref)` |
| `billing_topups` | registered top-up lifecycle; unique `(tenant_id, payment_id)` |
| `billing_statements` | non-fiscal period-close summary; unique `(tenant_id, bill_account_id, period_start, period_end)` |

### New dependency

The package now `requires` the core **`payment_gateways`** module (top-up
payment sessions). Ensure it is installed/enabled in the app before upgrading.

### New tenant configs (seeded idempotently on `mercato init`)

- `billing.prepaid.low_balance_threshold_default` (default `0` — off)
- `billing.prepaid.topup_provider` (default `stripe`)
- `billing.prepaid.statement_enabled` (default `true`)
- `billing.prepaid.topup_tax_rate` (default `0` — VAT percent on top-up receipts)
- `billing.credit.near_limit_buffer_default` (default `0`)

### New ACL features → sync roles

After upgrade run:

```bash
yarn mercato auth sync-role-acls
```

New features: `billing.balance.view`, `billing.balance.adjust`,
`billing.topup.create`, `billing.topup.view`, `billing.statement.view`,
`billing.statement.generate`, `billing.credit.view`.

### Notes

- The migration is hand-written (mirrors the Phase 0 initial migration) so its
  index/constraint names match `data/entities.ts` 1:1 — a later
  `yarn mercato db generate` diffs clean. Future schema changes go through the
  generator.
- The reconciliation invariant `balance == SUM(amount) == latest.balance_after`
  is asserted in unit tests and by the optional
  `billing-reconcile-prepaid-balances` worker.
