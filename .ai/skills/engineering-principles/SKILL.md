---
name: engineering-principles
description: Four non-negotiable engineering principles for every change in this repo — generic components, decomposed classes, scale-first design (100k+ records), extracted utilities. Load this BEFORE writing any feature, refactor, or new file in `src/modules/` or `packages/*/src/modules/`. Use when implementing a new component/page/service/list view/bulk operation/report/CLI command/worker, when reviewing your own diff, when a file you're touching is over 300 lines, when you see a copy-pasted block, when you're about to write a per-row fetch or unbounded query, or when the user says "make it generic / DRY this / will this scale / refactor this".
---

# Dainamite Engineering Principles

Every change in this repo is held to four standards. They are non-negotiable.
If a request would violate one, **flag it before implementing** — don't ship the
violation and refactor later.

These principles apply to:

- `src/modules/<id>/` (in-tree modules)
- `packages/<package>/src/modules/<id>/` (published modules — CPQ, future
  `@dainamite/*`)
- Workers, scheduled jobs, CLI commands, ARC/billing flows
- React components, services, hooks, validators, indexers

They are in addition to (not in place of) the CPQ Definition of Done and the
Open Mercato framework contract.

---

## 1. Make repeating UI/logic generic

If you find yourself writing the same structure twice — or you can see two
similar shapes already in the repo — **extract it before writing the second
copy.** "Three similar lines is fine" (per AGENTS.md `Doing tasks`) ≠ "three
similar pages is fine."

### Concrete signals that demand extraction

- 7 list views with the same DataTable + FilterBar wiring → one
  `CpqListView` + `useCpqListData` (the canonical example,
  [packages/cpq/src/modules/cpq/components/CpqListView.tsx](../../../packages/cpq/src/modules/cpq/components/CpqListView.tsx)).
- 3 detail pages each loading `entity + related + audit` → one
  detail layout with slots.
- 2 services both doing `findOne → assign → flush` with the same
  scope guard → a shared command helper.
- 5 API routes all returning `{ items, total, page, pageSize, totalPages }`
  with the same paging math → a `respondPaginated()` helper.
- The same Zod schema fragment in 3+ validators → hoist to a `shared.ts`
  validator file in the module.

### What "generic" looks like

- **Generics, not `any`.** `CpqListView<T extends { id: string }>`, not
  `CpqListView` with `any[]` rows.
- **Slot props, not assumptions.** `toolbarContent`, `footerContent`,
  `rowActions`, `bulkActions` — accept ReactNode, don't bake in module
  semantics.
- **Behavior via callbacks, data via props.** A list-view component takes
  `buildFilterParams(values, params)` from the parent; it doesn't hardcode
  which fields exist.
- **One responsibility per export.** `useCpqListData` owns paged state and
  fetching; `CpqListView` owns the visual contract. They're separate so
  pages with custom toolbars (Offerings bulk-charge form, Quotes customer
  picker) can use the hook with their own DataTable composition.

### What "generic" does NOT mean

- Don't pre-build a god-component with 30 optional props "in case we need
  them." Generic = covers what 2+ existing call sites need, with named slots
  for the rest. Add props when a real second consumer arrives — not before.
- Don't generic-ify something with one call site. Wait for the second one.

### Migration pattern (when retrofitting)

1. Write the new generic component + hook.
2. Pick the simplest list/page and migrate it. Verify it renders.
3. Migrate the rest one at a time. Each migration is a separate commit if
   you discover the API needs to flex.
4. Delete the old code.

---

## 2. Decompose — no giga-classes, no giga-files

A file is a unit of comprehension. If a reviewer has to scroll for context,
the boundary is wrong. Apply the same discipline to React components,
service classes, and route handlers.

### Hard ceilings

- **React page/component file:** target ~300 lines, hard ceiling 500.
  Above that, decompose. Examples of decomposition:
  - Inline forms → sibling file (`PriceRuleForm.tsx`).
  - Modal/picker → sibling file (`CustomerPickerModal` extracted from
    Quotes page).
  - Tab content → one file per tab (`SubscriptionsTable.tsx`,
    `AssetsTable.tsx`).
  - Shared status badge / currency formatter → sibling `shared.tsx`.
- **Service class:** if it has more than ~8 public methods or more than
  ~600 lines, split by aggregate. `DefaultCpqInventoryService` already has
  separate concern areas (Subscriptions / Subscription items / Assets) —
  if any single area grows past that ceiling, split it out.
- **Route handler file (`route.ts`):** keep request parsing, RBAC checks,
  and response shaping in `route.ts`; push every non-trivial branch into
  a service method or helper. Long inline filter-building blocks → a
  `buildXFilters(url)` helper.

### Decomposition patterns we use

