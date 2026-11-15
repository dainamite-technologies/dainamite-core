# CPQ → Billing Connector — Order Billing Setup (account choice, account defaults, per-item bill start)

**Date**: 2026-11-15
**Status**: Phases 1 and 2 implemented (2026-11-15). Playwright scenario pending.
**Packages**:
- `@dainamite/cpq-billing-connector` owns the feature.
- `@dainamite/cpq` adds one generic injection spot and a richer, additive event payload.
- `@dainamite/billing` needs **no contract change**; it only consumes existing commands and the list API.

**Related**:
- [`2026-11-14-billing-account-workspace.md`](2026-11-14-billing-account-workspace.md) E2-D2: prefill from customer in the admin form. This spec mirrors it for the CPQ path.
- [`2026-11-15-billing-default-invoice-language.md`](2026-11-15-billing-default-invoice-language.md): the connector stops forcing `en`. Independent, but it touches the same `buildAccountSeed`.
- `specs/implementation/xd-249-billing-spec.md` § CPQ Integration.

## TLDR

**Key Points:**
- The billing accounts created from CPQ activation today look like `Customer 066ce1d3-…` with a `billing+<id>@invalid.local` email and a `TBD` address. Every item starts billing on the activation date, and the operator can't change it.
- The connector adds a **"Billing" tab to the CPQ order detail page**, injected through a generic CPQ spot. Before activation, the operator:
  1. chooses an **existing billing account** (active, same currency) or **creates a new one**. A new account is prefilled from the customer, and every field can be overridden;
  2. sets **one default bill start date** for the order ("on activation" by default) and can change it **per line**.
- Even without the tab, defaults improve: CPQ's activation event now carries the customer name, email and billing address from the sales order snapshot, so placeholders become a last resort.
- **CPQ works unchanged without billing.** CPQ ships only an empty spot and billing-neutral event fields. Remove the connector and both are inert.

**Scope (MVP = Phase 1):**
- CPQ: an injection spot on the order detail page, plus `customerName` / `customerKind` / `invoiceEmail` / `invoiceAddress` / `items[].startDate` on `cpq.subscription.activated`.
- Connector: the `CpqBillingOrderSetup` entity, a GET/PUT API, an undoable save command, the injected tab widget, and subscriber changes (account resolution and per-item bill start).
- A latent bug fix: the connector no longer reuses a billing account with a different currency or an inactive one.

**Out of scope:**
- Repairing existing junk accounts (decided: not needed).
- Blocking activation on a missing setup (decided: defaults are always valid).
- Billing-side UI changes.

**Phase 2:** per-line bill start for **added** lines on ARC (amend/renew) orders.

---

## Decisions

| # | Decision |
|---|---|
| D1 | The UI is a **Billing tab on the CPQ order detail page** (`/backend/cpq/orders/[id]`), injected by the connector into a new generic CPQ spot. It is editable while the order is `draft` / `pending_activation` and read-only once the setup is applied. |
| D2 | **No activation gate.** A missing or unconfirmed setup never blocks `POST /api/cpq/orders/:id/activate`. The subscriber falls back to the defaults. The tab shows a "Billing will use defaults" hint until the operator saves. |
| D3 | **Bill start has two levels.** The order has one default bill start, `null` meaning "on activation date" (the default). Each line can **override** it. Effective per-line value: line override → CPQ line `start_date` (the service start, when the quote set one) → order default → activation date. CPQ keeps owning service dates, and the connector owns billing dates. |
| D4 | **Account candidates** are billing accounts for the same `customerId` with the **same currency** that are **active** (`isActive = true`, not deleted). Exactly one → preselected. None → "Create new". Several → the operator must pick (no preselection). **Without a saved setup**, the subscriber reuses the most recently created candidate, or creates a new account if there is none. A different-currency or inactive account is **never** reused, which fixes the current `findOne`-by-customer bug. |
| D5 | **New-account defaults**: operator override → customer data from the event payload (sales order snapshot) → today's placeholders. The setup stores **only the fields the operator changed**, so a customer data fix between saving and activation still flows through. |
| D6 | **Existing junk accounts are not repaired.** |
| D7 | **ARC orders**: in Phase 2 the same tab shows only the per-line bill start for **added** lines. The account is fixed by the subscription and shown read-only. |

## Problem Statement

