# CPQ — Quotes, Orders and Subscriptions for Persons (B2C)

**Date**: 2026-11-15
**Status**: Draft (ready for implementation)
**Package**: `@dainamite/cpq` (+ `@dainamite/cpq-billing-connector`, test only)
**Related**: [`2026-11-14-billing-account-workspace.md`](2026-11-14-billing-account-workspace.md) §1 (billing B2C accounts, `customer_kind`), [`2026-11-15-cpq-billing-connector-order-billing-setup.md`](2026-11-15-cpq-billing-connector-order-billing-setup.md)

## TLDR

**Key Points:**
- An operator can create a CPQ quote for a **person** (B2C), not only a company. The quote converts to an order and activates into subscriptions and assets owned by that person. Billing then opens a **person** billing account, matching billing Spec E.
- Most of the stack is already kind-agnostic: `customer_id` points to `customers.CustomerEntity`, which holds both kinds. The gaps are:
  1. **UI:** every customer picker and name lookup hard-codes `/api/customers/companies`.
  2. **Server, one bug:** quote → order conversion does not copy the customer snapshot onto the `SalesOrder`. `cpq.subscription.activated` therefore never carries `customerKind`, and billing defaults every account to `company`.

**Scope (MVP):**
- Copy the quote's customer snapshot onto the sales order at conversion. Fall back to the live customer when a snapshot is missing (orders converted before this change).
- The CPQ read APIs (quotes, orders, subscriptions, assets) return `customerKind` + `customerName`, resolved server-side in one batched query per response. No new columns.
- A shared `CpqCustomerPicker` with a **Company / Person** switch, used by the quote create modal and the wizard `customer-select` step. The step gets an `allowedKinds` config.
- The detail pages show the name and link to the right customer page for each kind. The list pages get a Customer column.

**Out of scope (deferred, D4):**
- B2C price display (gross / tax-inclusive totals on person quotes and PDFs).
- A contact person on company quotes.
- Person leads from the Puffin public calculator.
- Searching CPQ lists by customer **name** (search stays on quote number / customer id).

## Overview

Dainamite sells to consumers as well as businesses. Billing already supports person accounts. CPQ is the gap: an operator can't pick a person when creating a quote. Even if they could (via the API), the resulting subscription would land on a **company** billing account and show as a truncated UUID across the CPQ admin.

## Problem Statement

### Current state (verified 2026-11-15)

| Where | Today |
|---|---|
| `CpqQuoteConfiguration`, `CpqOrderConfiguration`, `CpqInventorySubscription(Item)`, `CpqInventoryAsset` | `customer_id uuid` → `CustomerEntity` (company **or** person). No kind column |
| `cpqQuotingService.createQuote` (`:85`) | Loads `CustomerEntity` (tenant-scoped) with both profiles and accepts **any kind**. Sets `quote_context.customer_type = kind`, and `customer_domain` for companies only. Writes `SalesQuote.customerSnapshot` via `buildCustomerSnapshot`, which already includes `kind` |
| `cpqOrderService.convertFromConfig` (`:144`) | Creates the `SalesOrder` with `customerEntityId` but **no `customerSnapshot`** (and no `billingAddressSnapshot`) ← **bug** |
| `cpqOrderService.getOrderCustomerFields` (`:756`) → `buildActivatedEventCustomerFields` | Reads `salesOrder.customerSnapshot.customer.kind/displayName/primaryEmail`. Gets `{}` for CPQ-converted orders, so the event omits `customerKind`, `customerName` and `invoiceEmail` |
| Billing connector | Passes `customerKind` through. When it is missing, billing defaults to `company` |
| ARC / renew (`cpqQuotingService:727`, `:1891`) | Copy `customerEntityId` + `customerSnapshot` from the source. Kind-agnostic |
| Quote detail (`resolveQuoteSideData`) | Already returns `customerName` from `CustomerEntity.displayName`. No kind |
| Quote / order / subscription / asset **lists** | Return `customerId` only. No customer column in the UI |
| `quotes/page.tsx:93` (create modal) | `fetch('/api/customers/companies?pageSize=100')`, then filters on the client. **Companies only** |
| `workflows/steps/CustomerSelectStep.tsx:36` | `fetch('/api/customers/companies?search=…')`. **Companies only** |
| `orders/[id]/page.tsx:201`, `inventory/subscriptions/[id]/page.tsx:332`, `inventory/assets/[id]/page.tsx:109` | Name lookup via `/api/customers/companies?id=…`. A person shows a truncated UUID. Raw `fetch` (convention violation) |
| Customer inventory tab | Already injected on both `detail:customers.company:tabs` and `detail:customers.person:tabs` |
| Billing precedent | `billing/lib/customerLookup.ts`: per-kind endpoint + detail-path maps and a Company / Person switch in `AccountForm` |