| Pattern | When to apply | Example |
|---|---|---|
| Sibling component file | A JSX block > 80 lines that has its own state | `quotes/page.tsx` → `CustomerPickerModal` extracted |
| Sibling helper file | A function used in 2+ files in the same module | `inventory/shared.tsx` (`StatusBadge`, `formatCurrency`) |
| Form module | A multi-field create/edit form | `price-rules/PriceRuleForm.tsx` exports both the component and form serialization helpers |
| Tab-per-file | A page with > 1 tab where each owns its own data | `inventory/page.tsx` is the tab switcher; each tab is its own file |
| Subscope service | A growing service hitting > 600 lines | Split by aggregate root, not by verb |

### Smells that should trigger a split

- React component file > 500 lines.
- A function > 80 lines.
- A `useEffect` that does 3+ unrelated things.
- A `useMemo` over a 30-line transformation pipeline.
- A service method with > 4 levels of indentation.
- A file that mixes "data plumbing" and "presentation."

---

## 3. Design for 100k+ records — scale is a feature, not a future patch

This system is meant for hundreds of thousands of records per tenant.
**Every query, every list, every batch operation, every export, every
workflow MUST be designed for that scale from the first commit.** Never
"works on 50 records, we'll optimize later."

### The hard rules (this section is repeated from
[`feedback_scale_first.md`](../../../../../Users/Kamil/.claude/projects/c--RepozytoriaPrywatne-dainamite-core/memory/feedback_scale_first.md)
on purpose — it's load-bearing)

#### No N+1 queries

If you need related data for `N` rows, fetch it in **one** batched query
(`{ id: { $in: ids } }`) and group client-side. Count the database
round-trips in your head before shipping. The Offerings list batches
charges; the Price Rules list batches offering names — follow that
pattern.

```ts
// WRONG
const items = await em.find(Offering, scope, { limit: 50 })
const detailed = await Promise.all(
  items.map((o) => em.find(Charge, { offeringId: o.id }))  // 50 round-trips
)

// RIGHT
const items = await em.find(Offering, scope, { limit: 50 })
const ids = items.map((o) => o.id)
const charges = await em.find(Charge, { offeringId: { $in: ids }, ...scope })
const byOffering = new Map<string, Charge[]>()
for (const c of charges) {
  const list = byOffering.get(c.offeringId) ?? []
  list.push(c); byOffering.set(c.offeringId, list)
}
```

#### Pagination by default

- Every list endpoint paginates. `pageSize` capped at 100.
- Never `findAll`. Never `find(...)` without a `limit` outside of admin
  scripts.
- The CRUD response shape is `{ items, total, page, pageSize, totalPages }`.
  Stick to it.

#### Server-side filter / sort / search

- Filtering, sorting, full-text search go to SQL. Use `$ilike` for
  case-insensitive search, `$in` for set membership, indexed columns
  for ordering. **Never** load-then-filter in memory.
- Whitelist sort fields server-side (security + index hygiene).

#### Indexes on every filterable column

- When you add a filter (or a column that will be searched/sorted) check
  that the entity has a matching composite index — usually
  `(organization_id, tenant_id, <column>)`.
- If the index is missing, add it to `data/entities.ts` and run
  `yarn mercato db generate`.

#### Streaming / batching for bulk operations

- Bulk delete, bulk update, exports, BillRun, ARC mass renewals — process
  in chunks (500–1000 rows). Don't materialize the entire result set.
- For exports of large datasets prefer cursor pagination or DB `COPY`
  over OFFSET-based paging.

#### Workers, not request lifecycle

- Anything that touches more than a few hundred records lives in a
  worker, not in a request handler. BillRun, ARC mass amend, large
  imports, search reindex — all queue-driven.

#### UI virtualization

