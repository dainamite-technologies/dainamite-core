# Execution plan — Billing Account workspace, Phase 1 (B2C accounts, invoice-language picklist, return-to-account navigation)

Source spec: .ai/specs/2026-11-14-billing-account-workspace.md (Phase 1 + decisions E2-D1, E2-D2)
Base branch: main
Branch: feat/billing-account-workspace-phase1
Packages: `@dainamite/billing`, `@dainamite/cpq-billing-connector`

## Tasks

| Phase | Step | Title | Status |
|-------|------|-------|--------|
| 1 | 1.1 | Invoice-language registry + validators | done |
| 1 | 1.2 | `customer_kind` on BillingAccount (entity, migration, validators, command, API) | done |
| 1 | 1.3 | Connector passes `customerKind` | done |
| 2 | 2.1 | Customer lookup + prefill helpers (pure) | done |
| 2 | 2.2 | AccountForm: Company/Person switch, prefill, language select | done |
| 2 | 2.3 | Customer name + kind on account list and detail | done |
| 3 | 3.1 | Return-target resolver (pure) | done |
| 3 | 3.2 | Item create/detail/delete navigation | done |
| 4 | 4.1 | i18n (en, pl) | done |
| 4 | 4.2 | Demo seed: one person account | done |
| 4 | 4.3 | Integration test TC-BILL-004 | written, not run (needs migration applied) |
| 4 | 4.4 | Docs, CHANGELOG, validation gate | done |

## Goal

An operator can create a Billing Account for a **company or a person**, with name, email and address prefilled from the customer record, and pick the invoice language from a list. Pages opened from an account (item create, item detail, item delete) **return to that account**.

## Scope

Billing account entity/validators/API/form/list/detail, item pages navigation, connector seed payload, i18n, demo seed, one Playwright flow.

## Non-goals

- Workspace tabs, summary cards, "Run billing" (Phase 2). Financial list columns (Phase 2).
- `BillingSettings`-driven language narrowing/default (comes with Spec 0. Phase 1 uses the code registry only).
- Dynamic breadcrumbs (see Risks). Phase 1 changes the back button and redirects, not the breadcrumb trail.
- Applying the migration. `yarn mercato db migrate` only after user confirmation (AGENTS.md rule 4).

---

## Step details

### 1.1 Invoice-language registry + validators
- New `lib/invoiceLanguages.ts`: `SUPPORTED_INVOICE_LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'pl', label: 'Polski' }] as const`, plus `INVOICE_LANGUAGE_CODES` and `DEFAULT_INVOICE_LANGUAGE = 'en'`.
- `data/validators.ts`: `invoiceLanguage` in `billingAccountCreateSchema` / `billingAccountUpdateSchema` becomes `z.enum(INVOICE_LANGUAGE_CODES)` (after `trim().toLowerCase()` preprocess). Create defaults to `'en'` when omitted.
- Tests (`__tests__/validators.test.ts`): accepts `en`/`pl`/`PL `, rejects `de`, default applied.
- Note: existing data and the connector already use `en`. Seeds are checked in 4.2.

### 1.2 `customer_kind` on BillingAccount
- `data/entities.ts`: `@Property({ name: 'customer_kind', type: 'text', default: 'company' }) customerKind: 'company' | 'person' = 'company'`.
- Migration: `yarn mercato db generate` (billing module), reviewed: one `alter table add column … not null default 'company'`.
- Validators: `CUSTOMER_KINDS = ['company','person']`. `customerKind` optional on create (default `company`), **absent from update** (immutable like `customerId`). List query gets an optional `customerKind` filter.
- `commands/accounts.ts`: persist on create. Undo/snapshot includes the field.
- `api/accounts/route.ts`: add `customer_kind` to list `fields`, the item response Zod schema, the `customerKind` filter in `buildFilters`, and `openApi` descriptions.
- `generated/` entity registry regen (`scripts/generate-entity-registry.mjs`) if field lists are generated.
- Tests: validators (default, enum, update strips it), command create persists kind.

### 1.3 Connector passes `customerKind`
- `cpq-billing-connector/lib/billingApiClient.ts` `AccountSeed`: + `customerKind?: 'company' | 'person'`.
- `subscribers/cpq-subscription-activated.ts`: `ActivatedPayload.customerKind?`, passed through (default omitted → billing default `company`).
- Connector tests updated (payload with/without kind).

### 2.1 Customer lookup + prefill helpers (pure, `components/customerLookup.ts`)
- `customerEndpoint(kind)` → `/api/customers/companies` | `/api/customers/people`.
- `toCustomerOption(raw)` → `{ value, label: display_name, description: primary_email }` (snake/camel tolerant, as today).
- `mapPrimaryAddress(rows)` → picks `is_primary` (else the first row) and maps it to `invoiceAddress`: `line1 = address_line1 [+ ' ' + building_number][+ '/' + flat_number]`, `line2 = address_line2`, `city`, `postal_code`, `country`. Returns `null` if required parts are missing.
- `applyPrefill(current, customer, address)` → fills **only empty** fields: `name`, `invoiceEmail`, `invoiceAddress` (E2-D2). Never overwrites user input.
- `fetchCustomerNames(rows: {customer_id, customer_kind}[])` → **max 2 batched calls per page** (`?ids=…&pageSize=n` on companies and people, chunks ≤ 100), returns `Record<id, {name, kind}>`. Falls back to the id on failure. This is the soft dependency.
- Core customers have **no tax-ID field**, so tax ID is not prefilled (deviation from the spec wording, noted in the spec changelog).
- Unit tests for all pure helpers (address mapping edge cases, no-overwrite rule, chunking).