## Proposed Solution

### Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Resolve the kind at read time. Add no `customer_kind` column** to CPQ entities (Q1a). | CPQ already depends on `@open-mercato/core` customers (`CustomerEntity` import), and a customer's kind is immutable. This avoids a 5-table migration and backfill. Billing denormalized only because it must not depend on the customers module. Revisit if filtering lists by kind at scale becomes a requirement. |
| D2 | **Company / Person segmented switch** in the picker, default Company (Q2a). | Matches the billing account form. Each kind has its own search endpoint, so paging stays simple. |
| D3 | The wizard `customer-select` step gets **`allowedKinds`**, default `['company','person']` (Q3). | Existing wizards gain the switch with no config change. A B2B-only wizard sets `['company']` and the switch hides. |
| D4 | B2C price display, contact persons, Puffin person leads and customer-name search are **deferred** (Q4). | Separate concerns. Price rules can already branch on `quote_context.customer_type = 'person'`. |
| D5 | **Copy `SalesQuote.customerSnapshot` → `SalesOrder.customerSnapshot` at conversion.** `getOrderCustomerFields` **falls back to the live `CustomerEntity`** (kind, displayName, primaryEmail) when the order has no snapshot. | The snapshot is the order's frozen "who was this sold to" record, as in core `sales`. The fallback fixes orders already converted without a snapshot, with no data migration. |
| D6 | CPQ keeps its own ~20-line kind → endpoint / detail-path map instead of importing billing's `customerLookup`. | `@dainamite/cpq` must not depend on `@dainamite/billing` (SPEC-001: one domain = one package). If a third package needs it, it moves to a shared helper. |
| D7 | The customer summary lookup is **tenant-scoped** (`tenantId` + `id IN`), like `createQuote`'s customer validation. | `createQuote` deliberately allows a customer whose `organizationId` differs within the tenant, so an org-scoped read would lose those names. The ids come from rows that are already org-scoped, so this does not widen access across tenants. |

### Architecture

```
createQuote(customerId: any kind) ──► SalesQuote.customerSnapshot {customer.kind, …}   (exists)
          │
convertFromConfig ──► SalesOrder.customerSnapshot = quote snapshot                    (D5, new)
          │
activate ──► getOrderCustomerFields ── snapshot? ─yes─► {customerKind, customerName, invoiceEmail}
                                        └─no──► live CustomerEntity fallback           (D5, new)
          │
cpq.subscription.activated { customerKind:'person' } ──► connector ──► billing account kind=person (exists)

GET /api/cpq/{quotes,orders,inventory/subscriptions,inventory/assets}
   └─ resolveCustomerSummaries(em, ids, scope) — 1 query per response ──► customerKind, customerName  (D1, new)
```

There are no new events, entities, commands or DI registrations. `resolveCustomerSummaries` is a plain function in `lib/` that takes the request-scoped `em` from the existing services and routes.

## User Stories