- DataTable's `virtualized` prop when row count can exceed a few hundred
  in a single page (rare — we paginate; but `virtualized` is mandatory
  when we don't paginate, e.g. a frozen 5000-row report panel).

#### Detail data in list responses

- If a list view needs related data per row (status names, joined
  metrics, charge badges), return it from the **list endpoint** with a
  single batched join — don't fire per-row detail requests from the
  client.

### Review checklist before shipping

- [ ] How many DB round-trips does my endpoint make for a 50-row page?
      (Answer should be a small constant — typically 1 + N batch fetches
      where N is the number of related aggregates.)
- [ ] If a tenant has 200k of my entity, does my endpoint still finish
      in under ~500ms?
- [ ] Are bulk operations chunked, or do they `await Promise.all(...)`
      over an unbounded array?
- [ ] Do my filtered columns have an index?
- [ ] Does my UI block on loading all rows, or does it paginate?

If you can't answer "yes" to all of these, the design isn't done.

---

## 4. Extract utils — write the helper once, call it everywhere

If a non-trivial expression appears in two places, give it a name and a
home. The point isn't pure DRY (some duplication is fine). The point is:

- **A named util is the single chokepoint for future optimization.**
  If `getBaseCurrencyCode()` is inlined in 15 places, you can't add
  caching without 15 edits. If it's one helper, you cache once.
- **A named util is the single chokepoint for behavior change.** When
  pricing rules need to honor a new attribute, you change one
  `evaluateCondition()`, not 7 ad-hoc `if (cond.attribute === ...)`
  blocks.
- **A named util documents intent.** `withAtomicFlush(em, phases)`
  reads better than 30 lines of inline phase orchestration.

### Where helpers belong

| Scope | Location |
|---|---|
| Cross-module infrastructure (boolean parsing, scoped payloads, encryption helpers, command flush) | `@open-mercato/shared/lib/<area>/` — read [`node_modules/@open-mercato/shared/AGENTS.md`](../../../node_modules/@open-mercato/shared/AGENTS.md) FIRST before inventing a new helper |
| Single-module helpers used in multiple files | `src/modules/<id>/lib/` or a sibling helpers file |
| Component composition helpers (form serialization, filter-param builders) | Colocated with the component (e.g. `priceRuleFormToPayload` lives in `PriceRuleForm.tsx`) |
| Service-internal utilities | Private static methods on the service, OR a `services/<aggregate>/_helpers.ts` |
| Test fixtures / EM mocks | Module-local `__tests__/_helpers.ts` (per `unit-tests/SKILL.md`) |

### Smells that demand extraction

- The same `Promise.all(items.map(async (i) => ...))` pattern in three
  places → an iterator/streamer helper that batches and respects
  concurrency.
- Repeated `if (val == null) return ...; if (typeof val === 'string') ...`
  ad-hoc normalization → a `normalizeXValue()` helper.
- Multiple endpoints building the same set of where-clause filters → a
  `buildXFilters(url, scope)` helper that returns the where clause.
- Multiple components serializing the same form shape to API payload →
  one `formToPayload()` helper.
- Status-color maps duplicated across components → one
  `STATUS_COLORS` constant + `<StatusBadge>` component.

### Before adding a new util, check

1. **Is there already one in `@open-mercato/shared/lib/`?** Read the
   shared package's `AGENTS.md` — it ships table-stakes utilities for
   boolean parsing, encryption-aware queries, feature matching, query
   extensions, command flush, and more. **Don't reinvent.**
2. Is there already one in `@open-mercato/core/src/modules/<module>/`?
   Cross-module helpers often live in the customers/sales/catalog
   modules.
3. Is there a CPQ-internal one in `src/modules/cpq/lib/`?

If steps 1–3 all return no, only then write a new util. Place it in the
narrowest scope that fits (sibling file → module `lib/` → shared
package).

### Naming + signature discipline

- **Verbs for actions, nouns for values.** `buildOfferingFilters()`,
  `priceRuleFormToPayload()`, `formatCurrency()`.
- **Narrow types.** No `any`. Use `z.infer` for schema-derived types.
  Generics over union types for reusable shapes.
- **No partial signatures.** If three callers pass slightly different
  shapes, redesign the helper to accept one normalized input, not three
  overloads.
- **Pure where possible.** Side-effecting helpers must say so in the
  name (`emit*`, `persist*`, `flush*`).

---

## When this skill fires

Load this skill BEFORE you start writing for any of:

- New page, list view, detail view, form, modal, picker, tab switcher.
- New service method that does more than CRUD.
- New API route — especially anything paginated, searchable, filterable.
- New worker / scheduled job / CLI command.
- Refactor that grew out of a "make it generic / DRY this / split this
  file / will this scale" request.
- Any time you're about to copy-paste a block of more than ~10 lines.
- Any time the file you're editing is over 300 lines.
- Bulk operations (delete selected, mass-update, export N rows).
- Reports, dashboards, anything that summarises many records.

And re-load it when reviewing your own diff before opening a PR.

---

## Quick cheat sheet

| Symptom | Fix |
|---|---|
| Two pages with similar table + filter wiring | Extract a generic component + hook |
| A file > 500 lines | Decompose by feature (form / table / modal / shared utils) |
| A service > 600 lines | Split by aggregate root |
| Per-row fetch in a list view | Batch with `$in: ids` on the server, return enriched rows |
| List endpoint without pagination | Add `page` / `pageSize` (cap 100) + return `total/totalPages` |
| Filter without an index | Add composite `(org, tenant, <col>)` index, run `db generate` |
| `Promise.all(items.map(...))` over unbounded data | Chunk in batches of 500–1000 |
| Heavy work in request handler | Move to a worker (queue) |
| Repeated inline normalization | One named helper |
| `cf_*` or duplicate normalization across modules | Use `@open-mercato/shared/lib/custom-fields` |
| Repeated mutate-then-query on the same EM | `withAtomicFlush(em, phases)` from `@open-mercato/shared/lib/commands/flush` |

If something on this page conflicts with the framework's own AGENTS.md
guides, the framework wins. This skill complements them with the
dainamite-core engineering bar.
