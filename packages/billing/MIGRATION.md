# @dainamite/billing — migration notes

Schema changes ship as MikroORM migrations under
`src/modules/billing/migrations/`. After upgrading the package, run:

```bash
yarn mercato db migrate
```

Migrations are additive and tenant-safe — they never drop or rewrite existing
billing data.

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