| # | As a… | I want… | Maps to |
|---|---|---|---|
| US1 | Sales operator | to pick a **person** when I create a CPQ quote (list page or wizard) | Picker, `allowedKinds` |
| US2 | Sales operator | quote, order, subscription and asset screens to show the person's name and link to their person page | API fields, detail pages, list column |
| US3 | Billing operator | a person's activated subscription to open a **person** billing account with their name and email | D5 snapshot copy + fallback |
| US4 | Wizard designer | to restrict a wizard to companies only | `allowedKinds` |

## Data Models

**No schema changes.** No new entities or columns, and no migration.

Behavioral change only: `SalesOrder.customerSnapshot` (core `sales` column, already exists) is now populated for CPQ-converted orders with the same shape `buildCustomerSnapshot` produces:

```ts
{ customer: { id, kind: 'company'|'person', displayName, primaryEmail, primaryPhone,
              personProfile: {id, firstName, lastName, preferredName} | null,
              companyProfile: {id, legalName, brandName, domain, websiteUrl} | null },
  contact: null }
```

`SalesOrder.billingAddressSnapshot` stays unset. It was never set before, and the connector already falls back to billing defaults.

### Shared types (new, `lib/customerSummaries.ts`)

```ts
export type CpqCustomerKind = 'company' | 'person'
export type CpqCustomerSummary = { id: string; kind: CpqCustomerKind | null; displayName: string | null }
export async function resolveCustomerSummaries(
  em: EntityManager, ids: string[], scope: { tenantId: string },
): Promise<Map<string, CpqCustomerSummary>>
```

- It deduplicates ids, drops blank ones, and returns an empty map with **no query** when the list is empty.
- It runs one `findWithDecryption(CustomerEntity, { id: { $in }, tenantId, deletedAt: null }, { fields: ['id','kind','displayName'] })` query. Pages are capped at 100, so no chunking is needed.
- A missing or deleted customer is simply absent from the map, and callers emit `null`.
- `kind` values other than `company | person` map to `null`.

## API Contracts

All changes are **additive response fields**. Request contracts are unchanged. Each route's `openApi` export documents the new fields. Auth guards are unchanged: the existing `cpq.*` `requireFeatures` stay.

### Customer fields added to responses

| Endpoint | Change |
|---|---|
| `GET /api/cpq/quotes` (list) | each item + `customerKind`, `customerName` |
| `GET /api/cpq/quotes/[quoteId]` | + `customerKind` (`customerName` already exists) |
| `GET /api/cpq/orders` (list) / `GET /api/cpq/orders/[orderId]` | + `customerKind`, `customerName` |
| `GET /api/cpq/inventory/subscriptions` (list and `?id=`) / `[subscriptionId]` | + `customerKind`, `customerName` |
| `GET /api/cpq/inventory/assets` (list and detail) | + `customerKind`, `customerName` |

```jsonc
// example list item fragment
{ "id": "…", "customerId": "0b5e…", "customerKind": "person", "customerName": "Jan Kowalski", … }
```

- `customerKind`: `'company' | 'person' | null`. `null` means the customer was deleted or cannot be resolved.
- `customerName`: `string | null`.
- Errors are unchanged. A failed customer lookup does **not** fail the request. The fields come back `null` and the error is logged.

The fields are added in the service read methods (`cpqQuotingService` list/get, `cpqOrderService.listOrders/getOrder`, `cpqInventoryService.listSubscriptions/getSubscription/listAssets/getAsset`), so every caller benefits, not only the routes. The quote list route adds them next to its existing batched `quoteNumber` enrichment.

### Event payload (no contract change)

`cpq.subscription.activated` already declares optional `customerKind`, `customerName` and `invoiceEmail`. After D5 they are populated for CPQ-converted orders.

### Wizard step config

`customer-select` step `config`:

```ts
{ segmentFilter?: string[]; allowedKinds?: ('company' | 'person')[] }  // allowedKinds default both
```

Validation: unknown values are dropped, and an empty or invalid list falls back to both kinds. The step's `stepData` gains `customerKind` next to `customerId` / `customerName`. This is additive, and older saved step data without `customerKind` restores as `company`.

## UI

