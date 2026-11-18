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
- **The `ai_assistant test-tools` runner works as superadmin and can show false scope errors.** (2026-11-16)
  "Customer not found" or "Organization context is required" there is not proof of bad data. Re-check as a normal user with the API runner.

## MikroORM / Zod

- **`type: 'date'` columns hydrate as `YYYY-MM-DD` strings, and `em.assign` rejects a `Date`.** (2026-11-16, #111, #116)
  Type such props as `string | null`; read with `dateColumnToIso`, write with `toDateColumn` (`cpq/lib/dateColumns.ts`). Unit tests with mocked EMs do not catch this; a live run does.
- **Zod `.partial()` keeps `.default()` wrappers.** (2026-11-16, #111)
  An update schema built as `createSchema.partial()` fills in defaults and silently overwrites stored values. Use `partialWithoutDefaults()` (`cpq/data/validators.ts`).

## CPQ

- **A unique constraint on a soft-deleted table blocks re-creating a removed row.** (2026-11-17, #122)
  The service check filters `deletedAt: null` and passes, then the full constraint fails the insert (500). Use a partial unique index (`@Index({ expression: '… WHERE "deleted_at" IS NULL' })`) and update the module snapshot to the `expression` form.
- **A quote line's `isConfigured` is decided only by `recalculateInternal`.** (2026-11-17, #125)
  Add and update both end in a saved recalculation that overwrites the value, so logic placed in those paths has no effect. Change `lib/lineCompleteness.ts`.
- **`.default()` on a create schema hides "the caller omitted it".** (2026-11-17, #122)
  `offeringType: z.enum(...).default('simple')` made every bundle create from the UI fail V-OFF-7. Leave a field without a default when the server should derive it.

- **Every CPQ route needs an organization context.** (2026-11-16, #116)
  `cpqContextError(ctx)` answers 401 / 400. Route test mocks of `../context` must keep the real one: `cpqContextError: jest.requireActual('../context').cpqContextError`.
- **A terminal CPQ quote (accepted / rejected / cancelled) may already back an order.** (2026-11-16, #115)
  Never soft-delete its configuration: order activation would treat an amend / cancel as a new sale and create a duplicate subscription.
- **Read-modify-write AI tools must resend fields the route would clear and drop fields the server derives.** (2026-11-16, #110)
  `update_quote_line` resends `usageEstimates` and drops a stored `endDate` when the term or start changes.

## Packaging and release

- **In 0.x a minor bump of a peer leaves caret ranges, so changesets bumps every dependent major.** (2026-11-16, #106)
  Fixed with 1.0 releases plus `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`.
- **Any `package.json` dependency-meta change needs a `yarn.lock` refresh.** (2026-11-16, #112)
  PR CI does not run `yarn install --immutable`, the release workflow does, so a stale lockfile only fails after merge (YN0028).
- **The generator reads the built `dist` of `@dainamite/*` packages.** (2026-11-16, #110)
  Build the package before `yarn generate` locally, or new `ai-tools.ts` / interceptors are missing from the registry.

## Local environment and tooling

- **`localhost:5432` is an SSH tunnel to a remote database, not the local Docker Postgres.** (2026-11-16)
  For smoke tests run a separate container (e.g. `:5433`) and pass `DATABASE_URL` to `yarn initialize` / `yarn dev`; the shell env wins over `.env`.
- **The shell's Anthropic base URL points at the local Caveman gateway (`127.0.0.1:8787`).** (2026-11-16)
  The app appends `/messages`, the gateway rejects it and agents return an empty response. Run `ANTHROPIC_BASE_URL=https://api.anthropic.com/v1 yarn dev`.
- **MCP API keys from `mcp:ensure-api-key` have no organization.** (2026-11-16, #116)
  CPQ answers 400 to them. Keys for external MCP clients are created in the UI with an organization.
- **`main` requires resolved conversations.** (2026-11-16)
  Inline review-bot threads block the merge (BLOCKED) even with green checks. Reply with what was fixed, then resolve the thread.
- **Browser automation typing into the AI playground editor mangles text.** (2026-11-16)
  Set the textarea value with the native setter plus an `input` event, then click send through JS.
