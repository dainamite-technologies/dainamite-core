# @dainamite/billing — migration notes

Schema changes ship as MikroORM migrations under
`src/modules/billing/migrations/`. After upgrading the package, run:

```bash
yarn mercato db migrate
```

Migrations are additive and tenant-safe — they never drop or rewrite existing
billing data.

---

## Credit reason + item date guard (2026-11-16)

**Migration:** `Migration20261122000000_billing_item_credit_reason.ts` adds
`billing_items.credit_reason jsonb null`. It is additive and changes no data.

- **API behaviour change:**
  - Ending a prorated recurring item before its `billed_to_date` now requires
    `creditReason`, or `creditReasonCode` + `creditReasonParams`. Without one the
    request returns 422 `billing.item.credit_reason_required`.
  - An end date more than one day before the start date returns 422
    `billing.item.end_before_start`.
  - `@dainamite/cpq-billing-connector` sends generated reasons and keeps end
    dates in range from the release that pairs with this one.

---

## Bill cycle day + every-N cycles (2026-11-16)

**Migration:** `Migration20261121000000_billing_cycle_day.ts`. It renames
`billing_accounts.bill_cycle_anchor` to `bill_cycle_day` (now nullable), adds
`bill_cycle_interval integer not null default 1`, and converts `quarterly` rows
to `monthly` × 3. It is hand-written like the earlier billing migrations.

- **Breaking API change:** `billCycleAnchor` is removed (no alias). Send
  `billCycleDay` + `billCycleInterval` instead. `billCycle: 'quarterly'` is
  rejected; use `monthly` with `billCycleInterval: 3`.
- Existing rows get `bill_cycle_day` from their `next_bill_date` (day of month,
  or weekday for weekly cycles), not from the old anchor. The anchor was never
  read, so no account's bill dates move, and legacy values such as `Mon` or a
  day number on a weekly cycle cannot fail the new validation.

---

## AI tools and agent (2026-11-16)

**New required peer (breaking for consumers):** `@open-mercato/ai-assistant` `^0.9.0`.
The package ships `ai-tools.ts` / `ai-agents.ts`, which the framework generator imports
statically, and the tools build on `defineApiBackedAiTool` at load time. Install and enable
the AI assistant module, then run `yarn generate`. Ships in the same major as the 1.0.0
release. No migration and no new permission.

- 14 read tools and 2 write tools (`billing.trigger_bill_run`, dry / test runs only;
  `billing.record_payment`) over the existing routes, and the `billing.operator_assistant`
  agent (`mutationPolicy: 'confirm-required'`). Writes run only after the operator confirms
  the preview card; over MCP they are refused. See `manuals/billing-ai-agent.md`.

---

## Spec F — Operator feedback round 1

**Migration:** `Migration20261119000000_billing_operator_feedback.ts` (additive:
`billing_items.price_basis` default `'net'`, `billing_settings.prepaid_tax_point` default
`'topup'`, `billing_statements.vat_summary`). Run `yarn mercato auth sync-role-acls` for the
new `billing.run.delete` permission.