- **`components/customer/CpqCustomerPicker.tsx`** (new, shared):
  - A segmented Company / Person switch (hidden when only one kind is allowed).
  - A debounced server-side search (`apiCall` → `/api/customers/{companies|people}?search=&page=1&pageSize=20`).
  - A result list with name + email, and an empty state.
  - If the user lacks `customers.people.view`, the request returns 403 and the picker shows a "You don't have access to people" message instead of an empty list.
  - Keyboard: Enter selects the highlighted row, Escape closes (dialog convention).
  - Pure helpers go in `lib/customerKinds.ts`: `customerEndpoint(kind)`, `customerDetailHref(kind, id)`, `normalizeAllowedKinds(raw)`.
- **Quote create modal** (`quotes/page.tsx`): replaces the inline company list with `CpqCustomerPicker`. This also removes the load-100-and-filter-client-side behavior.
- **`CustomerSelectStep`**: uses `CpqCustomerPicker` with `allowedKinds` and keeps `segmentFilter`.
- **Order / subscription / asset detail pages**: drop the ad-hoc `fetch` calls. They show `customerName` (fallback: short id) as a link to `customerDetailHref(customerKind, customerId)`, plus a small kind badge (Company / Person).
- **List pages** (quotes, orders, `SubscriptionsTable`, `AssetsTable`): a new **Customer** column showing `customerName`. Pagination wiring is unchanged (`pageSize ≤ 100`).
- **i18n** (`en/es/de/pl`):
  - `cpq.customerPicker.kind.company`, `cpq.customerPicker.kind.person`, `cpq.customerPicker.searchPlaceholder`, `cpq.customerPicker.empty`, `cpq.customerPicker.forbidden`
  - `cpq.common.customer.column`, `cpq.common.customer.unknown`
  - Existing `cpq.wizard.steps.customerSelect.*` keys are reused where they still fit.

## Implementation Plan

### Phase 1 — Server: snapshot propagation and customer summaries

1. `convertFromConfig`: load the source `SalesQuote` (`findOneWithDecryption`, org + tenant scoped) and set `customerSnapshot` on the new `SalesOrder`. This happens inside the existing conversion transaction, and the existing convert undo deletes the order together with its snapshot.
2. `getOrderCustomerFields`: when `salesOrder.customerSnapshot?.customer` is missing, build the fields from the live `CustomerEntity` (`kind`, `displayName`, `primaryEmail`) via a small `customerFieldsFromEntity` helper next to `buildActivatedEventCustomerFields`.
3. `lib/customerSummaries.ts`: `resolveCustomerSummaries`.
4. Wire it into the quote / order / subscription / asset service read methods. Update `openApi` for each affected route.
5. Unit tests (`__tests__/`):
   - `resolveCustomerSummaries`: dedupe, an empty list makes no query, one query for N ids, a missing id → absent, an unknown kind → `null`.
   - Convert: the snapshot is copied, and a quote with no snapshot leaves the order's snapshot `null`.
   - `getOrderCustomerFields`: snapshot wins over the entity, and the fallback is used when the snapshot is absent.
   - Connector: a payload with `customerKind: 'person'` → `POST /api/billing/accounts` body has `customerKind: 'person'` (extend the existing subscriber test).

**Testable outcome:** a person quote created via the API converts and activates, and the billing account it produces has `customer_kind = 'person'`.

### Phase 2 — UI: picker, detail pages, list columns

1. `lib/customerKinds.ts` + unit tests (`normalizeAllowedKinds`, endpoint and href maps).
2. `CpqCustomerPicker`, plus adoption in the quote create modal and `CustomerSelectStep` (`allowedKinds`, `customerKind` in step data).
3. Detail pages (order, subscription, asset): API-sourced name, kind badge and link. Raw `fetch` is removed.
4. A Customer column in the quote, order, subscription and asset lists.
5. i18n keys in all four locales (the dictionary parity test covers this).
6. Wizard editor: an `allowedKinds` multi-select on the `customer-select` step config, if the step config UI exposes `segmentFilter` today. Otherwise it stays config-JSON only, as `segmentFilter` does.