1. **Junk account identity.** `emitActivatedEvent` (CPQ) sends only `customerId` and `currencyCode`. The connector's `buildAccountSeed` already accepts `customerName` / `invoiceEmail` / `invoiceAddress`, but nobody sends them. So the account gets `Customer <uuid>`, a fake `@invalid.local` email and a `TBD` / `XX` address (see the screenshot in the request: the billing account list shows the uuid name).
2. **No account choice.** `findAccountByCustomer` takes the first account for the customer with **no currency or active filter** and no deterministic order. A COP subscription can be attached to a USD account, and a customer with two accounts gets a random one.
3. **Rigid bill start.** Every item gets `billStartDate = activationDate`. `CpqOrderLineConfiguration.startDate` exists but only feeds the subscription start. Installation delays, free first periods and staggered go-lives can't be represented without editing billing items by hand after activation.
4. **Optional dependency.** CPQ is sold without billing, so CPQ must not import, call or label anything billing-related.

## Proposed Solution

### Layering

```
@dainamite/cpq                         @dainamite/cpq-billing-connector               @dainamite/billing
──────────────                         ────────────────────────────────               ──────────────────
orders/[id]/page.tsx                   widgets/injection/order-billing-setup
  <InjectionSpot                ◄────── (tab: Account · Bill start per line)
   'cpq.order.detail:tabs'               │ GET/PUT /api/cpq_billing_connector/
   context={order}/>                     │        order-setups/:orderId
                                         ▼
                                       CpqBillingOrderSetup (own table)
                                         ▲                                      ┌─ GET /api/billing/accounts
cpq.subscription.activated ──────────► subscriber ─ resolve account + starts ──┤   (candidates, UI side)
 (+ customer snapshot fields,            │                                      └─ commandBus:
    items[].orderLineId, startDate)      └─ marks setup applied                    billing.accounts.create
                                                                                   billing.items.bulk_create
```

- **CPQ → connector**: an event (already the case) plus an injection spot (new). The spot is **generic**: its id says nothing about billing, and any add-on (provisioning, ERP export) can fill it.
- **Connector → billing**: the command bus for writes (already the case), and billing's REST list API for UI candidates. The subscriber's server-side candidate lookup keeps the existing `BillingApiClient` EM path (see Risks R5).
- **Connector → CPQ**: reads `CpqOrderConfiguration` / `CpqOrderLineConfiguration` **through CPQ's REST** (`GET /api/cpq/orders/:id`) in the widget. The API resolves defaults server-side through the `cpqOrderService` DI service (the connector already depends on CPQ as a peer). It never uses an ORM relation.

### Why the connector owns the state (and not CPQ or billing)

- **CPQ** can't store "billing account id" or "bill start override", because that would leak billing concepts into a package that ships without billing.
- **Billing** can't store "CPQ order id → account choice", because billing must not know about CPQ.
- The connector is the only package that legitimately knows both sides. It goes from "pure glue" to "glue plus a small setup table".

## User Stories

- An **order desk operator** wants to **attach a CPQ order to the customer's existing billing account** so that **the new subscription is invoiced on the same bill as the old one**.
- An **order desk operator** wants a **new billing account prefilled with the customer's real name, email and address** so that **the billing account list and invoices never show uuids or `TBD`**.
- An **order desk operator** wants to **set a later bill start for the line that is installed next month** so that **the customer isn't invoiced before the service is live**.
- A **CPQ-only customer** (no billing installed) sees **no billing tab and no behaviour change**.

## Data Models

### `CpqBillingOrderSetup` (connector; table `cpq_billing_connector_order_setups`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid | indexed |
| `tenant_id` | uuid | indexed |
| `cpq_order_id` | uuid | FK string → `CpqOrderConfiguration.id`. **Unique** on (`organization_id`, `tenant_id`, `cpq_order_id`) where `deleted_at is null` |
| `customer_id` | text | Copied from the order on first save. Used to validate the account choice |
| `currency_code` | text | Copied from the order. Used to validate the account choice |
| `account_mode` | text | `'existing' \| 'new'` |
| `billing_account_id` | text null | Required when `account_mode = 'existing'`. FK string → `BillingAccount.id` |
| `account_overrides` | jsonb | `{}` by default. Only the changed fields: `name`, `invoiceEmail`, `invoiceLanguage`, `invoiceAddress`, `billCycle`, `billCycleAnchor`, `nextBillDate`, `taxId`, `customerKind`. Ignored when the mode is `existing` |
| `default_bill_start_date` | date null | `null` = on activation date (D3) |
| `line_bill_starts` | jsonb | `{}` by default. `{ [salesOrderLineId]: 'YYYY-MM-DD' }` — the `lineId` the CPQ order API exposes (`CpqOrderLineConfiguration.orderLineId`). Only lines the operator overrode |
| `applied_at` | timestamptz null | Set by the subscriber. Once set, the setup is read-only |
| `applied_billing_account_id` | text null | The account the subscriber actually used, for the read-only view |
| `created_at`, `updated_at`, `deleted_at` | | standard |

