# XD-249: Billing Module — Implementation Spec

## Summary

Implement `@dainamite/billing` — a **lightweight recurring-billing
engine** for Open Mercato applications. The module collects items to
charge (`one_time`, `recurring`, `usage`), runs a scheduled **Bill
Run** that calculates totals and produces **draft invoices**, and
waits for human approval before posting. On "Post", a sequential
invoice number is assigned.

The package is **standalone-first**: any source (CSV import, CRM,
custom integration) can push Billing Items via REST API. When used
with CPQ, a separate **pre-built `@dainamite/cpq-billing-bridge`**
package wires CPQ subscription events to billing API calls.

> **Date**: 2026-05-11
> **Status**: Approved — ready for Phase 0
> **Owner**: Kamil
>
> **Distribution**: Published as `@dainamite/billing` on public
> npm.js. See [SPEC-001](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md).
> **Repo location**: `packages/billing/` workspace in the
> `dainamite-core` monorepo, alongside `packages/cpq/`.
> **Reused from core**: `Invoice` + invoice lines from
> `@open-mercato/core/sales`; UoM dictionary from
> `@open-mercato/core/dictionaries`; tax service from `core/sales`;
> queue worker contract from `@open-mercato/queue`.
> **Companion package**: `@dainamite/cpq-billing-bridge` in
> `packages/cpq-billing-bridge/` — pre-built CPQ integration,
> shipped alongside billing v1.
> **Out of scope (v1)**: credit notes / storno, dunning, customer
> portal, payment collection, tax calculation, currency conversion,
> UoM conversion, trial periods as a feature, retention / auto-purge.

---

## Design assumptions *(non-negotiable)*

1. **Lightweight — no own product catalog.** A Billing Item carries
   a textual description and optional string FK to a product in
   another module. Billing does not know what a "product" is — only
   what appears on an invoice.
2. **Standalone-first; pre-built CPQ bridge.** `@dainamite/billing`
   does not depend on CPQ. The companion package
   `@dainamite/cpq-billing-bridge` ships in v1 and provides the
   ready-to-install CPQ integration.
3. **Charges calculate during Bill Run** for time-proportional
   (`recurring`) and metered (`usage`) items. **Pre-calculated**
   items (`one_time`, including proration values) carry their value
   in `rate_json` and Bill Run just copies them onto the draft.
4. **Draft → human verify → post.** Bill Run never auto-posts.
   Invoices land as `draft`; a finance operator manually approves
   ("Post") — sequence number and accounting events fire only then.
5. **Proration is supported but lightweight.** The integrator (CPQ
   bridge or custom) computes the prorated value; billing stores it
   as a `one_time` Billing Item with a descriptive line. No
   dedicated proration audit tables.
6. **Lightweight usage handling.** External systems upload
   pre-aggregated usage to `Billing Account Usage`. Bill Run reads
   it and rates it according to the matching `type=usage` Billing
   Item. **UoM matching is exact** — no unit conversion.
7. **Bill Run is schedulable + self-healing.** Cron trigger per
   tenant (daily / weekly / monthly), plus manual trigger via UI or
   API. Each Billing Account is an independent transaction; failure
   on one does not block the others. Operators can **restart** the
   full run or **retry only failed** accounts.
8. **Idempotency-first.** A `source_ref` on Billing Items and Usage
   records prevents duplicate processing on retry. Bill Run skips
   accounts that already have an open draft for the same period.

---

## Data Model

All entities follow standard OM patterns: UUID primary keys,
multi-tenant scoping via `organization_id` + `tenant_id`,
soft-delete via `deleted_at`, JSONB for flexible payloads, no
MikroORM relation decorators across package boundaries.

### Entity 1: BillingAccount

