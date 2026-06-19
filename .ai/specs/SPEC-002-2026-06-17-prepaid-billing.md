# SPEC-002 — Prepaid Balance Billing (real-time usage drawdown)

**Date**: 2026-06-17
**Status**: Draft — design agreed, ready for implementation planning
**Owner**: Mac
**Target package**: `@dainamite/billing` (`packages/billing/`) — extends the
existing postpaid engine; does **not** fork it.

> **Spec-location note.** Per repo convention, JIRA-linked *feature* specs
> live in `specs/implementation/xd-{JIRA}-{slug}.md` (the 16-section format,
> e.g. [`xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md)).
> This document was requested in `.ai/specs/` and is numbered as an
> architectural SPEC because prepaid adds a **second billing mode** to a
> published L2 package — a cross-cutting decision. If you'd rather track it
> as `xd-XXX` under `specs/implementation/`, this file moves verbatim.

---

## TLDR

Add a **prepaid mode** to `@dainamite/billing`: a customer **tops up** a
monetary **balance** on their Billing Account (via `core/payment_gateways`,
e.g. Stripe Checkout), then **consumes a metered product** (API calls,
tokens, …). Each usage upload is **rated in real time** against the account's
existing `type=usage` Billing Item, **debited from the balance**, and the
API **returns the remaining balance**. Usage is **never rejected** — when the
balance runs low or negative we report status back and it is the **client's**
responsibility to stop. Money is invoiced/receipted (with VAT) **at top-up**;
the period closes with a non-fiscal **consumption statement** — and a prepaid
account may also carry `recurring` subscriptions, which the periodic Bill Run
still draws **straight from the balance** (no payable invoice).

Every balance movement is **registered** as an append-only
**`BillingAccountTransaction`**, and every top-up is a first-class
**`BillingTopup`** record (pending → captured), so the whole money trail is
auditable — not a single mutable number. An optional **credit limit** (both
modes) is reported on top — a prepaid overdraft allowance / a postpaid AR
exposure cap — **reported, never enforced** by billing.

---

## Problem Statement

The shipped engine (see [`xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md))
is strictly **postpaid**:

```
upload usage (unrated) → scheduled Bill Run rates in batch → draft invoice
→ human posts → payment captured → paid
```

There is **no balance anywhere**, rating is **deferred to the Bill Run**, and
nothing happens in real time. That is the wrong shape for a **prepaid,
pay-as-you-go** product where the customer pre-funds an account and the
defining UX is *"I uploaded usage and got my remaining balance back."*

Prepaid inverts the flow:

```
top up balance (money in, VAT now) → consume (rate NOW, debit NOW, return balance)
→ balance trends down → low/exhausted is reported, client throttles itself
→ period end: recurring fees debited + consumption statement (nothing due)
```

This spec specifies that inverted flow as an additive **mode** on the same
package, reusing every primitive that already fits.

---

## Design Assumptions *(non-negotiable)*

1. **We are not a rating/enforcement platform.** Usage uploads are **always
   accepted and recorded**, even when the balance is exhausted or goes
   negative. We rate, debit, and **report** balance + status; throttling is
   the **client's** responsibility. No `402`, no hard stop, no overdraft
   *enforcement* in the engine.