- Generated with `yarn mercato db generate` in the connector package. It is **the connector's first migration** (the package's `files` and README must ship `migrations/`).
- There are no ORM relations. Everything is an FK string.

## API Contracts

All routes are in the connector, in one `api/order-setups/[orderId]/route.ts` with `GET` + `PUT` (the layout of the sibling `@dainamite/billing` and `@dainamite/cpq` packages). The route exports `openApi`.

### `GET /api/cpq_billing_connector/order-setups/:orderId`

- Auth: `requireFeatures: ['cpq_billing_connector.order_setup.view']`
- It resolves the CPQ order via `cpqOrderService.getOrder(orderId, scope)`; a missing order → 404.
- Response `200`:
```jsonc
{
  "orderId": "…",
  "orderStatus": "draft",            // from CPQ
  "quoteType": "new",                // 'new' | 'amend' | 'renew' | …; non-'new' → Phase 2 view
  "editable": true,                  // status ∈ {draft, pending_activation} && !appliedAt
  "setup": null | {                  // stored row (null = never saved)
    "accountMode": "existing" | "new",
    "billingAccountId": "…" | null,
    "accountOverrides": { … },
    "defaultBillStartDate": "2026-12-01" | null,
    "lineBillStarts": { "<lineId>": "2026-12-15" },
    "appliedAt": null, "appliedBillingAccountId": null,
    "updatedAt": "…"
  },
  "defaults": {                      // what the subscriber would use with no setup
    "account": { "name": "Test S.A.S.", "invoiceEmail": "…", "invoiceAddress": { … },
                 "customerKind": "company", "billCycle": "monthly", "billCycleAnchor": "1" },
    "lines": [ { "lineId": "…", "name": "Fiber 1G", "serviceStartDate": "2026-12-01" | null,
                 "hasBillableCharge": true } ]
  }
}
```
- Account **candidates** are not returned here. The widget calls `GET /api/billing/accounts?customerId=…&currencyCode=…&isActive=true&pageSize=50`, which is billing's own ACL and existing filters. So an operator without `billing.accounts.view` sees "Create new" only, plus a hint.

### `PUT /api/cpq_billing_connector/order-setups/:orderId`

- Auth: `requireFeatures: ['cpq_billing_connector.order_setup.manage']`
- Body (Zod `orderSetupUpsertSchema`):
```ts
{
  accountMode: 'existing' | 'new',
  billingAccountId?: string | null,          // required iff existing
  accountOverrides?: Partial<AccountSeedOverrides>,   // strict, known keys only
  defaultBillStartDate?: string | null,      // YYYY-MM-DD
  lineBillStarts?: Record<uuid, string>,     // keys must be lines of this order
}
```
- It runs the `cpq_billing_connector.order_setup.save` command (upsert, **undoable**: undo restores the previous snapshot or soft-deletes a row it created).
- Errors:

| Status | When |
|---|---|
| `404` | order not found in scope |
| `409` | `appliedAt` is set, or the order is not `draft` / `pending_activation` |
| `422` | `billingAccountId` is not active, is not this customer's, or has a different currency; `lineBillStarts` names a line outside the order; a date is malformed |
| `200` | returns the same shape as GET |

- **Account validation** on save happens through billing's command-free read path (see R5). The subscriber validates again at apply time (R1).

### CPQ event payload (additive)

`cpq.subscription.activated` gains:

| Field | Source |
|---|---|
| `customerName` | the sales order's `customerSnapshot.customer.displayName` |
| `customerKind` | `customerSnapshot.customer.kind` (`company` / `person`) |
| `invoiceEmail` | `customerSnapshot.customer.primaryEmail` |
| `invoiceAddress` | the sales order's `billingAddressSnapshot`, mapped to `{ line1, line2, city, postal_code, region, country }` |
| `items[].orderLineId` | the sales order line id (`CpqOrderLineConfiguration.orderLineId`) behind each subscription item — the key for `lineBillStarts` |
| `items[].startDate` | the line's `startDate` (`YYYY-MM-DD` or omitted) |

- Any field may be absent. The connector already treats them as optional, so old connector versions ignore the new fields and an old CPQ still yields today's behaviour.
- The payload type is declared in CPQ's `events.ts`.

## UI — Billing tab (connector widget)

- **Spot (CPQ):** `cpq.order.detail:tabs`, rendered by `backend/cpq/orders/[id]/page.tsx` with context `{ orderId, cpqStatus, customerId, currencyCode, quoteType }`. When nothing is injected, the page renders exactly as today.
- **Widget:** `widgets/injection/order-billing-setup/`, `kind: 'tab'`, label `cpq_billing_connector.orderSetup.tab` ("Billing"), gated by `cpq_billing_connector.order_setup.view`.

**Section A — Billing account**
- Radio: *Use existing account* / *Create new account*.
  - Existing: select from the candidates (name · currency · bill cycle · next bill date). Preselect only if there is exactly one candidate (D4).
  - New: a form prefilled from `defaults.account` (name, invoice email, invoice language, address, customer kind, bill cycle, anchor, next bill date, tax ID). A field the operator edits becomes an override, and "Reset to customer value" clears it.

**Section B — Bill start**
- An order-level "Default bill start" date picker, empty = "On activation" (the placeholder shows that text).
- A table with one row per billable line: name · service start (CPQ, read-only) · bill start (editable). The placeholder shows the inherited value per D3 ("On activation" or the service start date).

**States and behaviour**
- Footer: Save (`Cmd/Ctrl+Enter`), Reset. A dirty-state indicator. A "Billing will use defaults" info banner while `setup === null`.
- **Read-only** once applied: shows the resulting billing account (link to `/backend/billing/accounts/:id`) and the effective bill start per line.
- Loading, error and 403 are handled distinctly (`LoadingMessage` / `ErrorMessage`).
- All strings use i18n keys in `en/es/de/pl` for the connector. The connector has no `i18n/` today, so this adds it.

## Subscriber changes (`cpq-subscription-activated`)

```
setup = findSetup(scope, payload.sourceOrderId)            // may be null
account =
  setup?.accountMode === 'existing' && isValidCandidate(setup.billingAccountId)
    ? setup.billingAccountId
    : setup?.accountMode === 'new'
      ? create(merge(placeholders, payloadDefaults, setup.accountOverrides))
      : newestCandidate(customerId, currency, active) ?? create(merge(placeholders, payloadDefaults))
billStart(item) = setup?.lineBillStarts[item.orderLineId]
               ?? item.startDate
               ?? setup?.defaultBillStartDate
               ?? payload.activationDate
bulkCreateItems(… billStartDate: billStart(item) …)        // unchanged idempotency via source_ref
markApplied(setup, account.id)                              // also creates a row when setup was null
```

- **Idempotency:** a re-fired event finds `appliedAt` set and reuses `appliedBillingAccountId`. That avoids a second "new" account when the first run crashed after creating the account but before creating the items. Items stay deduplicated by `source_ref`.
- **Ordering:** account create → mark applied (account id) → items. A retry after an item failure reuses the recorded account.
- **`nextBillDate` for a new account:** override → the earliest effective bill start across the items → the activation date. This keeps billing-in-advance semantics (Billing Spec A) for a delayed start.
- **`buildAccountSeed`** becomes `buildAccountSeed(payload, overrides?)`, with precedence override → payload → placeholder. It stays a pure function and keeps its existing tests.
- **`findAccountByCustomer`** is replaced by `findCandidateAccounts(scope, customerId, currencyCode)`, which filters active, not deleted and same currency, ordered by `createdAt desc`.

## ACL

- `cpq_billing_connector.order_setup.view`, `cpq_billing_connector.order_setup.manage`.
- `setup.ts` `defaultRoleFeatures`: admin gets both. Roles that have `cpq.orders.manage` get both (they activate orders, so they set billing up).
- `acl.ts` drops the "no features" comment.