**Testable outcome:** an operator creates a person quote from the CPQ quotes list and from a wizard, and every CPQ screen shows the person's name with a working link.

### Phase 3 — Integration test and docs

1. `TC-CPQ-013` (Playwright): create a person via the customers API → create the CPQ quote through the UI picker (Person tab) → price → accept → convert → activate → assert:
   - the order and subscription detail pages show the person's name and link to `/backend/customers/people/<id>`;
   - when billing is installed, `GET /api/billing/accounts?customerId=` returns `customer_kind: 'person'`.
2. Manuals:
   - `manuals/cpq-quote-to-order-conversion.md`: person customers, and the snapshot copy.
   - `manuals/xd-215-customer-inventory.md`: person inventory.
   - `manuals/xd-188-quote-wizard-with-price-rules.md`: `allowedKinds`, and `customer_type` for B2C price rules.
3. A changeset for `@dainamite/cpq` (minor: additive API fields, new step config) and a `packages/cpq/MIGRATION.md` note: no migration, and orders converted earlier are covered by the fallback.

## Risks

| Risk | Severity | Mitigation / detection |
|---|---|---|
| Price rules or wizards assume a company, e.g. they read `customer_domain` (undefined for persons) | Low | Already true today for any non-company. Document `customer_type` branching in the pricing manual. A rule with a missing context key evaluates as not matched |
| Copying an encrypted snapshot could leak decrypted values into a flush | Medium | Read the quote via `findOneWithDecryption` on the conversion EM and assign a **plain object copy**. The framework re-encrypts `SalesOrder.customerSnapshot` on flush. A unit test asserts the value is a fresh object |
| The live-entity fallback gives the customer's **current** name, not the name at order time, for legacy orders | Low | Only affects orders converted before this change. Billing treats these as defaults that operators can edit |
| The summary lookup bypasses `customers.people.view` (a CPQ user sees a person's display name without customers ACL) | Low | Same as today's `customerName` on the quote detail. Only `displayName` and `kind` are exposed, no contact data |
| Extra query per CPQ list request | Low | One indexed `id IN (≤100)` query, the same pattern as the existing `quoteNumber` enrichment |
| An operator without `customers.people.view` sees an empty Person tab and assumes there are no people | Low | Explicit forbidden message in the picker |
| A customer is deleted after the quote was made | Low | `customerKind` / `customerName` are `null`. The UI shows the short id with no link. The snapshot on the order still holds the name for billing |

## Spec Checklist

- **Design & phasing:** the MVP and deferred items are explicit (D4), and each phase has a testable outcome.
- **Module isolation:** no new ORM relations. `customer_id` stays a FK string. CPQ does not import billing (D6). The connector stays event-driven.
- **Tenancy:** every new read is tenant-scoped (D7). Row selection keeps the existing org + tenant filters.
- **Commands / undo:** no new mutations. The snapshot copy sits inside the existing convert command, whose undo removes the order.
- **Events:** no new events. Existing optional fields on `cpq.subscription.activated` are now populated.
- **Validation:** request schemas are unchanged. `allowedKinds` is normalized defensively.
- **API:** additive fields, `openApi` updated, `requireFeatures` guards unchanged.
- **UI:** shared primitives, `apiCall` (removes raw `fetch`), i18n in 4 locales, `pageSize ≤ 100`, Enter/Escape in the dialog.
- **Data model:** N/A, no schema change.

## Changelog

- 2026-11-15 — Skeleton drafted. The backend is kind-agnostic, and the gap is UI and name resolution. Q1–Q4 raised.
- 2026-11-15 — Q1a (resolve, no column), Q2a (kind switch), Q3 (`allowedKinds`, default both) and Q4 (defer B2C pricing, contact person, Puffin leads) accepted. Verification found that conversion does not copy `customerSnapshot` to the sales order, so the activation event never carries `customerKind` → added D5 (copy + live fallback). The full spec is written.