### 2.2 AccountForm
- Create mode: a `SegmentedControl` **Company / Person** above the customer combobox. Switching kind clears `customerId` (and the name, if it was prefilled and untouched) and swaps `loadSuggestions` to `customerEndpoint(kind)`.
- On customer select: run the existing name autofill. Fetch `/api/customers/addresses?entityId=<id>&pageSize=20` → `mapPrimaryAddress` → `applyPrefill`. A failed fetch is silently ignored.
- Edit mode: kind shown read-only (icon + label) next to the disabled customer ID.
- `invoiceLanguage`: the text input is replaced by a `Select` over `SUPPORTED_INVOICE_LANGUAGES` (default `DEFAULT_INVOICE_LANGUAGE`).
- Keep `Cmd/Ctrl+Enter` submit and `Escape` cancel behaviour as is.

### 2.3 Customer name + kind on list and detail
- `backend/billing/accounts/page.tsx`: the "Customer" column shows the resolved name with a `Building2` / `User` icon (lucide) via `fetchCustomerNames` once per loaded page. Add a Kind filter (Company / Person) → `customerKind` query param.
- `backend/billing/accounts/[id]/page.tsx` (`AccountView`): show the customer name + kind and a link to the customer record (`/backend/customers/companies/<id>` or `/backend/customers/people/<id>`; the paths are verified against core backend routes during implementation).

### 3.1 Return-target resolver (`lib/navigation.ts`, pure)
- `resolveItemReturnTarget({ from, billAccountId })`: `from === 'items'` → `/backend/billing/items`. Otherwise, with a `billAccountId` → `/backend/billing/accounts/<id>`. Else the items list.
- Tests: all branches, including a missing account id.

### 3.2 Item navigation
- `items/page.tsx`: row click → `/backend/billing/items/<id>?from=items`.
- `accounts/[id]/page.tsx`: item row click unchanged (no `from`), so the target is the account.
- `items/[id]/page.tsx`: `FormHeader backHref` and the post-delete redirect use the resolver (`from` from `useSearchParams`, `billAccountId` = `row.bill_account_id`).
- `items/create/page.tsx`: with `?billAccountId=` preset, **after save → the account page** (flash "Item created"), and cancel → the account page. Without a preset: after save → item detail (unchanged), cancel → items list.
- Usage create already conforms. No change.

### 4.1 i18n
New keys in `i18n/en.json` + `i18n/pl.json`: kind labels (`billing.accounts.kind.company|person`), form switch label, language names, list column/filter labels. Run the i18n check.

### 4.2 Demo seed
`lib/seeds/demo.ts` (and `scripts/seed-demo.mjs` if it creates accounts): add one **person** account (B2C, PLN, monthly, `invoiceLanguage: 'pl'`). Check that all seeded languages are in the registry. Update `__tests__/lib/seedsDemo.test.ts`.

### 4.3 Integration test `__integration__/TC-BILL-004.spec.ts`
Create a person account through the UI (switch to Person, pick a seeded person, check the prefilled email) → "Add item" from the account → save → lands on the **account** page → open the item → Back → lands on the **account** page. Second path: open the item from the global Items list → Back → items list.

### 4.4 Docs + validation gate
- `manuals/billing-ui-testing.md`: section "Person (B2C) billing accounts & navigation".
- `packages/billing/CHANGELOG.md` + connector CHANGELOG: additive, non-breaking (new optional field, language now validated against supported codes; **note:** values other than `en`/`pl` are now rejected).
- Spec E changelog: Phase 1 done, tax-ID prefill not possible (no core field).
- Gate: `yarn generate`, `yarn typecheck` (both packages), `yarn test`, i18n check, `yarn build`. Migration generated but **not applied** until confirmed.

---

## Risks

| Risk | Mitigation |
|---|---|
| Static breadcrumbs (`page.meta.ts`) can't show the account name | Out of scope. The back button + redirects carry the UX. Revisit if the page-meta API gets dynamic crumbs. |
| Customers API field names drift (`display_name`, `primary_email`, `address_line1`) | Tolerant mappers + unit tests. A failed lookup degrades to the id / no prefill. |
| Stricter language validation rejects existing API callers sending other codes | Only `en` is used today (connector + seeds). Called out in CHANGELOG. |
| Person IDs pasted into old company-only flows | `customer_id` was always kind-agnostic. No engine code reads the customer. |

## Open items for the user

None. All decisions are taken in the spec (E2-D1..E2-D3).