## Implementation Plan

### Phase 1 — New-sale order billing setup (MVP)

1. **CPQ payload.** `emitActivatedEvent` loads the sales order snapshot and adds the customer fields plus `items[].orderLineId` / `startDate`. Declare the shape in `events.ts`. Unit test: the snapshot is mapped; missing snapshot → fields omitted.
2. **CPQ spot.** `<InjectionSpot spotId="cpq.order.detail:tabs" …>` in the order detail page's tab bar. Unit or RTL test: no widgets → identical render. Add a `packages/cpq/MIGRATION.md` / CHANGELOG entry (new public spot id).
3. **Connector entity and migration.** `data/entities.ts`, `yarn mercato db generate`, and package `files` include `migrations`.
4. **Connector validators and command.** `orderSetupUpsertSchema`; the `order_setup.save` command with undo. Tests: schema accept/reject; undo after create soft-deletes, undo after update restores.
5. **Connector API.** The GET/PUT routes plus `openApi`, ACL features and `setup.ts` role defaults. Tests: 404 / 409 / 422 paths with a mocked `cpqOrderService` and billing reads.
6. **Subscriber.** Candidate filtering (D4), seed precedence (D5), bill start precedence (D3), the apply marker and idempotency. Tests: extend `accountSeed.test.ts`; add `activated.test.ts` covering existing-valid, existing-now-inactive → falls back, new-with-overrides, no-setup-one-candidate, no-setup-currency-mismatch → creates, re-fire after a partial failure.
7. **Widget.** The tab, both sections, read-only state and i18n (`en/es/de/pl`). `yarn generate`.
8. **Docs.** Connector README ("Order billing setup", "now has one entity"), the `manuals/cpq-quote-to-order-conversion.md` billing section, and the CHANGELOGs for both packages.
9. **Integration test (Playwright).** Quote → order → Billing tab → pick "Create new", override the name, set one line's bill start to +14 days → Activate → billing account has that name, and the item's `bill_start_date` = +14 days. Second scenario: the connector is absent from the spot (CPQ standalone path), so the tab is not visible.

### Phase 2 — ARC orders (D7)