2. **Balance is monetary**, denominated in the account's existing
   `currency_code` (single-currency per account, like today). No abstract
   "credits" in v1 (see [Out of scope](#out-of-scope-v1)).
3. **Balance is a transaction log, not a mutable scalar.** Every credit
   (top-up, adjustment) and debit (rated usage, recurring charge) is an
   **append-only `BillingAccountTransaction`** (a classic running-balance
   ledger). A denormalized running balance exists only as an O(1) cache that
   **reconciles** to `SUM(transactions.amount)` (invariant, unit-tested).
4. **Real-time rating reuses the existing pure rater.**
   `lib/usageRater.ts` (`rateUsageQuantity` / `rateUsageForItem`) is already
   synchronous and side-effect-free; prepaid calls it at ingest. No second
   pricing implementation.
5. **Money in = at top-up; VAT at top-up.** A top-up is a completed payment,
   so the taxable event is the top-up. Each captured top-up produces a fiscal
   **receipt/invoice** in `core/sales` (VAT applied by the core tax service)
   and is created **posted+paid** — there is nothing for a human to review,
   so the prepaid top-up deliberately **bypasses the draft→post gate**.
6. **Period end is a statement, not a payable invoice — but the Bill Run
   still runs.** A prepaid account may also subscribe to `recurring` products
   (e.g. a monthly platform fee). The periodic Bill Run still executes for
   prepaid accounts, but instead of a payable invoice it **debits recurring /
   one-time charges from the balance** (transactions) and rolls them into a
   non-fiscal **consumption statement** (opening balance, credits, usage +
   recurring debits, closing balance, per-item breakdown) — informational,
   **nothing due**. Everything that consumes pre-paid (already-taxed) balance —
   metered usage *and* recurring fees — is a drawdown, not a new fiscal event.
7. **Top-ups are registered, not implicit.** Every top-up is a first-class
   `BillingTopup` row with a lifecycle (`pending → captured | failed |
   expired`), linked to its `GatewayTransaction`, its balance credit
   transaction, and its receipt invoice. "The balance went up" is always
   explainable.
8. **Mode is per-account and immutable after create** (like `currency_code`).
   `billing_mode = 'postpaid' | 'prepaid'`. The Bill Run and all existing
   postpaid behavior are untouched for `postpaid` accounts.
9. **Idempotency-first, unchanged.** `source_ref` on usage still dedupes; a
   deduplicated usage upload must **not** double-debit. Top-up capture is
   idempotent on the gateway `payment_id`; recurring charges use a
   deterministic `source_ref` so a retry/catch-up cannot double-charge.
10. **SPEC-001 distribution rules hold.** Cross-package references stay FK
    strings (the top-up receipt is created in `core/sales` via its service,
    not an ORM relation); the package ships its own migrations; peer deps
    only.
11. **Credit limit is report-only.** A `credit_limit` may be extended to an
    account in either mode. Billing **computes and reports** credit usage /
    availability / status and emits `billing.credit.over_limit`, but **never
    blocks** — prepaid keeps accepting usage past the limit; postpaid surfaces
    an over-limit signal that the consuming flow (e.g. CPQ order conversion)
    decides to act on. Same "we report, you decide" contract as usage.

---

## Relationship to the existing postpaid engine

| Concern | Postpaid (today) | Prepaid (this spec) |
|---|---|---|
| When usage is rated | Batch, in the Bill Run | **Synchronously, at ingest** |
| `BillingAccountUsage.rated_in_bill_run_id` | Set by the Bill Run | Set to a sentinel / paired with a balance transaction at ingest (never re-rated by a run) |
| Money direction | Bill → human posts → customer pays after | Customer **pre-pays** (top-up) → draws down |
| Taxable event | Invoice post | **Top-up** |
| Recurring / one-time charges | On the payable draft invoice | **Debited from the balance** by the Bill Run (transaction); shown on the statement |
| Period-end artifact | Draft → posted **invoice** (payable) | **Statement** (informational, nothing due) |
| Balance | — (none) | **Transaction log + running balance** |
| Exhaustion | n/a | Recorded; **reported, never blocked** |
| Human-in-the-loop | Yes (post drafts) | No (top-up auto-receipted; statement auto-generated) |

**Reused as-is:** `BillingAccount`, `BillingItem` (`type=usage` defines the
price via `rate_json`; `recurring`/`one_time` items still drive period
charges), `BillingAccountUsage` (still the consumption audit record),
`lib/usageRater.ts`, the `itemSelector` + `buildInvoiceLinesFromItems`
selection logic, the UoM dictionary, `core/sales` invoices + sequence
numbering + tax service, `core/payment_gateways` sessions + the
`payment_gateways.payment.captured` event, `source_ref` idempotency, and the
Bill Run scheduler/lock/outcome machinery (extended, not replaced).

---

## Data Model

All new entities follow the standard OM patterns already used across billing:
UUID PKs, `organization_id` + `tenant_id` scoping, soft delete where
appropriate, JSONB for flexible payloads, **no cross-package ORM relations**,
`numeric(18,4)` stored as string in app code.

### Change 1 — `BillingAccount` (extend)

| New column | Type | Null | Description |
|---|---|---|---|
| `billing_mode` | text | no (default `'postpaid'`) | `'postpaid'` \| `'prepaid'`. Immutable after create. Validated at API ingress. Existing rows default to `postpaid` (no behavior change). |
| `credit_limit` | numeric(18,4) | no (default `0`) | Credit line extended to this customer (**both modes**). Prepaid: permitted overdraft below zero. Postpaid: max outstanding AR exposure. `0` = no credit. Set via `billing.account.manage`. |

> The running balance is **not** a column on this table — it lives in
> `BillingAccountBalance` so the high-write balance update never touches the
> account row that the Bill Run hot-path index
> (`(organization_id, tenant_id, next_bill_date)`) sits on.

### Entity A — `BillingAccountBalance` (new, 1:1 with account)

The denormalized running balance — the O(1) read + the row the atomic
decrement locks. Exactly one row per prepaid account.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `organization_id`, `tenant_id` | uuid | no | Scope |
| `bill_account_id` | uuid | no | **Unique** FK (string) to `BillingAccount` |
| `currency_code` | text | no | Denormalized from the account (balance currency) |
| `balance` | numeric(18,4) | no (default `0`) | Running balance. May be **negative**. Maintained by atomic `UPDATE … RETURNING`. |
| `low_balance_threshold` | numeric(18,4) | yes | When `balance <= threshold` → status `low` + `billing.balance.low` event. Null = use tenant config default. |
| `last_movement_at` | timestamptz | yes | Timestamp of the most recent transaction (cheap "is this account active?" signal) |
| `created_at`, `updated_at` | timestamptz | std | OM defaults |

Indexes: unique `(tenant_id, bill_account_id)`; `(organization_id, tenant_id, balance)` (operator "who's low/negative?" queries).

### Entity B — `BillingAccountTransaction` (new, append-only)

The source of truth for every balance movement. Append-only — pattern mirrors
`DraftInvoiceEdit` (no `updated_at`/`is_active`; `deleted_at` reserved for
compliance erasure only).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `organization_id`, `tenant_id` | uuid | no | Scope |
| `bill_account_id` | uuid | no | FK (string) to `BillingAccount` |
| `type` | text | no | `topup` \| `usage` \| `recurring` \| `one_time` \| `adjustment` \| `reversal` |
| `amount` | numeric(18,4) | no | **Signed**: `> 0` credit, `< 0` debit. Balance = `SUM(amount)`. |
| `currency_code` | text | no | Must equal the account currency |
| `balance_after` | numeric(18,4) | no | Running balance **after** this transaction (snapshot from the atomic `RETURNING`). Enables audit + fast statement math without re-summing. |
| `usage_id` | uuid | yes | FK (string) to `BillingAccountUsage` for `type='usage'` |
| `billing_item_id` | uuid | yes | FK (string) to the Billing Item that priced this debit (`usage` / `recurring` / `one_time`) |
| `topup_id` | uuid | yes | FK (string) to `BillingTopup` for `type='topup'` |
| `statement_id` | uuid | yes | FK (string) to the `BillingStatement` a period-close charge (`recurring`/`one_time`) was rolled into |
| `description` | text | no | Human line (e.g. "API requests — 53,000 @ graduated", "Top-up — Stripe", "Platform fee — May 2026") |
| `source_ref` | text | yes | Idempotency key, **unique** per `(tenant_id, bill_account_id, source_ref)`. For usage debits = the usage record's `source_ref`; for recurring = `recurring-{itemId}-{periodEndISO}`. |
| `metadata` | jsonb | yes | e.g. `usage_tier_breakdown`, `uom_code`, `bill_period_start`/`end` (recurring attribution), gateway ids |
| `user_id` | uuid | yes | Operator for manual `adjustment` / `reversal` |
| `created_at` | timestamptz | no | Append time |
| `deleted_at` | timestamptz | yes | Compliance erasure only |

Indexes: unique `(tenant_id, bill_account_id, source_ref)`;
`(organization_id, tenant_id, bill_account_id, created_at)` (history paging +
statement window scan); `(bill_account_id, type, created_at)`.

### Entity C — `BillingTopup` (new — the "registered top-up")

One row per top-up attempt. Directly answers *"register account balance
top-ups"* — a queryable lifecycle, not just a balance credit.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `organization_id`, `tenant_id` | uuid | no | Scope |
| `bill_account_id` | uuid | no | FK (string) to `BillingAccount` |
| `status` | text | no | `pending` \| `captured` \| `failed` \| `expired` \| `cancelled` |
| `amount` | numeric(18,4) | no | Top-up amount requested |
| `currency_code` | text | no | Must equal the account currency |
| `provider_key` | text | no | Gateway provider (`stripe`, …) |
| `payment_id` | uuid | no | The UUID we pass to `createPaymentSession` and match the captured event on. **Unique** per tenant. |
| `gateway_transaction_id` | uuid | yes | FK (string) to `payment_gateways.GatewayTransaction` once the session is created |
| `transaction_id` | uuid | yes | FK (string) to the credit `BillingAccountTransaction` written on capture |
| `receipt_invoice_id` | uuid | yes | FK (string) to the `core/sales` VAT receipt invoice |
| `source_ref` | text | yes | Optional idempotency for the initiating request |
| `metadata` | jsonb | yes | `success_url` / `cancel_url`, provider payload echoes |
| `created_at`, `updated_at` | timestamptz | std | Lifecycle |
| `deleted_at` | timestamptz | yes | Soft delete |

Indexes: unique `(tenant_id, payment_id)`; `(organization_id, tenant_id, bill_account_id, created_at)`; `(tenant_id, status)`.

### Entity D — `BillingStatement` (new — period close)

A non-fiscal consumption summary for a prepaid account's bill period.
Every listed entity gets a detail page (engineering bar) — statements
included.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | uuid | no | PK |
| `organization_id`, `tenant_id` | uuid | no | Scope |
| `bill_account_id` | uuid | no | FK (string) to `BillingAccount` |
| `bill_run_id` | uuid | yes | FK (string) to the `BillRun` that generated it (period close reuses the run engine) |
| `period_start`, `period_end` | date | no | Statement window (same calendar math as postpaid) |
| `currency_code` | text | no | Account currency |
| `opening_balance` | numeric(18,4) | no | Balance at `period_start` (= the prior statement's `closing_balance`, chaining cleanly) |
| `total_topups` | numeric(18,4) | no | Sum of credits in window |
| `total_usage` | numeric(18,4) | no | Sum of metered (real-time) usage debits in window (absolute) |
| `total_recurring` | numeric(18,4) | no | Sum of `recurring` + `one_time` charges debited at this close (absolute) |
| `closing_balance` | numeric(18,4) | no | `opening + topups − usage − recurring` (= balance after this run's debits) |
| `debit_breakdown` | jsonb | no | Per `billing_item_id`: `billing_type`, `uom_code?`, quantity, amount |
| `status` | text | no | `generated` \| `sent` |
| `created_at`, `updated_at` | timestamptz | std | OM defaults |

Indexes: `(organization_id, tenant_id, bill_account_id, period_end)`; unique `(tenant_id, bill_account_id, period_start, period_end)` (anti-duplicate, mirrors the postpaid open-draft guard).

### Reused entities

- **`BillingItem`** — *the price.* `type=usage` items define the per-unit /
  tiered usage price; `recurring` / `one_time` items define period charges.
  "Default pricing on signup" = creating the prepaid account with the right
  items. **No schema change.** On a prepaid account, `recurring`/`one_time`
  items are charged to the **balance** at period close (see
  [Period close](#period-close--recurring-charges--statement)), not to a
  payable invoice.
- **`BillingAccountUsage`** — *the consumption audit record.* Still written on
  every upload. In prepaid it is rated immediately; its
  `rated_in_bill_run_id` is set to a **prepaid sentinel** (or left null but
  excluded by mode) so a postpaid Bill Run never re-rates it. The paired
  `BillingAccountTransaction.usage_id` links the two.
- **`core/sales` `SalesInvoice`** — *the top-up VAT receipt.*

---

## Real-time consume path (the core flow)

Endpoint: **the existing** `POST /api/billing/usage`. For a `prepaid`
account it does extra work and returns a richer body; for `postpaid` it is
**unchanged**. This matches the requirement literally — *"usage is uploaded →
api returns remaining balance."*

```
POST /api/billing/usage
{ billAccountId, uomCode, quantity, periodStart, periodEnd, sourceRef? }
```

Sequence (prepaid account), all inside one DB transaction:

1. **Resolve account + mode.** Load account; if `postpaid`, fall through to
   today's append-only behavior and return the legacy body.
2. **Idempotency.** If `sourceRef` already has a `BillingAccountUsage`,
   return the **existing** record and its paired transaction's
   `balance_after` (no second debit). `deduplicated: true`.
3. **Persist the usage record** (as today).
4. **Rate it** with `rateUsageForItem(item, quantity)` where `item` is the
   active `type=usage` Billing Item matching `uomCode` (exact match, no
   conversion — same rule as postpaid).
   - **No matching item / malformed rate** → debit `0`, attach
     `warning: 'no_matching_item'` (or `'unratable'`), balance unchanged.
     We still recorded the usage. (Mirrors postpaid `unmatched_usage_uoms`.)
5. **Atomically debit the balance** — single statement, no app-side
   read-modify-write, so concurrent uploads can't lose updates:
   ```sql
   UPDATE billing_account_balances
      SET balance = balance - :amount, last_movement_at = now(), updated_at = now()
    WHERE tenant_id = :t AND bill_account_id = :a
   RETURNING balance;          -- authoritative post-balance
   ```
6. **Append the transaction** (`type='usage'`, `amount = -rated`,
   `balance_after = <returned>`, `usage_id`, `billing_item_id`,
   `source_ref`, `metadata.usage_tier_breakdown`).
7. **Mark the usage rated** (prepaid sentinel) so no Bill Run re-rates it.
8. **Compute `balance_status`** and emit threshold events on a downward
   crossing (see [Balance status](#balance-status--exhaustion)).
9. **Respond:**

```jsonc
// 200 OK (prepaid)
{
  "id": "…", "deduplicated": false,
  "ratedAmount": "12.3400",
  "currencyCode": "EUR",
  "balance": "87.6600",          // remaining; may be negative
  "balanceStatus": "ok",         // prepaid funds: "ok" | "low" | "exhausted"
  "creditStatus": "within_limit",// credit line:  "within_limit" | "near_limit" | "over_limit"
  "tierBreakdown": [ /* … */ ],
  "warning": null                // or "no_matching_item"
}
```

**Concurrency correctness.** Step 5's single-row `UPDATE … RETURNING`
serializes via the Postgres row lock on the balance row — N concurrent
uploads apply N debits with no lost update and each gets a distinct
`balance_after`. The transaction insert in the same DB transaction carries
that exact snapshot. The reconciliation invariant `balance == SUM(amount) ==
latest.balance_after` is asserted in tests.

**Throughput note.** The path is O(1) (one insert + one update + one insert) —
no scans. As today, **clients pre-aggregate** before posting (per-minute /
per-batch), exactly like the postpaid "pre-aggregated usage" assumption; we
do not meter per individual token.

---

## Top-up path (money in, registered, VAT receipted)

### 1. Initiate — `POST /api/billing/accounts/{id}/topups`

```jsonc
{ "amount": 100.00, "providerKey": "stripe", "successUrl": "...", "cancelUrl": "..." }
```

- Validates the account is `prepaid` and currency matches.
- Mints `payment_id = uuid()`, inserts a **`BillingTopup` (`status=pending`)**.
- Calls `paymentGatewayService.createPaymentSession({ providerKey,
  paymentId, amount, currencyCode, successUrl, cancelUrl, captureMethod:
  'automatic', metadata: { kind: 'prepaid_topup', billAccountId, topupId } })`.
- Stores `gateway_transaction_id` on the top-up; returns
  `{ topupId, redirectUrl | clientSecret, transactionId }` for the client to
  complete checkout.

### 2. Capture — subscriber on `payment_gateways.payment.captured`

New subscriber `subscribers/prepaid-topup-captured.ts`:

1. Load the `GatewayTransaction` by `payload.paymentId` (scoped by
   tenant/org). Read its `amount` + `gateway_metadata.kind`.
2. If `kind !== 'prepaid_topup'` → **no-op** (leave it to other subscribers).
   This is how it coexists with the existing
   `payment-captured-to-paid.ts` (which matches `paymentId == invoiceId` for
   postpaid; a top-up's `paymentId` is not an invoice id, so that subscriber
   already no-ops).
3. Find the `BillingTopup` by `payment_id`. If already `captured` → **no-op**
   (idempotent re-fire).
4. In one DB transaction:
   - Atomic **credit**: `UPDATE billing_account_balances SET balance =
     balance + :amount … RETURNING balance`.
   - Append a `BillingAccountTransaction` (`type='topup'`, `amount = +amount`,
     `balance_after`, `topup_id`, `source_ref = 'topup-' || payment_id`).
   - Create the **VAT receipt** in `core/sales`: a `SalesInvoice` with one
     "Account top-up" line, real sequence number, **run the tax service**
     (VAT at top-up), status `posted` then `paid`
     (`paidTotalAmount = grandTotalGross`, `outstanding = 0`) —
     `metadata.kind='prepaid_topup'`, `bill_account_id`, `topup_id`.
   - Transition `BillingTopup → captured`, backfill `transaction_id` +
     `receipt_invoice_id`.
   - Emit `billing.balance.topped_up` and reuse `billing.invoice.posted` so
     the existing mailer/accounting bridge sends the receipt.

`failed` / `cancelled` / `expired` gateway outcomes transition the
`BillingTopup` accordingly (subscribers on the sibling payment events); no
balance movement.

> **Why posted+paid, not draft.** A captured top-up is a completed,
> already-paid transaction with nothing to review — the postpaid draft→human-
> post gate exists for *outbound* bills, not for money already received.
> Documented as a deliberate divergence (mirrors the xd-249 "deviations"
> convention).

---

## Balance status & exhaustion

Per the agreed design, **usage is never rejected**. We classify and report:

| `balanceStatus` | Condition | Engine behavior |
|---|---|---|
| `ok` | `balance > low_balance_threshold` | Record, rate, debit, return |
| `low` | `0 < balance <= low_balance_threshold` | Same + emit `billing.balance.low` on the downward crossing |
| `exhausted` | `balance <= 0` (incl. negative) | Same + emit `billing.balance.exhausted` on the downward crossing |

- Events fire **only on a crossing** (compare `balance_before` vs
  `balance_after`), so a client sitting at `exhausted` and still pushing usage
  is not spammed.
- The status is in **every** consume response, so a well-behaved client can
  self-throttle without subscribing to events. Async consumers (email/Slack/
  webhook, auto-top-up) use the events.
- `low_balance_threshold` resolves account-row → tenant config default
  (`billing.prepaid.low_balance_threshold_default`).
- Recurring charges applied at period close move the balance too, so they can
  also trip these crossings (a subscription fee can be what pushes an
  un-topped-up account negative — recorded, never blocked).
- **The credit line is tracked separately** as `creditStatus` (see
  [Credit limit](#credit-limit-both-modes)): a prepaid account can be
  `exhausted` on funds (`balance <= 0`) yet still `within_limit` on its
  extended credit. Both appear in the consume response.

---

## Credit limit (both modes)

A `credit_limit` (monetary, on `BillingAccount`, default `0`) is the credit
line the business extends to a customer. Billing **computes and reports**
where the account stands against it — it **never blocks** (assumption #11); a
consumer (CPQ order conversion, a dunning job, an operator) decides what to do
with an over-limit signal.

**`credit_used` is computed per mode:**

| Mode | `credit_used` | `available_credit` |
|---|---|---|
| **prepaid** | `max(0, −balance)` — the portion of the balance gone negative (drawing on the credit line) | `balance + credit_limit` when `balance < 0`, else `credit_limit` |
| **postpaid** | Σ **outstanding** (posted, not-yet-paid) invoice `outstandingAmount` from `core/sales` for the account (v1 — mid-period accrued usage is **not** counted; see Open Questions) | `credit_limit − credit_used` |

**`creditStatus` (both modes):**

| Status | Condition |
|---|---|
| `within_limit` | `available_credit > near_limit_buffer` |
| `near_limit` | `0 < available_credit <= near_limit_buffer` |
| `over_limit` | `available_credit <= 0` (`credit_used >= credit_limit`) |

`near_limit_buffer` resolves account → tenant config
(`billing.credit.near_limit_buffer_default`).

**Read API** — `GET /api/billing/accounts/{id}/credit-status` (feature
`billing.credit.view`):

```jsonc
{
  "mode": "postpaid",
  "creditLimit": "5000.0000",
  "creditUsed": "4200.0000",        // prepaid: max(0,−balance); postpaid: Σ outstanding
  "availableCredit": "800.0000",
  "creditStatus": "within_limit",
  "currencyCode": "EUR"
}
```

Prepaid surfaces `creditStatus` inline on every consume response (no extra
round-trip); postpaid consumers call this endpoint at decision points.

**Events.** `billing.credit.over_limit` fires on the upward crossing of
`credit_used` past `credit_limit` — in prepaid when a usage debit (or recurring
charge) pushes `balance` below `−credit_limit`; in postpaid when a newly
**posted** invoice pushes outstanding past the limit. (`billing.credit.near_limit`
optional, same crossing rule at the buffer.)

**Enforcement is the consumer's.** Billing exposes the status; the quote→order
flow (e.g. a CPQ credit guard / `@dainamite/cpq-billing-connector`) reads
`credit-status` before converting a quote and decides whether to block, warn,
or require a deposit. Billing never refuses an order, and prepaid never rejects
usage. Setting the limit itself is an account edit (`billing.account.manage`).

---

## Period close — recurring charges + statement

Reuse the **Bill Run** scheduler rather than inventing a second cron — and it
**still runs for prepaid accounts**, because a prepaid customer may also be
subscribed to `recurring` products (a monthly platform fee, a base plan). When
a run processes a **`prepaid`** account that is due (`next_bill_date <=
as_of_date`):

1. Skip the postpaid **draft-invoice** path (no payable invoice for prepaid).
2. Compute the period window with the existing calendar math
   (`deriveBillPeriod`).
3. **Charge `recurring` + `one_time` items to the balance.** Select the
   eligible items with the **existing** `itemSelector.selectItemsForPeriod`
   + `buildInvoiceLinesFromItems` (same full-cycle / mid-cycle rules, same
   item-level `billed_to_date` guard). Instead of emitting invoice lines,
   route each computed amount to a **balance debit**: the atomic
   `UPDATE … RETURNING` + a `BillingAccountTransaction`
   (`type='recurring'|'one_time'`, **deterministic**
   `source_ref='recurring-{itemId}-{periodEndISO}'` so a retry/catch-up can
   never double-charge), then set `billed_to_date=period_end` (real mode).
   Tag each with `metadata.bill_period_*` for attribution.
   *(Metered `usage` was already rated + debited in real time during the
   period — it is **not** re-rated here.)*
4. **Build the `BillingStatement`** for the window: `opening_balance` (= the
   prior statement's `closing_balance`, chaining cleanly), top-ups, real-time
   usage debits, the recurring/one-time debits just applied, `closing_balance`,
   and a per-item `debit_breakdown`. Backfill `statement_id` on those charge
   transactions.
5. **Anti-duplicate — three guards:** statement unique
   `(bill_account_id, period_start, period_end)`, per-item `billed_to_date`,
   and the deterministic charge `source_ref`.
6. Advance `next_bill_date` / `last_bill_date` exactly as today; `catch_up`
   loops one statement (and one set of recurring debits) per missed period —
   never combined.
7. Record a `BillRunOutcome` (a nullable `statement_id` is added to the
   outcome, used instead of `draft_invoice_id` for prepaid accounts).
8. Emit `billing.statement.generated`; reuse the mailer to send it.

**No new fiscal document at period close.** Recurring fees draw down
already-taxed (at top-up) balance exactly like usage, so the statement stays
non-fiscal. (Separately VAT-invoicing recurring on a prepaid account would be
the VAT-at-consumption model — out of scope; see Open Questions.)

`dry` / `test` run modes behave analogously (compute / persist-flagged, no
balance move, no state advance).

---

## API Contracts

All routes export `openApi`, use `makeCrudRoute` where they are CRUD, follow
CPQ-style `api/<resource>/route.ts`, and validate with Zod (`z.infer` types).

| Method & path | Purpose | Feature |
|---|---|---|
| `POST /api/billing/usage` | **Extended** — prepaid accounts get real-time rate+debit and the balance body | `billing.usage.ingest` |
| `GET /api/billing/accounts/{id}/balance` | Current balance + status + threshold | `billing.balance.view` |
| `GET /api/billing/accounts/{id}/credit-status` | Credit limit / used / available / status (both modes) | `billing.credit.view` |
| `GET /api/billing/transactions` | Paged account transactions (filter by account, type, period) | `billing.balance.view` |
| `POST /api/billing/transactions/adjust` | Manual credit/debit (`adjustment`), audited (`user_id`) | `billing.balance.adjust` |
| `POST /api/billing/accounts/{id}/topups` | Register a top-up + create a payment session | `billing.topup.create` |
| `GET /api/billing/topups` / `…/{id}` | List / detail registered top-ups | `billing.topup.view` |
| `GET /api/billing/statements` / `…/{id}` | List / detail consumption statements | `billing.statement.view` |
| `POST /api/billing/statements/generate` | Manual statement generation for an account/period | `billing.statement.generate` |

Writes go through the **command pattern** (`commands/transactions.ts`,
`commands/topups.ts`, `commands/statements.ts`) registered on the command bus,
so there is one write path (the connector / future REST share it). Mutate-
then-query sequences use `withAtomicFlush`.

---

## Events (`events.ts` additions)

| Event | When | Broadcast |
|---|---|---|
| `billing.balance.topped_up` | Top-up captured, balance credited | yes |
| `billing.balance.low` | Balance crosses ≤ threshold (downward) | yes |
| `billing.balance.exhausted` | Balance crosses ≤ 0 (downward) | yes |
| `billing.usage.rated` | A usage debit was applied (optional; may be sampled to avoid noise) | optional |
| `billing.statement.generated` | A period statement was produced | yes |
| `billing.credit.over_limit` | `credit_used` crosses ≥ `credit_limit` (upward) | yes |
| `billing.credit.near_limit` | `available_credit` crosses ≤ buffer (upward) — optional | yes |

`billing.invoice.posted` is **reused** for the top-up receipt.

---

## ACL (`acl.ts` additions) & default roles (`setup.ts`)

| Feature | Grants |
|---|---|
| `billing.balance.view` | Read balance + transactions |
| `billing.balance.adjust` | Manual balance adjustments (credit/debit) |
| `billing.topup.create` | Initiate a top-up / payment session |
| `billing.topup.view` | Read registered top-ups |
| `billing.statement.view` | Read statements |
| `billing.statement.generate` | Trigger statement generation |
| `billing.credit.view` | Read account credit status (limit / used / available) — setting the limit uses `billing.account.manage` |

Role mapping deltas:
- `admin` — `billing.*` (already wildcard; nothing to add).
- `billing_admin` — all of the above.
- `billing_finance_user` — `balance.view`, `credit.view`, `topup.view`, `statement.view` (read-only).
- `billing_usage_writer` — unchanged (`usage.ingest`); for prepaid this key now also *reads back* the balance in the response (no extra grant needed — it's the same call's response). External metering keys that must **also** initiate top-ups get `billing.topup.create`.

Run `yarn mercato auth sync-role-acls` after adding features (per core AGENTS.md).

---

## Configurable Elements

| Config (namespace `billing`) | Default | Purpose |
|---|---|---|
| `prepaid.low_balance_threshold_default` | `0` (off until set) | Fallback threshold when the account leaves it null |
| `prepaid.topup_provider` | `stripe` | Default gateway provider key for top-up sessions |
| `prepaid.statement_enabled` | `true` | Master switch for period statements |
| `credit.near_limit_buffer_default` | `0` (warn only at the limit) | Fallback buffer for the `near_limit` credit status |

Statement cadence reuses the account's `bill_cycle` / `bill_cycle_anchor`.

---

## Personas & End-to-end Story

**Persona shift.** Prepaid adds an **end customer / external system** who
tops up and consumes via API key, alongside the existing Billing admin
(reads balances, adjusts, reviews top-ups/statements) and Finance user
(read-only).

**Story — "API product, pay as you go":**

1. **Sign up.** A prepaid `BillingAccount` (`billing_mode='prepaid'`,
   `currency_code='EUR'`, monthly cycle) is created with **default pricing**:
   a `type=usage` item, `uom_code='api_request'`,
   `rate_json={ "model":"graduated","tiers":[{"up_to":10000,"unit_price":0},{"up_to":null,"unit_price":0.001}] }`,
   plus a `recurring` **base fee** (`rate_json={ "unit_price": 20.00 }`,
   monthly) drawn from the same balance. A `BillingAccountBalance` row starts
   at `0`.
2. **Top up.** Customer `POST …/topups { amount: 100 }` → Stripe Checkout →
   pays. `captured` fires → `BillingTopup → captured`, transaction `+100`,
   **balance = 100**, VAT receipt `FV/2026/06/0042` posted+paid + emailed.
3. **Consume.** Their system batches usage hourly and `POST /usage
   { uomCode:'api_request', quantity: 8000 }`. Rated graduated against the
   item's tiers → say `5.00` debited → response `{ ratedAmount:'5.0000',
   balance:'95.0000', balanceStatus:'ok' }`. Transaction `-5`.
4. **Runs low.** After heavy use balance hits `8.00` with threshold `10` →
   response `balanceStatus:'low'`, `billing.balance.low` emitted once →
   customer's webhook triggers an auto-top-up (or a human tops up).
5. **Exhausts.** If they keep going past `0`, uploads still succeed,
   `balance:'-3.0000'`, `balanceStatus:'exhausted'`. With a `credit_limit` of
   €50 the response also shows `creditStatus:'within_limit'` (only past −50
   does `billing.credit.over_limit` fire). **We never blocked them** — their
   client is expected to stop; the negative is cleared by the next top-up.
6. **Period end.** Nightly Bill Run hits the account on the 1st → **debits the
   €20 base fee** from the balance (transaction `recurring`, `billed_to_date`
   set) → emits a **`BillingStatement`** for the previous month (opening 0,
   top-ups 100, usage 103, recurring 20, closing −23), emailed. Nothing due —
   the −23 is simply cleared by the next top-up.

---

## Performance & Scale

- **Consume path:** O(1); the only contention point is the per-account
  balance row, which is the intended serialization point. Different accounts
  never contend. Index `(tenant_id, bill_account_id)` unique on the balance
  table.
- **Transaction growth:** append-only, paged by
  `(bill_account_id, created_at)`; statements read a bounded window. For very
  high-volume accounts, statement math uses `balance_after` snapshots (no full
  re-sum) and the window scan rides the composite index.
- **Reconciliation job** (optional worker): periodically asserts
  `balance == SUM(transactions.amount)` per account and alerts on drift — a
  cheap guard against any future non-atomic write slipping in.

---

## Compliance Notes

- **VAT at top-up.** The fiscal document is the top-up receipt; the core
  tax service computes VAT there. Statements are explicitly **non-fiscal**.
  (If a jurisdiction later requires VAT-at-consumption, that becomes the
  alternative Q4 model — out of scope here; the transaction log already
  carries everything needed to switch.)
- **Gap-free numbering** for top-up receipts reuses
  `salesDocumentNumberGenerator` (atomic SQL upsert), same as postpaid.
- **Auditability.** Every balance change is a `BillingAccountTransaction` with
  `balance_after` context; every top-up is a `BillingTopup` with provider +
  receipt links; manual adjustments carry `user_id`. GDPR export
  (`GET /api/billing/export/account/{id}`) extends to include balance,
  transactions, top-ups, and statements.

---

## Out of scope (v1)

- **The demo** (API-product tenant, token UX, storefront) — tracked
  separately as agreed; this spec is the **engine** only.
- **Abstract credits/token units** — monetary balance only.
- **Separate VAT-invoicing of recurring on prepaid** — recurring fees draw
  down already-taxed balance (a non-fiscal statement line). Issuing a per-
  charge VAT invoice instead = the VAT-at-consumption model, not v1.
- **Auto-top-up / saved payment methods** — the `billing.balance.low` event
  is the hook; the engine ships without the automation.
- **Credit enforcement / holds** — billing reports `creditStatus` but never
  blocks; auto-suspending or refusing orders over-limit is the consuming flow's
  job (e.g. a CPQ credit guard).
- **Refunds crediting balance, balance expiry, dunning, currency
  conversion.**
- **Mode switching** on a live account (postpaid ↔ prepaid).

---

## Delivery Plan

| Phase | Deliverable | Milestone |
|---|---|---|
| P0 | Schema: `billing_mode` + `credit_limit` on account; `BillingAccountBalance`, `BillingAccountTransaction`, `BillingTopup`, `BillingStatement`; validators; ACL features; `setup.ts` roles + configs; migration | Schema migrates; defaults seeded |
| P1 | Real-time consume: prepaid branch on `POST /usage` (rate → atomic debit → transaction → status), idempotent no-double-debit, `GET …/balance`, `GET /transactions`, low/exhausted events, **reconciliation invariant tests** | "Upload usage → get balance back" works |
| P2 | Top-up: `POST …/topups` + session, `prepaid-topup-captured` subscriber (credit + VAT receipt + register), `BillingTopup` list/detail, `topped_up` event, idempotent capture | Top up via Stripe → balance up, receipt issued |
| P3 | Period close: Bill Run prepaid branch **charges `recurring`/`one_time` items to the balance** (reuse `itemSelector`/`buildInvoiceLines` → balance debits, deterministic `source_ref`, `billed_to_date` guard) then builds `BillingStatement` (+ outcome `statement_id`); statements API + **detail page**; `statement.generated` event | Recurring drawn from balance; monthly statement auto-generated |
| P4 | Admin UI: account **Prepaid panel** (balance, status, transactions table, top-up button), top-ups list+detail, statements list+detail, balance/low widgets; en/pl i18n | Operator can see + manage prepaid accounts |
| P5 | Manual adjustments (`POST /transactions/adjust`, audited), GDPR export extension, optional reconciliation worker, docs/manual | Hardening + ops |
| P6 | Credit limit (both modes): `credit_limit` field + `billing.credit.view`; prepaid `creditStatus` on consume + `billing.credit.over_limit` event; postpaid `GET …/credit-status` from `core/sales` outstanding; the CPQ-side credit check is the consumer's (out of this package) | Credit status exposed; consumers can enforce |

Each phase ships unit tests under `__tests__/` (services, rater reuse,
balance math, idempotency, atomic-decrement concurrency, reconciliation),
keeps the full validation gate green, and updates `packages/billing/MIGRATION.md`
+ the package CHANGELOG.

---

## Acceptance Criteria

- [ ] A prepaid account can be created (`billing_mode='prepaid'`) with a
      `type=usage` default-pricing item and a zeroed balance row.
- [ ] `POST /api/billing/usage` on a prepaid account rates synchronously,
      debits atomically, writes a `BillingAccountTransaction`, and returns
      `ratedAmount` + `balance` + `balanceStatus`.
- [ ] Usage is **never rejected**; balance may go negative;
      `balanceStatus` reflects `ok`/`low`/`exhausted` and crossing events fire
      exactly once per downward crossing.
- [ ] A duplicate `sourceRef` does **not** double-debit and returns the prior
      `balance_after`.
- [ ] `POST …/topups` registers a `BillingTopup (pending)` and returns a
      working payment session; capture credits the balance, writes a credit
      transaction, issues a **posted+paid VAT receipt**, and flips the top-up
      to `captured` — idempotently.
- [ ] A prepaid account's `recurring` / `one_time` items are **debited from
      the balance** by the Bill Run (transactions, not a payable invoice),
      guarded against double-charge by `billed_to_date` + the deterministic
      `source_ref`, and rolled into the statement's `total_recurring`.
- [ ] Postpaid accounts are **completely unaffected** (Bill Run, draft→post,
      existing usage response shape).
- [ ] `GET …/credit-status` returns correct `creditUsed` / `availableCredit` /
      `creditStatus` in both modes (prepaid `max(0,−balance)`; postpaid Σ
      outstanding), `billing.credit.over_limit` fires once on the upward
      crossing, and billing **never blocks** on it.
- [ ] `balance == SUM(transactions.amount) == latest balance_after` holds
      under concurrent uploads (tested).
- [ ] A due prepaid account in a Bill Run produces a `BillingStatement`
      (not a draft invoice), with anti-duplicate on the period window.
- [ ] Every new entity has list + detail pages; every route exports `openApi`;
      new ACL features are wired into `setup.ts` and synced.

---

## Open Questions

1. **Statement document format** — is the period statement purely an in-app
   record + email body, or do we also render a PDF (reuse a `core/sales`
   template path)? Leaning in-app + email for v1.
2. **`billing.usage.rated` event** — keep per-debit (useful for live UI) or
   drop to avoid high-volume noise? Default: ship it but mark
   `excludeFromTriggers` and document sampling.
3. **Manual adjustments & VAT** — admin credits/debits to the balance are
   non-fiscal by default; confirm no receipt is expected for an adjustment.
4. **Recurring drawdown tax treatment** — confirmed in scope: prepaid accounts
   may hold `recurring`/`one_time` items charged to the balance at period
   close. Open nuance: is the non-fiscal statement treatment acceptable in all
   target jurisdictions, or do some require a VAT document when a recurring fee
   is *consumed* (→ VAT-at-consumption)?
5. **Postpaid accrued exposure** — v1 counts only posted-unpaid invoices toward
   `credit_used`. Do we later add a real-time accrued-usage estimate (rate the
   current period on demand) for tighter exposure, and should `near_limit_buffer`
   be an absolute amount or a % of the limit?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-17 | Initial draft. Decisions locked: engine in `@dainamite/billing`; monetary append-only transaction log; usage never rejected (report, don't block); VAT at top-up + consumption statement; top-ups registered as first-class `BillingTopup`. Demo deferred to a separate spec. |
| 2026-06-17 | Recurring/one-time charges brought **in scope** for prepaid: the periodic Bill Run still runs for prepaid accounts and debits those charges from the balance, rolling them into the statement (`total_recurring`); non-fiscal drawdown, reusing the postpaid item selector + `billed_to_date` guard + deterministic `source_ref`. Renamed the balance-movement entity `BillingLedgerEntry` → **`BillingAccountTransaction`** (consistent with `BillingAccount*`; `entry_type` → `type`; `/api/billing/ledger` → `/api/billing/transactions`). |
| 2026-06-17 | Added **credit limit** (both modes, `credit_limit` on `BillingAccount`, default 0): report-only `creditStatus` (`within_limit`/`near_limit`/`over_limit`) + `billing.credit.over_limit` event + `GET …/credit-status`. Prepaid `credit_used = max(0,−balance)` (overdraft allowance, separate from `balanceStatus`); postpaid `credit_used = Σ posted-unpaid invoice outstanding`. Billing never blocks — enforcement is the consumer's (e.g. a CPQ order guard). |