A container per customer (typically one customer = one account).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `tenant_id`, `organization_id` | uuid | no | OM standard scoping |
| `customer_id` | text | no | String FK to `customers` module or external ID |
| `name` | text | no | Display name |
| `currency_code` | text | no | ISO 4217; single-currency per account |
| `bill_cycle` | text | no | `monthly` / `quarterly` / `annually` / `weekly` |
| `bill_cycle_anchor` | text | no | Day 1–28 (monthly/quarterly/annually) or `mon`–`sun` (weekly) |
| `invoice_data` | jsonb | no | `{ address, tax_id, email, language }` |
| `next_bill_date` | date | no | Anchor date of the **next** period to bill. See [Bill Period semantics](#bill-period--cycle-semantics) |
| `last_bill_date` | date | yes | Anchor of the most recently billed period (nullable for new accounts). Advanced by Bill Run after each successful run |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | std | OM defaults |

### Entity 2: BillingItem

A single line that will appear on an invoice.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `tenant_id`, `organization_id` | uuid | no | OM standard scoping |
| `bill_account_id` | uuid | no | FK to `BillingAccount` |
| `type` | text | no | `one_time` / `recurring` / `usage` |
| `bill_start_date` | date | no | When the item becomes eligible for billing |
| `bill_end_date` | date | yes | When the item stops (null = open-ended) |
| `description` | text | no | Text shown on the invoice line |
| `rate_json` | jsonb | no | Pricing definition — see [Rate Formats](#rate-formats) |
| `uom_code` | text | yes | Required for `type=usage`; ignored otherwise |
| `subscription_id` | text | yes | String FK to upstream subscription. **NULL is OK** for CSV imports, manual entries, non-subscription contexts |
| `subscription_item_id` | text | yes | String FK to upstream subscription item. NULL conditions same as above |
| `source_ref` | text | yes | Idempotency key, unique per `(tenant_id, bill_account_id, source_ref)`. Duplicate POST returns the existing row (HTTP 200) — never creates a duplicate |
| `currency_mismatch` | bool | no | Default `false`. Set when the integrator POSTed a value in a different currency than the account's `currency_code`. Operator sees warning in the UI on the draft and decides whether to edit or reject the line |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | std | OM defaults |

**`type` semantics:**

| Type | Used for | Bill Run behaviour |
|---|---|---|
| `one_time` | Activation fees, manual corrections, proration values (pre-calculated by bridge) | Copies `rate_json.amount` onto the draft once if the bill period overlaps `[bill_start_date, bill_end_date]` |
| `recurring` | MRC, subscription fees | Pays `rate_json.unit_price` for each **full cycle** the Item covers within the bill period. See [Mid-cycle items](#mid-cycle-recurring-items) |
| `usage` | Metered consumption | Sums matching Usage records' `quantity` × `rate_json` (simple or tiered) |

> **CPQ integration note.** If a CPQ subscription item has both a
> one-time charge (e.g. activation) and a recurring charge (e.g. MRC),
> the bridge creates **two separate Billing Items** (`type=one_time`
> + `type=recurring`) both pointing at the same
> `subscription_item_id`.

#### Rate Formats

`rate_json` is the **single pricing field**. Validated server-side
via Zod schemas in `data/validators.ts` — invalid shapes are
rejected at API ingress.

**`type=one_time` — pre-calculated value:**
```json
{ "amount": 99.00 }
```
Required key: `amount` (numeric ≥ 0; negative allowed for refunds /
credits). No other keys accepted.

**`type=recurring` — per-cycle unit price:**
```json
{ "unit_price": 49.99 }
```
Required key: `unit_price` (numeric ≥ 0). Multiplied by the number
of full cycles the Item covers in the bill period.

**`type=usage` — simple flat rate:**
```json
{ "unit_price": 0.001 }
```
Charged as `sum_of_usage_quantity × unit_price`.

**`type=usage` — tiered:**
```json
{
  "model": "graduated",
  "tiers": [
    { "up_to": 10000, "unit_price": 0 },
    { "up_to": null,  "unit_price": 0.001 }
  ]
}
```

Tier models:

| Model | Semantics |
|---|---|
| `volume` | Entire quantity priced at the unit_price of the tier its **total** falls into. E.g. 25k requests at `[{up_to:10000,unit_price:0},{up_to:50000,unit_price:0.001}]` → 25000 × 0.001 = 25 EUR |
| `graduated` | Each unit priced at its tier (most common for metered APIs). E.g. 25k → first 10k × 0 + next 15k × 0.001 = 15 EUR |
| `flat` | One flat fee for the **highest tier reached**. Tiers carry `flat_amount` instead of `unit_price`. E.g. tiers `[{up_to:10000,flat_amount:50},{up_to:50000,flat_amount:200}]` and 25k usage → 200 EUR |

Validation rules (Zod, enforced at API):
- `tiers` non-empty array
- Exactly one tier with `up_to: null` (the open-ended top tier)
- `up_to` values strictly increasing across the array
- **All tiers must use the same key consistent with the `model`:**
  - `volume` / `graduated` → every tier carries `unit_price`, none
    carries `flat_amount`
  - `flat` → every tier carries `flat_amount`, none carries
    `unit_price`
  - Mixing keys across tiers in a single rate_json is rejected with
    HTTP 422
- Numeric values must be non-negative (no negative rates; if a
  discount is needed, model it as a negative `one_time` Billing
  Item)

**Rounding policy.** When the engine computes line `amount`s
(recurring × cycles, usage × tier rates), the result is rounded to
**2 decimal places, half-up** (standard commercial rounding;
matches PL VAT practice). Bridges computing proration values
should follow the same convention for consistency on the draft.

### Entity 3: BillingAccountUsage

Bucket for pre-aggregated usage uploaded by external systems.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `tenant_id`, `organization_id`, `bill_account_id` | uuid | no | Standard scoping + FK |
| `uom_code` | text | no | Must exactly match `uom_code` on a matching `type=usage` Billing Item |
| `quantity` | numeric(18,4) | no | Amount consumed |
| `period_start`, `period_end` | timestamptz | no | The window over which this usage was aggregated |
| `source_ref` | text | yes | Idempotency key, unique per `(tenant_id, bill_account_id, source_ref)`. Duplicate POST returns existing row |
| `rated_in_bill_run_id` | uuid | yes | Set when this record is consumed; prevents double-rating on retry |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | std | OM defaults |

**Bill Run selection rule:** For an account being billed up to
`bill_period_end`, the run picks all Usage records where:
- `bill_account_id` matches
- `uom_code` matches a corresponding `type=usage` Billing Item
- `period_end <= bill_period_end`
- `rated_in_bill_run_id IS NULL`

**Edge case — usage without a matching Item:** Bill Run records a
warning in the per-account outcome (`unmatched_usage_uoms`); record
is left un-rated (`rated_in_bill_run_id` stays NULL). Operator
adds the missing Billing Item and runs Retry. Account outcome is
`success_with_warnings`, not `failed`.

### Entity 4: BillRun

A single execution of the engine.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `tenant_id`, `organization_id` | uuid | no | Standard scoping |
| `triggered_by` | text | no | `schedule` / `manual` |
| `parent_run_id` | uuid | yes | Set when this run is a "retry failed" of a previous run |
| `dry_run` | bool | no | Default `false`. When `true`, engine computes everything but does NOT persist drafts, mark Usage as rated, or advance `next_bill_date`. Preview only |
| `catch_up` | bool | no | Default `false`. When `true` (manual triggers only), engine loops missed cycles per account in one run. See [Catch-up](#catch-up--missed-cycles) |
| `scoped_account_ids` | uuid[] | yes | Optional — when set, run processes only these accounts (manual single-account trigger, retry-failed) |
| `as_of_date` | date | no | The "today" the run uses. For schedule trigger = current date; for manual trigger = operator's choice (defaults to today). Used to find accounts where `next_bill_date <= as_of_date` |
| `started_at`, `finished_at` | timestamptz | yes | Lifecycle |
| `status` | text | no | `running` / `completed` / `partial_failure` / `failed` |
| `summary` | jsonb | yes | `{ accounts_processed, drafts_created, drafts_skipped_existing, accounts_failed, accounts_with_warnings, usage_records_rated }` |

**Per-account outcomes** in `BillRunOutcome`:

| Column | Type | Description |
|---|---|---|
| `id` | uuid | PK |
| `bill_run_id` | uuid | FK to `BillRun` |
| `bill_account_id` | uuid | FK to `BillingAccount` |
| `status` | text | `success` / `success_with_warnings` / `skipped_existing_draft` / `failed` |
| `error_message` | text | Populated when `status=failed` |
| `warnings` | jsonb | Populated when `status=success_with_warnings` — e.g. `{ unmatched_usage_uoms: ["api_request"] }` |
| `draft_invoice_id` | uuid | FK to `core/sales` invoice when `status=success` or `success_with_warnings` |

**Concurrency lock.** Implemented as a **Postgres transaction-scoped
advisory lock** keyed by `hash(tenant_id || 'billing-run')` —
acquired with `pg_try_advisory_xact_lock(...)` before the engine
sets `status='running'`. Advisory locks are released automatically
when the holding transaction ends (commit, rollback, or process
crash), so there is no lock-leak path even on kill -9.

If a Bill Run is already running for the tenant, a new trigger
returns HTTP 409 with reference to the running run.

**Crash recovery for the BillRun row.** The advisory lock vanishes
with the crashed process, but the `BillRun` row may be left at
`status='running'` forever ("zombie"). A reaper job
(`workers/reap-stale-bill-runs.ts`, scheduled every 15 min):
- Finds `BillRun` rows with `status='running'` AND `started_at`
  older than 1 hour AND no live advisory lock for that tenant
- Sets `status='failed'`, `finished_at=now()`,
  `error_message='Stale running run reaped after crash; advisory
  lock released'`
- Operator can then restart manually

**Operations:**
- **Restart** — new `BillRun` covering the same `scoped_account_ids`
  (or all active accounts when scope was empty)
- **Retry failed** — new `BillRun` with `parent_run_id = X` and
  `scoped_account_ids` = failed outcomes from run X
- **Dry-run** — `dry_run=true`; engine runs but persists nothing,
  results visible in summary + outcomes

### Entity 5: DraftInvoiceEdit *(audit table)*

Every operator edit on a draft invoice line is recorded for audit.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id`, `organization_id` | uuid | OM standard scoping |
| `invoice_id` | uuid | FK to `core/sales` invoice |
| `invoice_line_id` | uuid | Nullable — null for "add new line" / "remove line" |
| `user_id` | uuid | Operator who made the change |
| `action` | text | `line_added` / `line_removed` / `line_edited` |
| `before_json` | jsonb | Snapshot of the line before edit (null for `line_added`) |
| `after_json` | jsonb | Snapshot after edit (null for `line_removed`) |
| `created_at` | timestamptz | When the edit happened |

Records are append-only — never updated or deleted. Soft-delete on
the invoice does NOT delete the audit records (kept for compliance).

### Entity 6: Invoice *(reused from `@open-mercato/core/sales`)*

Billing does not invent its own invoice entity. It creates an
`Invoice` (status `draft`) in `core/sales` and links Billing Items
to invoice lines.

**Status flow:**
- `draft` — created by Bill Run; mutable by operator (audited via
  `DraftInvoiceEdit`)
- `posted` — created by operator clicking "Post"; sequence number
  assigned, status frozen, event `billing.invoice.posted` fires
- `paid` — billing subscribes to the `payments.payment.completed`
  event from `@open-mercato/core/payment_gateways`; the event
  payload carries `invoice_id` (the `core/sales` invoice UUID).
  Billing's subscriber matches it to the invoice and forwards
  `core/sales` API to set the invoice status to `paid`. (Concrete
  payload schema confirmed against the
  `core/payment_gateways/events.ts` source during Phase 4
  implementation.)
- `void` — manual correction through `core/sales` (outside billing's
  scope for v1)

**On `draft`, operator CAN:** add lines, remove lines, edit line
description / quantity / unit_price / amount (each change recorded
in `DraftInvoiceEdit`).
**On `draft`, operator CANNOT:** change sequence number (assigned at
post), change tax rate (tax service owns), change currency (frozen
at account create time).

After post, the invoice is **frozen** — corrections go through
`core/sales` manual edit flow.

### BillingItem → InvoiceLine mapping

How a Billing Item materializes onto a `core/sales` invoice line at
Bill Run time:

| Billing Item field | InvoiceLine field | Notes |
|---|---|---|
| `description` | `description` | Direct copy |
| `type` | `metadata.billing_type` | Stored for traceability (filterable in UI) |
| `id` | `metadata.billing_item_id` | Back-reference for audit / retry / portal |

Per-type calculation:

| Type | InvoiceLine.unit_price | InvoiceLine.quantity | InvoiceLine.amount |
|---|---|---|---|
| `one_time` | `rate_json.amount` | `1` | `rate_json.amount` |
| `recurring` | `rate_json.unit_price` | `1` (bill period is exactly one cycle by definition; catch-up produces one draft per missed cycle, never combined) | `unit_price` |
| `usage` (simple) | `rate_json.unit_price` | sum of consumed `quantity` from Usage records (zero-usage → no line emitted) | `unit_price × quantity` |
| `usage` (tiered) | NULL (mixed rates) | sum of consumed `quantity` (zero-usage → no line emitted) | Computed via tier model; stored as line `amount`; per-tier breakdown stored in `metadata.usage_tier_breakdown` |

`vat_rate` is set by `core/sales` tax service per line, using the
account's `invoice_data.tax_id` / country + line type. Billing
passes the line through; it does not compute VAT.

---

## Bill Period & Cycle Semantics

### Bill period for a given Bill Run

For each account being billed, the **bill period** is computed
using **calendar units** (Postgres `interval`) — not raw day counts —
because months and quarters have variable length:

- `bill_period_end` = `next_bill_date - INTERVAL '1 day'` (inclusive
  of the whole previous cycle)
- `bill_period_start` = `next_bill_date - cycle_interval` where
  `cycle_interval` is:
  - `monthly` → `INTERVAL '1 month'`
  - `quarterly` → `INTERVAL '3 months'`
  - `annually` → `INTERVAL '1 year'`
  - `weekly` → `INTERVAL '7 days'`

Examples:

| `bill_cycle` | `next_bill_date` | `bill_period_start` | `bill_period_end` |
|---|---|---|---|
| `monthly` (anchor 1) | 2026-06-01 | 2026-05-01 | 2026-05-31 |
| `monthly` (anchor 1) | 2026-03-01 | 2026-02-01 | 2026-02-28 |
| `monthly` (anchor 1) | 2024-03-01 | 2024-02-01 | 2024-02-29 (leap year) |
| `quarterly` (anchor 1) | 2026-07-01 | 2026-04-01 | 2026-06-30 |
| `weekly` (anchor `mon`) | 2026-05-04 (Mon) | 2026-04-27 (Mon) | 2026-05-03 (Sun) |

After a successful run, `next_bill_date` advances by adding the
`cycle_interval` (calendar-aware) to the previous `next_bill_date`.

### Catch-up — missed cycles

If an account's `next_bill_date` is more than one cycle behind
`as_of_date` (e.g. paused account reactivated; bug; first-time
import), the engine has two modes:

**Default — one cycle per Bill Run.** Scheduled runs (`triggered_by='schedule'`)
always process **exactly one cycle** per account per run, advancing
`next_bill_date` by one cycle. Three missed monthly cycles produce
3 separate drafts over 3 consecutive daily runs. Operator gets one
draft per period — clean per-period reconciliation.

**Catch-up mode (manual only).** A manual trigger may set
`catch_up=true` on the `BillRun`. The engine then loops over each
account until `next_bill_date > as_of_date`, producing one draft
per missed cycle in a single run. Useful for a "let me catch up
that paused customer in one go" operator action. Always one draft
per period (never combined into one mega-invoice).

| Mode | Trigger | Cycles per run per account |
|---|---|---|
| Default | `triggered_by='schedule'` | exactly 1 |
| Catch-up | `triggered_by='manual'` AND `catch_up=true` | as many as missed |

### Mid-cycle recurring items

`recurring` Billing Items contribute one **full cycle** to a bill
period only when:
- `bill_start_date <= bill_period_start`
- AND (`bill_end_date IS NULL` OR `bill_end_date >= bill_period_end`)

If neither condition holds (the Item starts or ends mid-cycle), the
engine **skips it for that cycle**. The integrator (bridge or
custom) is responsible for posting a `one_time` Billing Item with a
pre-calculated proration value covering the partial period.

Examples:
- New `recurring` Item with `bill_start_date: 2026-05-15`, billing
  May 2026 → **skipped** (not full cycle). June 2026 → **counted as
  full cycle** (bill_start_date ≤ June 1).
- Cancelled `recurring` Item with `bill_end_date: 2026-05-15`,
  billing May 2026 → **skipped** (not full cycle).
- Standard ongoing item — `bill_start_date: 2026-01-01,
  bill_end_date: null`, billing May 2026 → **counted as full
  cycle**.

The integrator's responsibility:
- On mid-cycle **add** (e.g. CPQ amend): create the `recurring`
  Item with `bill_start_date` = effective date, **plus** a
  `one_time` Item with `rate_json: {"amount": prorated_value}` and
  descriptive line ("Proration: <product> from <date> to <date>").
- On mid-cycle **remove** (e.g. CPQ cancel): set `bill_end_date` on
  the `recurring` Item, **plus** post a `one_time` credit Item with
  negative `amount` if a refund is owed (CPQ amend / bridge owns
  this math).

### Open-draft check (anti-duplicate)

Before processing an account in a Bill Run, the engine checks for
an existing `core/sales` invoice in status `draft` for that account
covering the same bill period (matched via `metadata.bill_period_start`
+ `metadata.bill_period_end` on the invoice).

If one exists:
- The account's outcome is `skipped_existing_draft`
- `next_bill_date` is **not** advanced
- Operator must close (post or void) the existing draft, then
  re-run

This prevents retry / accidental re-trigger from producing duplicate
drafts.

---

## Configurable Elements

### Unit of Measure (UoM)

Configurable dictionary with global default codes plus tenant-
specific custom values. Managed via
`@open-mercato/core/dictionaries`.

**Global default codes** (seeded by `setup.ts` on module
installation):
- time: `hour`, `day`, `week`, `month`
- volume: `gb`, `tb`, `mb`
- requests / tokens: `request`, `api_request`, `token`,
  `input_token`, `output_token`
- seats: `seat`, `user`, `device`, `active_user`

Tenants can add custom codes. Exact match at Bill Run time — no
conversion.

### Invoice Sequence Number

Per-tenant configurable invoice numbering, atomic at post.

- `pattern` — e.g. `FV/{YEAR}/{MONTH}/{NNNN}` or `INV-{YYYY}-{0000000}`
- `reset_cycle` — `yearly` / `monthly` / `never`
- `current_value` — integer, atomically incremented via SQL upsert

SQL upsert guarantees uniqueness and gaplessness under concurrent
post (mandated by the Polish VAT Act and EU Directive 2006/112/EC).

Default pattern seeded by `setup.ts`: `INV-{YYYY}-{0000001}`,
`reset_cycle: yearly`.

### Bill Run Schedule (cron)

Per-tenant cron schedule for the auto-triggered Bill Run, stored in
`@open-mercato/core/configs` under namespace `billing`:

| Config key | Default | Description |
|---|---|---|
| `billing.cron_schedule` | `0 2 * * *` (daily at 02:00) | Standard 5-field cron expression. Examples: `0 2 * * *` (daily), `0 2 * * 1` (weekly Mondays), `0 2 1 * *` (monthly day 1) |
| `billing.cron_enabled` | `true` | Master switch; tenants can disable auto-runs entirely |

Manual triggers via API / UI work regardless of `cron_enabled`.

### Setup / Tenant Initialization

`packages/billing/src/modules/billing/setup.ts` registers per-tenant
defaults at module installation:
- Seeds UoM dictionary with the 16 global codes above
- Seeds default Invoice Sequence Number config
- Seeds default `billing.cron_schedule`
- Registers ACL features (see [ACL](#acl-features))
- Grants `admin` role all `billing.*` features
- Registers default `billing.operator`, `billing.auditor`,
  `billing.usage_writer` roles

Tenants installed before this module skip nothing — the setup is
idempotent.

---

## Bill Run Flow

1. **Setup.** Operator (or bridge) creates a Billing Account with
   cycle, anchor, currency, and invoice data.
2. **Items flow in.** Integrator POSTs Billing Items with optional
   `source_ref` for idempotency.
3. **Usage push (optional).** External system POSTs pre-aggregated
   usage with `source_ref`.
4. **Bill Run.** Cron fires at the configured schedule (or operator
   triggers manually).
   1. **Acquire per-tenant Postgres advisory lock.** If a run is
      already holding the lock, return HTTP 409 referencing the
      live `BillRun.id`.
   2. Create the `BillRun` row immediately (even if step 3 finds
      zero accounts — empty run still produces a `completed` row
      with `summary={accounts_processed: 0, ...}` for audit /
      observability).
   3. Select target accounts: `next_bill_date <= as_of_date` (no
      explicit `status` filter — soft-deleted accounts are already
      excluded by `deleted_at IS NULL`). Apply `scoped_account_ids`
      filter if set.
   4. For each account (independent transaction):
      a. Check for an existing open `draft` invoice covering this
         bill period — if found, record outcome
         `skipped_existing_draft`, **do not** advance
         `next_bill_date`, move on
      b. Collect relevant Billing Items per
         [mid-cycle rules](#mid-cycle-recurring-items)
      c. Collect relevant Usage records (`rated_in_bill_run_id IS NULL`,
         `period_end <= bill_period_end`)
      d. Compute totals per
         [InvoiceLine mapping](#billingitem--invoiceline-mapping)
      e. Create a `draft` Invoice in `core/sales` with
         `metadata.bill_period_start`, `bill_period_end`,
         `bill_run_id`
      f. Mark Usage records `rated_in_bill_run_id = this_run_id`
      g. Advance `last_bill_date = bill_period_end`,
         `next_bill_date` = next anchor (if `catch_up=true`, loop
         this step until `next_bill_date > as_of_date`)
      h. Record outcome: `success` / `success_with_warnings` /
         `failed` (with details)
   5. Release the lock; set final `status`:
      - `completed` — all outcomes `success` or
        `success_with_warnings`
      - `partial_failure` — some outcomes `failed`
      - `failed` — engine itself crashed (rare)
5. **Operator review.** Operator opens the draft list. Each draft
   shows lines, totals, customer, and any warnings flagged by the
   run (`currency_mismatch=true` on Items, `unmatched_usage_uoms`,
   etc.). Edits are recorded in `DraftInvoiceEdit`.
6. **Post.** "Post invoice" → sequence number assigned, status →
   `posted`, events fire:
   - `billing.invoice.posted` (to accounting / mailer)
   - `billing.invoice.line_posted` per line (to analytics)
7. **Retry on failure.** Operator clicks "Retry failed" → new run
   with `parent_run_id` set to the failed run's id and
   `scoped_account_ids` = failed accounts.
8. **Dry-run.** For sanity checks before a real run, operator
   triggers with `dry_run=true` — engine computes everything but
   persists nothing.

---

## CPQ Integration

Shipped as a **separate pre-built package**
`@dainamite/cpq-billing-bridge`, released alongside billing v1.
Source lives in `packages/cpq-billing-bridge/` in this monorepo,
alongside `packages/billing/` and `packages/cpq/`.

The bridge installs as a sibling module in the consumer app:

```typescript
// src/modules.ts
import billingModule from '@dainamite/billing'
import cpqModule from '@dainamite/cpq'
import cpqBillingBridge from '@dainamite/cpq-billing-bridge'

export const modules = [billingModule, cpqModule, cpqBillingBridge]
```

The bridge subscribes to CPQ lifecycle events and translates them
to billing API calls:

| CPQ event | Bridge action |
|---|---|
| `cpq.subscription.activated` | Create Billing Account if missing; create Billing Items per charge (one-time + recurring split) |
| `cpq.subscription.amended` | Create new Billing Items for added subscription items; compute proration value for the partial cycle and post as `one_time` Billing Item; set `bill_end_date` on removed items |
| `cpq.subscription.renewed` | Extend `bill_end_date` on existing Billing Items; create new Items for any added subscription items |
| `cpq.subscription.cancelled` | Set `bill_end_date` on all Billing Items for this subscription; post final-period proration credit if applicable |
| `cpq.subscription.merged` | Move Billing Items from source subscriptions to the merged subscription (update `subscription_id`) |
| `cpq.subscription.superseded` | Set `bill_end_date` on all Billing Items for the superseded subscription |

### CPQ-side payload contracts

The bridge expects each CPQ event to carry these fields:

**`cpq.subscription.activated`** *(NEW event — upstream PR in Phase 5)*
```typescript
{
  subscriptionId: string
  customerId: string
  currencyCode: string
  items: Array<{
    subscriptionItemId: string
    productName: string
    quantity: number
    charges: Array<{
      type: 'one_time' | 'recurring'
      amount?: number      // pre-calculated, for one_time
      unitPrice?: number   // for recurring
      description: string
    }>
  }>
}
```

**`cpq.subscription.amended`** *(existing event — payload extension)*
```typescript
{
  subscriptionId: string
  effectiveDate: string  // YYYY-MM-DD
  addedItems: Array<{ /* same shape as items.charges above */ }>
  removedSubscriptionItemIds: string[]
  proration: {
    daysInPeriod: number
    daysRemaining: number
    cycleStart: string
    cycleEnd: string
  }
}
```

Equivalent payloads exist for `renewed`, `cancelled`, `merged`,
`superseded`. Phase 5 upstream PR to CPQ formalizes these payloads.

### Reference subscriber implementation

Ships in the bridge package under
`packages/cpq-billing-bridge/src/modules/cpq_billing_bridge/subscribers/`:

```typescript
// cpq-subscription-activated.ts
import type { EventSubscriberMetadata } from '@open-mercato/events'

export const metadata: EventSubscriberMetadata = {
  event: 'cpq.subscription.activated',
  queue: 'persistent',
}

export default async function handler(opts) {
  const billingApi = opts.container.resolve('billingApiClient')
  const account = await billingApi.accounts.getOrCreate({
    customerId: opts.payload.customerId,
    currencyCode: opts.payload.currencyCode,
    billCycle: 'monthly',
    billCycleAnchor: 1,
    sourceRef: `cpq-customer-${opts.payload.customerId}`,
  })

  for (const item of opts.payload.items) {
    for (const charge of item.charges) {
      await billingApi.items.create({
        billAccountId: account.id,
        type: charge.type,
        description: `${item.productName} — ${charge.description}`,
        rateJson: charge.type === 'one_time'
          ? { amount: charge.amount }
          : { unit_price: charge.unitPrice },
        subscriptionId: opts.payload.subscriptionId,
        subscriptionItemId: item.subscriptionItemId,
        sourceRef: `cpq-${opts.payload.subscriptionId}-${item.subscriptionItemId}-${charge.type}`,
        billStartDate: new Date().toISOString().slice(0, 10),
      })
    }
  }
}
```

For `amended` events the bridge computes proration
(`unitPrice × quantity × daysRemaining / daysInPeriod`) and posts
it as a `one_time` Billing Item with
`rate_json: {"amount": <prorataValue>}`.

---

## Personas and ACL

| Persona | Activity |
|---|---|
| **Finance operator** | Verifies and posts drafts, retries failed runs, edits Billing Items / draft lines |
| **Auditor / accounting** | Read-only access to invoices, Bill Run history, Billing Accounts. Can run **dry-run previews** (no side effects). Does not post, edit, or trigger real runs |
| **Integrator** | Writes / consumes bridge code; receives scoped API key for `billing.item.manage` |
| **External usage system** | Autonomous POST to Usage endpoint via narrowly-scoped API key (`billing.usage.ingest` only) |

### ACL features

Defined in `acl.ts`:

| Feature | Grants |
|---|---|
| `billing.account.manage` | CRUD Billing Accounts |
| `billing.account.view` | Read-only |
| `billing.item.manage` | CRUD Billing Items |
| `billing.item.view` | Read-only |
| `billing.usage.ingest` | POST to Usage endpoint |
| `billing.usage.view` | Read access to Usage records |
| `billing.run.trigger` | Manual Bill Run / retry (creates real drafts) |
| `billing.run.dry_run` | Manual dry-run (no side effects). Strictly weaker than `trigger` — auditors get this to "see what would happen" without write access |
| `billing.run.view` | Read Bill Run history + outcomes |
| `billing.invoice.post` | "Post" a draft invoice |
| `billing.invoice.edit_draft` | Edit lines on a draft (audited via `DraftInvoiceEdit`) |
| `billing.invoice.view` | Read-only |

### Default role mappings (in `setup.ts`)

| Role | Features |
|---|---|
| `admin` | All `billing.*` |
| `billing.operator` | `account.manage`, `account.view`, `item.manage`, `item.view`, `usage.view`, `run.trigger`, `run.dry_run`, `run.view`, `invoice.post`, `invoice.edit_draft`, `invoice.view` |
| `billing.auditor` | All `.view` features + `run.dry_run` (preview without write) — no posting, no editing, no real trigger |
| `billing.usage_writer` | `usage.ingest` only — for external system API keys |

---

## End-to-end Stories

### Story 1 — new subscription with an activation fee

Integrator calls billing API: creates a Billing Account
(`currency_code: EUR`, `bill_cycle: monthly`, `bill_cycle_anchor: 1`)
plus two Billing Items:
- `recurring` MRC 49.99 EUR/mo (`rate_json: {"unit_price": 49.99}`,
  `bill_start_date: 2026-05-01`)
- `one_time` activation fee (`rate_json: {"amount": 99.00}`,
  `bill_start_date: 2026-05-01`)

On 1 June at 02:00 the cron-triggered Bill Run picks the account
(`next_bill_date=2026-06-01` ≤ as_of_date `2026-06-01`).
`bill_period = 2026-05-01..2026-05-31`. No existing draft. The
`recurring` Item is a full cycle (`bill_start_date ≤ period_start
AND bill_end_date IS NULL`) → 49.99. The `one_time` Item overlaps
the period → copies 99.00. Draft invoice: 148.99 EUR.

Operator opens draft, reviews, clicks "Post" — invoice gets number
`FV/2026/06/0123`, status `posted`, event
`billing.invoice.posted` fires.

### Story 2 — customer adds a product mid-cycle

On 15 May the customer buys an additional package (29 EUR/mo). The
bridge POSTs:
1. New `recurring` Billing Item with `rate_json: {"unit_price": 29}`
   and `bill_start_date: 2026-05-15`
2. `one_time` Billing Item with `rate_json: {"amount": 15.90}`,
   `bill_start_date: 2026-05-15`, description "Proration: Package X
   from 2026-05-15 to 2026-05-31" — bridge computed the prorated
   value (29 × 17/31)

On 1 June Bill Run for May:
- Old MRC 49.99 — full cycle → 49.99
- New `recurring` package — **skipped** (bill_start_date 2026-05-15
  is after period_start 2026-05-01)
- Proration `one_time` 15.90 — overlaps period → copied

Draft total: 49.99 + 15.90 = **65.89 EUR**.

On 1 July Bill Run for June: new package is now a full cycle
(bill_start_date 2026-05-15 ≤ period_start 2026-06-01) → 29 EUR
contribution.

### Story 3 — usage-based billing

Customer's plan: 49 EUR flat plus 0.001 EUR per API request beyond
10k (graduated tier). Two Billing Items:
- `recurring` 49 EUR (`rate_json: {"unit_price": 49}`)
- `usage` with `uom_code: api_request` and `rate_json: {"model":
  "graduated", "tiers": [{"up_to": 10000, "unit_price": 0},
  {"up_to": null, "unit_price": 0.001}]}`

Throughout May the external system POSTs daily Usage records (each
with `source_ref: metrics-2026-05-DD`). On 1 June Bill Run sums
matching records (`period_end <= 2026-05-31`,
`rated_in_bill_run_id IS NULL`): 53k requests. Graduated rating:
first 10k × 0 + remaining 43k × 0.001 = 43 EUR. Draft total: 49 +
43 = **92 EUR**. Run marks the consumed Usage records'
`rated_in_bill_run_id`. Operator posts.

---

## Compliance Notes

- **Atomic, gap-free invoice numbering** — Polish VAT Act and EU
  Directive 2006/112/EC requirement. Implemented via SQL upsert,
  never in-memory counter.
- **VAT** — `core/sales` tax service owns the rate calculation;
  billing passes line metadata through (account tax_id, line
  description, billing_type).
- **Audit trail** — every Bill Run logs per-account outcomes; every
  invoice post emits a persisted event; every draft edit is recorded
  in `DraftInvoiceEdit` (`who` / `when` / `what`).
- **Data residency** — billing stores everything in the customer's
  database. No external data dependencies (UoM, tax rates, sequence
  numbers all local).
- **GDPR portability** — `GET /api/billing/export/account/{id}`
  returns a full JSON dump of the account, its Items, Usage records,
  and associated invoices.
- **Idempotency-first** — `source_ref` on Billing Items and Usage
  records prevents double-charging on retry; duplicate POST returns
  the existing row.

**KSeF (PL e-invoicing mandate, 2027)** and **SAF-T / JPK_VAT** are
handled by `core/sales` (when OM adds the integration) or by a
separate `@dainamite/billing-ksef` package. Billing does not block
either.

---

## Delivery Plan

| Phase | Deliverable | Effort | Milestone |
|---|---|---|---|
| 0 | `packages/billing/` workspace scaffold; entity schema (6 billing-owned tables: BillingAccount, BillingItem, BillingAccountUsage, BillRun, BillRunOutcome, DraftInvoiceEdit — plus reused Invoice from `core/sales`); ACL features in `acl.ts` (12 features); `setup.ts` seeding UoM + sequence number + cron config + default roles; migrations; reaper worker stub | 1 week | Module registered, schema migrates, defaults seeded |
| 1 | REST API: BillingAccount + BillingItem CRUD + Usage ingest + idempotency via `source_ref`; Zod validators in `data/validators.ts` (including tier shape rules); per-tenant lock primitive | 2 weeks | curl walkthrough: register, push charges; duplicate POST safe |
| 2 | Bill Run engine: cron schedulable, processes `recurring` + `one_time`, creates `core/sales` draft invoices with proper line mapping, open-draft anti-duplicate, mid-cycle skip rules, catch-up loop, dry-run mode | 2-3 weeks | **First automatic drafts. "Shippable preview".** |
| 3 | Usage rating: tiered (volume/graduated/flat) and simple, exact UoM matching, `rated_in_bill_run_id` marking, `success_with_warnings` for unmatched UoMs | 1-2 weeks | Customer pushes usage → engine rates it |
| 4 | Admin UI: draft review + post + edit (audited via `DraftInvoiceEdit`), Bill Run history + outcomes + retry, manual triggers, dry-run preview, Account/Item CRUD UI, GDPR portability endpoint; `payments.payment.completed` subscriber from `core/payment_gateways` wires posted invoice → `paid` status | 2-3 weeks | **`@dainamite/billing` v1 release.** |
| 5 | `packages/cpq-billing-bridge/` workspace: subscribers for the 6 CPQ events, upstream PR to CPQ adding `cpq.subscription.activated` event and formalizing payloads | 1-2 weeks | **`@dainamite/cpq-billing-bridge` v1 release.** |

**Total:** 9-13 weeks solo. First "it works" moment after ~5-6
weeks (end of Phase 2).

**Post-v1 (separate packages):**
- `@dainamite/billing-dunning` — overdue tracking, reminders
- `@dainamite/billing-credit-notes` — corrections / storno flow
- `@dainamite/billing-portal` — customer self-service

---

## Risk Assessment

- **Technical risk: LOW.** All patterns (Bill Run as queue worker,
  atomic sequence via SQL upsert, draft invoice in sales,
  idempotency via `source_ref`) are standard in Open Mercato. No
  novel infrastructure.
- **Product risk: MEDIUM.** Draft → human verify is a deliberate
  choice — customers used to Stripe (full-auto) may ask "why the
  clicks?". Answer: compliance / finance teams value
  human-in-the-loop; B2C customers for whom this is overhead are
  outside our target market anyway.
- **Market risk: LOW-MEDIUM.** Polish / EU B2B with subscriptions +
  on-prem requirement is a clear niche; not competing with Stripe on
  their home turf.

---

## References

- [SPEC-001 — Module Distribution Architecture](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md)
- [packages/cpq/MIGRATION.md](../../packages/cpq/MIGRATION.md) — first `@dainamite/*` package precedent
- [node_modules/@open-mercato/core/src/modules/sales/AGENTS.md](../../node_modules/@open-mercato/core/src/modules/sales/AGENTS.md) — invoice + sequence number patterns
- [node_modules/@open-mercato/core/AGENTS.md](../../node_modules/@open-mercato/core/AGENTS.md) — command pattern, `withAtomicFlush`, ACL
- [node_modules/@open-mercato/queue/AGENTS.md](../../node_modules/@open-mercato/queue/AGENTS.md) — worker contract, idempotency, for the Bill Run scheduler