1. The CPQ amended/renewed payloads carry `addedItems[].orderLineId` / `startDate`.
2. The widget renders the bill-start section only, with the account read-only (from the subscription's existing billing items).
3. The `amended` / `renewed` subscribers apply the per-line bill start to **added** items, and the proration window starts at the effective bill start. Tests extend `amended.test.ts`.

## Risks

| # | Risk | Severity | Mitigation | Residual |
|---|---|---|---|---|
| R1 | The chosen existing account is deactivated, deleted or changed between save and activation | Medium | The subscriber revalidates (active, same customer, same currency). If invalid, it falls back to the D4 no-setup path and logs a warning with the order id | The operator learns of the fallback only from the read-only tab ("used account X instead of Y"), not from a notification. A notification type can be added later |
| R2 | A subscriber crash between account create and item create makes a duplicate account on retry | High (money) | The `appliedAt` / `appliedBillingAccountId` marker is written right after account creation, and a retry reuses it | The window between the account-create command commit and the marker write. Acceptable: a stray empty account is visible and harmless |
| R3 | The connector gains state, so a migration ships with a "glue" package | Medium | Documented in the README and CHANGELOG. `yarn mercato db migrate` after upgrade, as for every Dainamite package | — |
| R4 | The sales snapshot has no billing address (customer without addresses) | Low | Placeholders are kept as a last resort. The widget shows an empty address so the operator fills it in | Unattended activations can still create a `TBD` address |
| R5 | The connector's direct `BillingAccount` entity import (existing L2-boundary TODO) grows | Low | Only the subscriber's candidate query reuses the existing EM path. All UI reads go through billing REST. The TODO stays tracked | Same coupling as today, one more query |
| R6 | A tenant uses CPQ plus billing but not the connector | — | Today's behaviour without the connector is "no billing at all". Unchanged | — |
| R7 | The operator saves a setup and then the order's lines change (re-converted quote) | Low | `lineBillStarts` keys that no longer match a line are ignored at apply time. GET drops them from the view | Silent drop of a stale override |

## Spec Checklist (summary)

- **Isolation:** FK strings only; CPQ has no billing references; the connector reads CPQ through its DI service / REST and billing through the command bus / REST.
- **Tenant scoping:** every query filters `organization_id` + `tenant_id`, and the entity has the standard columns.
- **Writes:** the save is a command with undo. The subscriber writes through billing commands plus a connector-local marker.
- **Validation:** Zod on PUT; dates are `YYYY-MM-DD`; override keys are strict.
- **Auth:** `requireFeatures` on both routes (never `requireRoles`).
- **i18n:** connector dictionaries in 4 locales.
- **Pagination:** the candidate list uses `pageSize=50` (≤ 100).
- **Events:** no new events. The CPQ payload change is additive and declared in `events.ts`.

## Changelog

- 2026-11-15: Skeleton from a user request (junk account name, existing-vs-new account, per-item bill start; CPQ must work without billing).
- 2026-11-15: Open questions resolved:
  - Q1: Billing tab on the CPQ order, one default bill start from the activation date, modifiable per item.
  - Q2: no activation gate.
  - Q3: per-line default from the CPQ line start, otherwise the order default.
  - Q4: only active, same-currency accounts.
  - Q5: ARC in Phase 2.
  - Q6: no repair of existing data.
  - Full design, API, data model, phases and risks written.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — New-sale order billing setup | Done | 2026-11-15 | Steps 1–8 done; step 9 (Playwright) proposed, not written |
| Phase 2 — ARC orders | Done | 2026-11-15 | Amend + renew; merge renewals out of scope (see below) |

### Phase 1 — Detailed Progress

- [x] Step 1: CPQ payload — `lib/activatedEventCustomer.ts`, `cpqOrderService.getOrderCustomerFields` (forked EM + `findOneWithDecryption`; the snapshots may be encrypted), `items[].orderLineId` / `startDate`, `payloadSchema` in `events.ts`
- [x] Step 2: CPQ spot — `components/InjectedDetailTabs.tsx` (generic), `lib/orderDetailInjection.ts`; no tab strip when nothing is injected
- [x] Step 3: Entity + migration — hand-written `Migration20261115000000_cpq_billing_connector_order_setups` (package convention: `db generate` only diffs `@app` modules)
- [x] Step 4: Validators + undoable command `cpq_billing_connector.order_setup.save`
- [x] Step 5: API `GET` / `PUT /api/cpq_billing_connector/order-setups/[orderId]` with `openApi`, mutation guards, ACL, role defaults
- [x] Step 6: Subscriber — `resolveBillingAccount` (applied → chosen → new-with-overrides → newest candidate → create), apply marker before items, per-line bill start
- [x] Step 7: Widget (Billing tab) + `i18n/{en,es,de,pl}.json`
- [x] Step 8: Docs — connector README, manual Step 8b, changeset `cpq-order-billing-setup`
- [ ] Step 9: Playwright scenario (needs a running app + migrated DB)

### Phase 2 — Detailed Progress

- [x] Step 1: CPQ `addedItems[].orderLineId` / `startDate` on `amended` / `renewed` — `buildArcLineRefs` joins the change log's `quoteLineId` to the order line's `sourceQuoteLineId`
- [x] Step 2: Widget — bill-start section only, info about the subscription's account, ARC-specific fallback labels; cancel orders show "nothing to bill"
- [x] Step 3: `amended` / `renewed` apply the per-line bill start to added items (fallback: effective date / new term start) and lock the setup (`markApplied`). Billing prorates from each item's `bill_start_date`, so no extra proration logic is needed
- Service: `accountMode` is optional in the body and ignored for ARC (stored as `existing` with no account); only billable **added** lines accept a bill start

### Known limits

- **Merge renewals** (`applyMergeRenewal`, several target subscriptions) emit `cpq.subscription.merged`, which carries no added items — lines added by a merge renewal get no billing items at all today (pre-existing gap), so their bill starts are not applied.
- An ARC order touching several subscriptions locks the setup on the first applied event; the account link shows the last one.

### Deviations from the design

- `lineBillStarts` keys are **sales order line ids** (the `lineId` of the CPQ order API), not `CpqOrderLineConfiguration.id`, so the UI needs no extra lookup.
- `cpq.subscription.amended` now resolves the account from the subscription's existing billing items (as `renewed` already did), not "the customer's first account" — required once a customer can have several accounts.
- `BillingApiClient.getOrCreateAccount` removed (replaced by `findCandidateAccounts` / `findAccountById`).

