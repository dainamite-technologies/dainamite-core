# Lessons Learned

Non-obvious, verified lessons from working on this repo: framework behaviour,
pitfalls, root causes. Read the section for your area before you start; add a
lesson when you learn something the code and docs do not already say. How to
write and maintain entries: [`skills/lessons/SKILL.md`](skills/lessons/SKILL.md).

Entry format (newest first within a section):

```
- **<one-line lesson>** (YYYY-MM-DD, <PR / commit / file>)
  <why it matters / what to do instead, 1-3 lines>
```

## Open Mercato framework

- **`DataTable` ignores a column's `cell` when its id / `accessorKey` ends in `_at`.** (2026-11-18, #129)
  It renders the value with `formatDisplayDateTime` in the app locale (`useLocale()`). Format every other date with `formatDisplayDate` / `formatDisplayDateTime` and the same locale (billing: `lib/displayDate.ts`), never `toLocaleString()`, or one screen mixes formats.

- **The MCP HTTP server runs tools without the approval gate.** (2026-11-16, #110)
  `ai_assistant` `lib/http-server.ts` calls a tool right after the feature check. Every write tool must refuse unless `ctx.approvedPendingActionId` is set; only the pending-action executor sets it.
- **Agent mutation-policy overrides can only restrict.** (2026-11-16, #110)
  `resolveEffectiveMutationPolicy` takes the stricter value, so a `readOnly: true` / `read-only` agent can never be unlocked per tenant. Ship write-capable agents as `readOnly: false` + `confirm-required`.
- **`defineApiBackedAiTool` drops `isDestructive`.** (2026-11-16, #110)
  Set it on the returned definition (see `cpq/ai-tools/_shared.ts`). Flag every write destructive, otherwise `destructive-confirm-required` runs it without a card.
- **The MCP `search` tool only sees typed `openApi` docs with `methods`.** (2026-11-16, #110)
  The path-keyed form `{ '/api/...': { get } }` is ignored by the generator. Use `OpenApiRouteDoc`.
- **Undo interceptors get `log.commandPayload` as `undoContext.input`, not the original input.** (2026-11-16, #115)
  Read ids from `logEntry.resourceId`. `action_logs.command_id` is encrypted at rest: query by `resource_kind` / `resource_id`.
- **`sales.quotes.delete` hard-deletes the quote graph in 0.9, and its undo emits no domain event.** (2026-11-16, #115)
  React with a command interceptor (`commands/interceptors.ts`, `afterExecute` / `afterUndo`), not a subscriber.
- **The in-app chat sends the model only the text of earlier messages.** (2026-11-25)
  `useAiChat` posts `{ role, content, uiParts }` and `ensureUiMessageShape` keeps only `content`, so tool results and approval-card outcomes vanish between turns. A prompt rule like "every price must come from a tool result in this conversation" then makes the agent call its own earlier answers unverified and redo writes (a second `create_quote`, refused as a duplicate). Tell the agent its history is text only and to re-read saved records (`cpq.list_quotes` newest first, `cpq.get_quote`) when the operator continues (see `TURN_MEMORY` in `cpq/ai-agents.ts`).
- **Two approval cards for the same record: the second can never be confirmed, and the chat hides why.** (2026-11-25)
  Each pending action stores the record version of its preview; confirm refuses a changed record with 412 `stale_version`. Cards proposed in the same turn share one version, so confirming the first makes the second stale. The chat UI swallows the 412 and re-renders the card, so Confirm looks dead. Write-capable agent prompts must say "one write at a time" (see `ONE_WRITE_AT_A_TIME` in `cpq/ai-agents.ts`). Diagnose with `select tool_name,status,record_version from ai_pending_actions order by created_at desc`.
- **The `ai_assistant test-tools` runner works as superadmin and can show false scope errors.** (2026-11-16)
  "Customer not found" or "Organization context is required" there is not proof of bad data. Re-check as a normal user with the API runner.

## MikroORM / Zod

- **`type: 'date'` columns hydrate as `YYYY-MM-DD` strings, and `em.assign` rejects a `Date`.** (2026-11-16, #111, #116)
  Type such props as `string | null`; read with `dateColumnToIso`, write with `toDateColumn` (`cpq/lib/dateColumns.ts`). Unit tests with mocked EMs do not catch this; a live run does.
- **Zod `.partial()` keeps `.default()` wrappers.** (2026-11-16, #111)
  An update schema built as `createSchema.partial()` fills in defaults and silently overwrites stored values. Use `partialWithoutDefaults()` (`cpq/data/validators.ts`).

## CPQ

- **`replace_target` updates a changed step in place and makes the actor its author, so its undo must restore `createdByUserId` from the snapshot.** (2026-11-27, `services/priceAdjustments/targetPriceService.ts`)
  `adjustmentService.values()` carries no author, and the per-row undo never needed one. Restoring only `values()` leaves the new author on the old price, and the next undo's snapshot check answers 409. Match overlap errors by membership in tests: `loadQuoteAdjustments` orders by uuid, so "the first overlapping row" is random.
- **Adding a column to `cpq_quote_price_adjustments` means adding it to the undo `snapshotSchema` too.** (2026-11-27, price phases)
  `commands/price-adjustments.ts` parses undo snapshots with a non-strict `z.object`, which silently drops unknown keys: undo then restores the row without the new field (a phase came back permanent), and `snapshotKey` no longer matches `adjustmentSnapshot(row)`, so undo answers 409. Keep `adjustmentInput`, `values()`, `loadQuoteAdjustments`, `cloneQuoteAdjustments` and the snapshot schema in step.
- **Never `$ilike` a uuid column: Postgres rejects it (`operator does not exist: uuid ~~* unknown`) and the route answers 500.** (2026-11-23, `api/quotes/route.ts`)
  `GET /api/cpq/quotes?search=` did this on `quoteId` / `customerId`; the backoffice list filters client-side, so only API and AI callers saw it. Match uuids exactly; match human text (quote number) on the entity that owns it, with `buildIlikeTerm` from `@open-mercato/shared/lib/db/buildIlikeTerm`.
- **A unique constraint on a soft-deleted table blocks re-creating a removed row.** (2026-11-17, #122)
  The service check filters `deletedAt: null` and passes, then the full constraint fails the insert (500). Use a partial unique index (`@Index({ expression: '… WHERE "deleted_at" IS NULL' })`) and update the module snapshot to the `expression` form.
- **A quote line's `isConfigured` is decided only by `recalculateInternal`.** (2026-11-17, #125)
  Add and update both end in a saved recalculation that overwrites the value, so logic placed in those paths has no effect. Change `lib/lineCompleteness.ts`.
- **`.default()` on a create schema hides "the caller omitted it".** (2026-11-17, #122)
  `offeringType: z.enum(...).default('simple')` made every bundle create from the UI fail V-OFF-7. Leave a field without a default when the server should derive it.
- **During `mercato init`, persistent subscribers (e.g. the CPQ → billing connector) do not run inline.** (2026-11-18, `src/modules/demo_acme/seeds/cpq.ts`)
  Single-delivery queues them for the worker, so a seed that activates an order gets no billing account yet. Capture the payload with `registerGlobalEventTap` (`@open-mercato/events/bus`) and call the idempotent handler inline.
- **`demo_tenants` replays every module's `seedExamples` into each demo tenant (GIX, Puffin).** (2026-11-18, `src/modules/demo_acme/setup.ts`)
  A seed meant only for the primary ACME tenant must skip itself there; `demo_acme` skips organizations whose name matches a registered use case's `tenant.organizationName`.

- **Every CPQ route needs an organization context.** (2026-11-16, #116)
  `cpqContextError(ctx)` answers 401 / 400. Route test mocks of `../context` must keep the real one: `cpqContextError: jest.requireActual('../context').cpqContextError`.
- **A terminal CPQ quote (accepted / rejected / cancelled) may already back an order.** (2026-11-16, #115)
  Never soft-delete its configuration: order activation would treat an amend / cancel as a new sale and create a duplicate subscription.
- **Read-modify-write AI tools must resend fields the route would clear and drop fields the server derives.** (2026-11-16, #110)
  `update_quote_line` resends `usageEstimates` and drops a stored `endDate` when the term or start changes.

## Billing

- **Status-period credits work out which days `prorate=false` never charged from the item's current grid and `prorate` flag.** (2026-11-27, billing review F1)
  Changing `prorate`, or the account cycle day, after an item was billed can make a later pause credit or re-charge the wrong days. Billing refuses a billing-period change once the item is invoiced (`billing.item.billing_period_change_billed`), but not a `prorate` change. Do the same for `prorate`, or keep a per-day charged ledger, before relying on late pauses on such items.
- **Prepaid statements bucket the ledger by `created_at`, but period-close charges are stamped at run time.** (2026-11-18, #138)
  A catch-up or future-dated run creates charges long after (or before) their bill date. Attribute charges by `metadata.bill_date`, never by `created_at`, when computing a balance at a bill date (`sumLedgerBefore` in `prepaidPeriodClose.ts`).
- **`billing.items.bulk_create` validates the whole batch with one Zod parse: one bad entry fails every item of the event.** (2026-11-27, connector C3)
  Billing caps phases at 12 per item and the monthly line period at 24 (annual at 5); CPQ allows more (merged multi-charge schedules, up to 120-month periods). The connector refuses such a charge before the bulk write (`mapCharge` in `lib/chargeMapper.ts`) instead of trimming it, so the subscription's other items still bill.

## Packaging and release

- **`yarn mercato db generate` writes no migration for `@dainamite/*` package modules here, even after the package is built.** (2026-11-23, #133)
  It reports only `@app` modules. Write the package migration by hand in the generator's style and update the module's `migrations/.snapshot-open-mercato.json` in the same PR.
- **In 0.x a minor bump of a peer leaves caret ranges, so changesets bumps every dependent major.** (2026-11-16, #106)
  Fixed with 1.0 releases plus `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`.
- **Any `package.json` dependency-meta change needs a `yarn.lock` refresh.** (2026-11-16, #112)
  PR CI does not run `yarn install --immutable`, the release workflow does, so a stale lockfile only fails after merge (YN0028).
- **The generator reads the built `dist` of `@dainamite/*` packages.** (2026-11-16, #110)
  Build the package before `yarn generate` locally, or new `ai-tools.ts` / interceptors are missing from the registry.

## Local environment and tooling

- **The root `yarn typecheck` can be OOM-killed on an ~11 GB box, taking the agent session down with it.** (2026-11-27, billing/CPQ flex run)
  Typecheck one package instead: `cd packages/<pkg> && NODE_OPTIONS=--max-old-space-size=2500 ../../node_modules/.bin/tsc --noEmit -p . --ignoreDeprecations 6.0`. In a fresh worktree run `yarn build:packages` first, or the connector tests fail on missing `@dainamite/billing` modules.
  **But a package typecheck skips tests:** `packages/*/tsconfig.json` excludes `__tests__/` and `__integration__/`, and CI runs the root `yarn typecheck`, which includes them. A green `yarn workspace @dainamite/<pkg> typecheck` still let PR #153 fail CI on test fixtures (2026-11-27). Before pushing, run the root `yarn typecheck` on a machine with room for it (fine on 32 GB with CI's `NODE_OPTIONS=--max-old-space-size=4096`).
- **The backend header's organization switcher is a `combobox` that can render after the page content.** (2026-11-23, TC-CPQ-ARC-005)
  A page-wide `[role="combobox"]` `.first()` re-resolves on each use and can hit the switcher instead of the page's picker. Scope it: `page.getByRole('main').locator(...)`. Also clean up in `afterEach`: a `finally` in a timed-out test never completes, so fixtures pile up.
- **A Playwright click on a server-rendered DataTable row can land before hydration and do nothing.** (2026-11-23, TC-CPQ-006)
  The row is visible before React attaches the handler, so a single click plus `waitForURL` flakes. Wrap click and `waitForURL` (short timeout) in `expect(...).toPass()`.
- **`yarn dev` serves `@dainamite/*` from `dist`, so rebuild all packages together with `yarn build:packages`.** (2026-11-23, #141)
  A source change is invisible until rebuilt. Rebuilding one package against another's stale `dist` can fail the page build (connector importing a billing export that no longer exists).
- **Next refuses a second `next dev` in the same checkout ("Another next dev server is already running").** (2026-11-23)
  A smoke server on another `PORT` and `DATABASE_URL` needs the running `yarn dev` stopped first (or a separate checkout). Agent chat can be driven without the UI: `POST /api/ai_assistant/ai/chat?agent=<id>` from the logged-in page, then `POST /api/ai_assistant/ai/actions/<pendingActionId>/confirm`.
- **`localhost:5432` is an SSH tunnel to a remote database, not the local Docker Postgres.** (2026-11-16)
  For smoke tests run a separate container (e.g. `:5433`) and pass `DATABASE_URL` to `yarn initialize` / `yarn dev`; the shell env wins over `.env`.
- **The shell's Anthropic base URL points at the local Caveman gateway (`127.0.0.1:8787`).** (2026-11-16)
  The app appends `/messages`, the gateway rejects it and agents return an empty response. Run `ANTHROPIC_BASE_URL=https://api.anthropic.com/v1 yarn dev`.
- **A smoke-test DB still shares the file queue (`QUEUE_BASE_DIR=./.mercato/queue`) with a running `yarn dev`.** (2026-11-18)
  Jobs queued by `yarn initialize` on a throwaway DB can be drained by the dev worker against the dev DB. Stop `yarn dev` or set a separate `QUEUE_BASE_DIR` for the test run.
- **MCP API keys from `mcp:ensure-api-key` have no organization.** (2026-11-16, #116)
  CPQ answers 400 to them. Keys for external MCP clients are created in the UI with an organization.
- **`main` requires resolved conversations.** (2026-11-16)
  Inline review-bot threads block the merge (BLOCKED) even with green checks. Reply with what was fixed, then resolve the thread.
- **Browser automation typing into the AI playground editor mangles text.** (2026-11-16)
  Set the textarea value with the native setter plus an `input` event, then click send through JS.
