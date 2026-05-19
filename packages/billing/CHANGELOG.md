# @dainamite/billing

## 0.2.0 — Phase 1 REST API (unreleased)

- REST API surface for the three integrator-facing resources:
  - `GET / POST / PUT / DELETE /api/billing/accounts` (Billing Accounts CRUD)
  - `GET / POST / PUT / DELETE /api/billing/items` (Billing Items CRUD with
    `source_ref` idempotency on POST — duplicate `(tenant, account,
    sourceRef)` returns the existing row with `deduplicated: true`)
  - `GET / POST /api/billing/usage` (append-only usage ingest; idempotent
    by `source_ref`; no update / delete by design)
- Lean command pattern (no undo / snapshot yet — Phase 4 adds those):
  - `billing.accounts.create / update / delete`
  - `billing.items.create / update / delete`
  - `billing.usage.create`
- New helpers under `lib/`:
  - `withTenantLock(em, { tenantId, lockName }, fn)` — per-tenant
    Postgres transaction-scoped advisory lock; throws
    `TenantLockBusyError` on busy. Used by the Phase 2 Bill Run engine
    to enforce at-most-one concurrent run per tenant.
  - `findBySourceRef(em, Entity, { tenantId, billAccountId, sourceRef })`
    — the single source-ref pre-check helper shared by items and usage.
- Zod CRUD payload schemas added to `data/validators.ts`:
  - `billingAccount(Create|Update|Delete|ListQuery)Schema`
  - `billingItem(Create|Update|Delete|ListQuery)Schema`
  - `billingUsage(Create|ListQuery)Schema`
- 43 new unit tests (119 total for the package).
- Migration not required — Phase 1 uses the existing Phase 0 schema.

## 0.1.0 — Phase 0 scaffold (unreleased)

- Initial workspace scaffold mirroring `@dainamite/cpq`.
- Six billing-owned entities: `BillingAccount`, `BillingItem`,
  `BillingAccountUsage`, `BillRun`, `BillRunOutcome`, `DraftInvoiceEdit`.
- 12 ACL features (`billing.*`) and three default roles
  (`billing.admin` / `billing.finance_user` / `billing.usage_writer`).
- Tenant setup seeds the global UoM dictionary (16 codes), invoice statuses
  (`draft` / `posted` / `paid` / `void`), per-organization invoice sequence
  configs, and the cron schedule defaults.
- Reaper worker stub for stale `BillRun` rows.
