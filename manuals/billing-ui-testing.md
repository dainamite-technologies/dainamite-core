# Billing — UI testing manual

How to exercise the `@dainamite/billing` admin UI end to end on a local
dev environment. Covers stack setup, demo data, every billing screen,
and the full Bill Run → draft invoice → post flow.

> Billing is the recurring-billing engine (XD-249): Billing Accounts hold
> Billing Items (one-time / recurring / usage), a **Bill Run** turns due
> items into **draft invoices** in `core/sales`, and an operator reviews
> and **posts** them. See `specs/implementation/xd-249-billing-spec.md`
> for the full design.

---

## 1. Start the stack

```bash
docker compose up -d postgres redis     # database + queue backend
yarn mercato db migrate                 # apply billing migrations (first run only)
yarn dev                                # dev server -> http://localhost:3000
```

Log in at `http://localhost:3000/login`:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@acme.com` | `secret` |

The `admin` role needs the `billing.*` ACL features. They are granted by
the billing module's `setup.ts`, which runs on tenant creation. If
billing was added to an **existing** tenant and the sidebar group does
not appear, run once:

```bash
yarn mercato auth sync-role-acls
```

then restart `yarn dev` (the server caches role ACLs at boot).

---

## 2. Seed demo data

```bash
node packages/billing/scripts/seed-demo.mjs
```

This creates, through the REST API:

- **5 Billing Accounts** — Netia, Orange, Pixel (PLN, due in May),
  CloudFlow (EUR, quarterly, due July), DataPeak (EUR, annual, due June).
- **10 Billing Items** — a mix of recurring, one-time and usage.
- **3 usage records** on Netia's metered "Transfer danych" item.
- **1 test-mode Bill Run** → **3 draft invoices** (Netia / Orange /
  Pixel — the three accounts whose `next_bill_date` has already passed).

### Reset to a clean slate

```bash
docker exec dainamite-core-postgres-1 psql -U postgres -d open-mercato -c "
DELETE FROM sales_invoice_lines WHERE invoice_id IN (SELECT id FROM sales_invoices WHERE jsonb_exists(metadata,'bill_run_id'));
DELETE FROM sales_invoices WHERE jsonb_exists(metadata,'bill_run_id');
DELETE FROM billing_run_outcomes;
DELETE FROM billing_runs;
DELETE FROM billing_account_usage;
DELETE FROM billing_items;
DELETE FROM billing_accounts;"
```

Then re-run the seeder.

---

## 3. Where billing lives

After login, in the left sidebar there is a **Billing** group:

| Screen | URL | What to test |
|---|---|---|
| Billing Accounts | `/backend/billing/accounts` | list, search, filters, create, detail |
| Billing Items | `/backend/billing/items` | list, type/account/active filters, create |
| Billing Invoices | `/backend/billing/invoices` | review queue, post, line edits |
| Bill Runs | `/backend/billing/runs` | run history, per-account outcomes |

The UI is bilingual — switch language with the `locale` cookie
(`pl` / `en`) or the account language picker; headings and column
labels are translated from `packages/billing/src/modules/billing/i18n/`.

---

## 4. Billing Accounts

**List** (`/backend/billing/accounts`)
- Columns: Name, Customer, Currency, Cycle (`monthly · 1`), Next bill,
  Last bill, Status.
- Toolbar: Search (by name), Filters (bill cycle / currency / active),
  Refresh, column chooser, saved views.
- "New account" opens the create form.

**Create** — required: name, customer ID, currency (ISO 4217), bill
cycle + anchor, invoice email, invoice address (line 1 + city), next
bill date. Submit with `Cmd/Ctrl+Enter`.

**Detail** (`/backend/billing/accounts/[id]`)
- `FormHeader` shows the account name + id; actions: **View items**,
  **Add item**, **Soft delete**.
- Edit any mutable field and Save. `currencyCode` and `customerId` are
  immutable on edit (disabled).
- **Soft delete** asks for confirmation, then the account drops out of
  the list (its items + usage stay for audit).

## 5. Billing Items

**List** (`/backend/billing/items`)
- Columns: Type (tag), Description, Account, Start, End, UoM, Status.
- Filters: type (one-time / recurring / usage), Billing Account ID,
  Subscription ID, active.
- Deep link: `/backend/billing/items?billAccountId=<id>` pre-filters to
  one account (this is what "View items" on the account detail uses).

**Create** — pick an account and a type:
- **one-time** / **recurring** → a single Amount / Unit price.
- **usage** → a UoM code (must match usage records exactly, e.g. `gb`)
  plus either a Simple flat rate or a Tiered rate JSON
  (`volume` / `graduated` / `flat`; exactly one tier `up_to: null`).

**Detail** (`/backend/billing/items/[id]`) — edit the rate / dates /
description; read-only badges show currency mismatch, billed-through
date and `source_ref`.

## 6. Bill Runs

A **Bill Run** scans accounts whose `next_bill_date <= as-of date`,
selects their due items, and writes draft invoices.

> The manual trigger is **API-only** for v1 — there is no button on the
> Bill Runs list yet. Trigger one with curl:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=admin@acme.com' --data-urlencode 'password=secret' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -s -X POST http://localhost:3000/api/billing/runs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"test","asOfDate":"2026-05-20"}'
```

