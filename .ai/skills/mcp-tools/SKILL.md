---
name: mcp-tools
description: Every new or changed API route ships with its MCP / AI tool in the same change. Load this whenever you add or change an API route in any module (`@dainamite/cpq`, `@dainamite/billing`, `@dainamite/cpq-billing-connector`, `src/modules/*`), or when asked to "add an AI tool", "expose this to agents", "make it MCP ready". Covers the typed `openApi` doc, API-backed tools, write safety, agent allowlists, tests and docs.
---

# MCP tools: API and AI tool ship together

**Rule:** a route is not done until agents can use it. When you add or change
an API route, the same PR also adds or updates its AI tool. The Open Mercato
`ai_assistant` module exposes these tools in the in-app AI chat and over MCP
(`yarn mercato ai_assistant mcp:serve-http`), so one tool serves both.

Skip the tool only when the route is deliberately not for agents (internal
plumbing, file download, webhook receiver). Say so in the PR description.

Background: in November 2026 the three packages were made MCP-ready in one
catch-up (PR #110). 35 CPQ routes had no usable `openApi`, so agents could not
see them. This skill exists so that debt does not build up again.

## Checklist per route

- [ ] **Typed `openApi`** on the route: `export const openApi: OpenApiRouteDoc = { tag, summary, methods: { GET: {...} } }`.
      Never the path-keyed form (`{ '/api/...': { get } }`): the generator ignores it, and so does the MCP `search` tool.
      Request bodies and query params come from the Zod validators the handler really parses. Errors list only statuses the handler returns.
      CPQ guards this with `__tests__/openapi-coverage.test.ts`.
- [ ] **API-backed tool** in `<module>/ai-tools/<area>-pack.ts`, aggregated by `<module>/ai-tools.ts` (`export const aiTools`).
      Wrap the route in-process (`defineApiBackedAiTool` / `createAiApiOperationRunner`), so the route's RBAC, tenant scoping and validation apply. No direct ORM in tools.
- [ ] **`requiredFeatures` = the route's `requireFeatures`** (plus the view feature of any route the tool reads for a preview). The runner checks route coverage at call time.
- [ ] **Input**: Zod schema, `.describe()` on every field, list limits max 100, writes `.strict()`.
      Description says what the tool returns and when to use it: agents choose tools by it.
- [ ] **Writes**:
      - `isMutation: true` and `isDestructive: true` (otherwise a tenant on `destructive-confirm-required` runs it without a card);
      - `loadBeforeRecord` with a readable `before` / `after` for the approval card;
      - the handler refuses unless `ctx.approvedPendingActionId` is set. The MCP HTTP server runs tools directly, with no approval step, so without this guard an MCP client could write.
- [ ] **Agent**: add the tool name to the module agent's `allowedTools` (`<module>/ai-agents.ts`). Cross-package additions go through `aiAgentExtensions` in the dependent package, never the reverse.
- [ ] **Tests** under `<module>/__tests__/ai-tools/`:
      - schema;
      - the built operation (method, path, query, body);
      - response mapping;
      - `requiredFeatures` match the route metadata;
      - writes refuse without `approvedPendingActionId` and run with it;
      - every module tool in `allowedTools` exists.
- [ ] **Docs**: tool table in `manuals/<module>-ai-agent.md`; changeset.
- [ ] **`yarn generate`** after adding tools or agents. For `@dainamite/*` packages the generator reads the built `dist`, so build the package first in local dev.

## Reference implementations

| What | Where |
|---|---|
| Typed `openApi` + helpers | `packages/cpq/src/modules/cpq/api/orders/route.ts`, `api/_helpers/quoteRouteOpenApi.ts` |
| Tool wrapper with the write guard | `packages/cpq/src/modules/cpq/ai-tools/_shared.ts` (`defineCpqApiTool`) |
| Read packs | `packages/cpq/src/modules/cpq/ai-tools/*-pack.ts`, `packages/billing/src/modules/billing/ai-tools/*-pack.ts` |
| Write tools with approval card | `packages/cpq/src/modules/cpq/ai-tools/quotes-pack.ts`, `packages/billing/src/modules/billing/ai-tools/mutation-pack.ts` |
| Agents | `packages/cpq/src/modules/cpq/ai-agents.ts`, `packages/billing/src/modules/billing/ai-agents.ts` |
| Cross-package extension, optional peer | `packages/cpq-billing-connector/src/modules/cpq_billing_connector/ai-tools.ts`, `ai-agents.ts` |
| Tests | `packages/cpq/src/modules/cpq/__tests__/ai-tools/`, `packages/billing/src/modules/billing/__tests__/ai-tools/` |
| Framework contract | `node_modules/@open-mercato/ai-assistant/AGENTS.md` ("How to Add an AI Tool Pack", "How to Add a New AI Agent") |

## Gotchas learned the hard way

- **Agent policy:** agents are `readOnly: false` + `mutationPolicy: 'confirm-required'`. Tenant overrides can only make a policy stricter, so a `read-only` agent can never be unlocked per tenant.
- **Read-modify-write tools:**
  - send back every field the route would otherwise clear. Example: `cpq.update_quote_line` resends `usageEstimates`.
  - drop derived fields the server must recompute. Example: a stored `endDate` when the term changes.
- **Date columns:** `type: 'date'` columns are `YYYY-MM-DD` strings at runtime. Use `lib/dateColumns.ts` (`dateColumnToIso`, `toDateColumn`).
- **MCP API keys without an organization:** CPQ routes answer 400 to these. Create keys for external MCP clients in the UI with an organization.
- **Live check:** before merging a non-trivial tool, run it against a seeded local database. Unit tests mock the runner and cannot see route-manifest or hydration problems.