**Migration:** `Migration20261120000000_billing_allocation_scope_indexes.ts` (index-only:
the `billing_allocations` source / invoice / account indexes now lead with
`tenant_id, organization_id`, like the package's other tables). No data change.

- **Item price basis.** Prices are stored as typed with `priceBasis` (`net` | `gross`);
  lines are computed with `lib/lineAmounts.ts`, so a typed gross is the invoice gross.
  Tiered usage rates are always net (422 `billing.item.gross_tiered_unsupported`).
  Internal: `InvoiceLineDescriptor.totalNetAmount` / `unitPriceNet` became `lineAmount` /
  `unitPrice` + `priceBasis` (the writer derives `unit_price_net`).
- **Prepaid period close reworked.** Recurring items honour `charge_timing` and `prorate`
  (same `computeRecurringLines` as postpaid); one-time items use the postpaid window;
  test / dry simulate every due cycle; outcomes carry `cycles` (`charged` / `previewed` /
  `empty` / `skipped_existing`, `total_debit`, `statement_id`) and `skipped_items`. An
  existing statement no longer blocks the account: the run skips the statement, applies
  (idempotent) charges and advances. Charge `source_ref` format changed to
  `recurring-{item}-{charge|credit}-{start}-{end}` / `one_time-{item}` — reseed (D14);
  the `billed_to_date` watermark remains the primary guard.
- **Prepaid tax point.** `prepaidTaxPoint = 'topup'` (default, today's behaviour made
  explicit): receipts carry VAT at `topupTaxRate`, debits are the item amount. `'consumption'`:
  receipts VAT 0, debits are gross at the item rate (period close and real-time usage);
  transactions carry `metadata.{net,tax,tax_rate,tax_point}`; statements get `vat_summary`.
  Prepaid usage `ratedAmount` (API + event) is now the amount debited.
- **Runs.** `DELETE /api/billing/runs/{id}` deletes test / dry runs with their test
  invoices and outcomes (real runs: 422). `GET /api/billing/runs?mode=`. The wipe also
  deletes draft-edit audit rows. New event `billing.run.deleted`.
- **Accounts.** `GET /api/billing/accounts` rows gain `balance_due`, `overdue_amount`
  and a `hasOverdue=true` filter; `GET /api/billing/accounts/{id}/summary` gains
  `billing_mode`, `bill_cycle`, `next_bill_date`, `last_invoice`, `prepaid`.
- **Settings page** is listed in the Settings sidebar (no `navHidden`).

## Spec D — Credit and debit memos

**Migration:** `Migration20261118000000_billing_memos.ts` (additive:
`billing_invoices.corrects_invoice_number`, `corrects_issue_date`).

- **Corrections are documents.** From a posted / partially paid / paid invoice:
  `POST /api/billing/invoices/{id}/memos` creates a draft credit or debit memo (reason
  required, printed). Credit memos without lines = full credit; copied lines keep the
  original VAT rate. Drafts can be deleted (`POST /api/billing/invoices/delete-draft`);
  posted documents never are (no void).
- **Posting** (`POST /api/billing/invoices/post`): credit memos use the `credit_memo`
  series (`CN/…`), have no due date and are allocated to the corrected invoice
  (`billing_allocations.source_type = 'credit_memo'`); any remainder is account credit.
  An invoice settled entirely by credit memos becomes `credited`. Debit memos use the
  `invoice` series, get a due date and are paid like invoices (matched by number).
- **Guard:** Σ posted credit memos ≤ invoice gross + Σ posted debit memos → otherwise
  409 `billing.memo.exceeds_invoice` (checked at creation and, under the account lock, at post).
- **Events:** `billing.credit_memo.posted`, `billing.debit_memo.posted`,
  `billing.invoice.credited`. `billing.invoice.posted` now fires for invoices only.
- **New permission:** `billing.invoice.correct`.

## Spec C — Payments (register, CSV import, allocation, credit)

**Migration:** `Migration20261117000000_billing_payments.ts` (additive: `billing_payments`,
`billing_allocations`, `billing_payment_imports`).

- **Single path to "paid".** Invoice `paid_total` / `outstanding` / status (`posted →
  partially_paid → paid`, and `credited` for Spec D) are recomputed from active
  allocations. The `payment_gateways.payment.captured` subscriber no longer flips the
  status: it records a `BillingPayment` (`source = gateway`, idempotent on the
  transaction id) and allocates it.
- **CSV upload** on **Billing → Payments** (`POST /api/billing/payments/import`, header
  `date,amount,currency,reference,payer_name,payer_account`, ≤ 5,000 rows / 2 MB).
  Matching uses only invoice numbers in the reference; overpayments become account
  credit, applied to the oldest open invoice (also when an invoice is posted).
- **Manual actions:** record, assign to account / unassign, allocate / un-allocate,
  ignore / restore, convert to top-up (prepaid accounts). Each runs under a per-account
  advisory lock.
- **Account summary:** `credit_amount` is now the account's unapplied credit.
- **New permissions:** `billing.payment.view`, `billing.payment.manage`,
  `billing.payment.import` (run `yarn mercato auth sync-role-acls` for existing tenants).
- **Demo:** `yarn mercato billing payments-sample [--org <id>] [--out file.csv]` writes a
  bank CSV from your posted invoices that shows every matching outcome.

## Spec B — Invoice documents (VAT, due date, PDF, email)

**Migration:** `Migration20261116000000_billing_invoice_documents.ts` (additive)

- `billing_items.tax_rate` (`numeric(7,4)`, default `0`). **Existing items get
  0 %** — the migration never back-fills a rate, so live subscriptions are not
  silently re-priced. New items take the organization default
  (`billing_settings.default_tax_rate`, 23 % unless changed) when created
  without `taxRate`, including items created by the CPQ connector. Set rates on
  existing items, or reseed demo data.
- `billing_accounts.payment_terms_days` (null = organization default) and
  `auto_send_invoice` (default `false`).
- `billing_settings`: `legal_name`, `seller_address`, `tax_id`, `bank_name`,
  `iban`, `bic`, `invoice_footer`, `logo_attachment_id`,
  `default_payment_terms_days` (14), `default_tax_rate` (23).

### Behaviour changes

- **Posting needs seller details.** `POST /api/billing/invoices/post` returns
  409 `billing.settings.incomplete` (with `missing[]`) until legal name,
  address, tax id and IBAN are filled on **Settings → Billing**. No number is
  consumed. The demo seed fills them for demo organizations.
- **VAT per line** from the item rate (drafts and dry / test runs included);
  proration and credit lines inherit it. Manual lines accept `taxRate`.
- **Post** also sets `due_date`, freezes the seller block in `seller_snapshot`
  and keeps the replaced `DRAFT-…` number in `metadata.draft_number`.
- **PDF:** `GET /api/billing/invoices/{id}/pdf`. Posted documents are frozen as
  an attachment (`pdf_attachment_id`) right after the post; drafts are
  watermarked previews. Labels follow the account's invoice language (en / pl).
- **Email:** `POST /api/billing/invoices/{id}/send` (new feature
  `billing.invoice.send`) and an auto-send subscriber for accounts with
  `auto_send_invoice`. Attempts are logged in `metadata.deliveries`; events
  `billing.invoice.sent` / `billing.invoice.send_failed`.
- **Overdue** is computed: `GET /api/billing/invoices?overdue=true|false`,
  `dueFrom`, `dueTo`; rows add `days_overdue`.
  `GET /api/billing/accounts/{id}/summary` returns open / overdue amounts.
- Account export moves to `schemaVersion: 4`.

### Dependencies

- `requires` adds **`attachments`** (platform module; stores frozen PDFs and
  the logo).
- New regular dependencies: `pdf-lib`, `@pdf-lib/fontkit`. The PDF font (Noto
  Sans, SIL OFL 1.1, subset to Latin + Latin Extended-A) is embedded in
  `lib/pdf/fonts/embeddedFonts.ts`; regenerate it with
  `node scripts/embed-pdf-fonts.mjs` after changing the TTFs.

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