Modes:
- `dry` — computes, persists nothing. Preview only.
- `test` — persists draft invoices flagged `test_run` (numbered
  `TEST-…`); does **not** advance `next_bill_date`. Safe to repeat.
- `real` — persists real draft invoices and advances the cycle.

**List** (`/backend/billing/runs`) — every run with status
(running / completed / partial failure / failed), mode badges, summary
stats (accounts, drafts, failed…).

**Detail** (`/backend/billing/runs/[id]`) — header with status badges,
a field grid, the summary tiles, and a **per-account outcomes** table.
If any account failed, **Retry failed accounts** spawns a new run
scoped to just those accounts.

## 7. Billing Invoices

Only invoices the billing engine emitted are listed here (filtered on
`metadata.bill_run_id`) — plain sales invoices are not shown.

**List** (`/backend/billing/invoices`) — Number (with a `TEST` tag for
test-run invoices), Status, Period, Total, Outstanding, Issued. Filter
by status and test/real.

**Detail** (`/backend/billing/invoices/[id]`)
- Header: status badge, invoice number, period / Bill Run / account.
- Totals tiles + the invoice **Lines** table.
- While **draft**: add a line, edit a line, remove a line — each edit
  is recorded in the draft-edit audit log and totals recompute.
- **Post invoice** (draft, non-test) → moves it to `posted`.
- **Wipe test invoices for this run** (test invoices) → hard-deletes
  every test invoice from that Bill Run.

---

## 8. End-to-end smoke test (5 minutes)

1. Seed: `node packages/billing/scripts/seed-demo.mjs`.
2. Open **Billing Accounts** — 5 accounts, columns populated.
3. Open **Netia Biznes** → detail loads with the edit form filled.
4. Open **Billing Items** — 10 items; filter by type `usage`.
5. Open **Bill Runs** — one `completed` run; open it → 3 successful
   outcomes, each linked to a draft invoice.
6. Open **Billing Invoices** — 3 `TEST-…` draft invoices. Open one →
   lines visible; add a line and watch the totals recompute.
7. Trigger a fresh run (curl above) and confirm it appears in the list.

---

## 9. Automated coverage

Playwright integration tests live in
`packages/billing/src/modules/billing/__integration__/`
(`TC-BILL-001..003` — account CRUD, item + bulk create, admin UI).

```bash
npx playwright test --config .ai/qa/tests/playwright.config.ts \
  packages/billing/src/modules/billing/__integration__
```

Unit tests (engine, period math, validators, commands):

```bash
yarn test
```
