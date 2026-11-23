# CPQ AI agent and tools

`@dainamite/cpq` plugs into the Open Mercato AI assistant (`@open-mercato/ai-assistant`). It ships:

- an AI tool pack (`packages/cpq/src/modules/cpq/ai-tools.ts`, 27 tools), and
- two agents (in `ai-agents.ts`): **CPQ Quoting Assistant** (`cpq.quoting_assistant`) for sales, and **CPQ Catalog Assistant** (`cpq.catalog_assistant`) for catalog admins (see "Catalog assistant").

The in-app AI chat and MCP clients (Claude Code, MCP Inspector, OpenCode) see the same tools, registered from the same `ai-tools.generated.ts`. MCP clients can use the read tools; the write tools only run from the in-app chat approval card (see "How writes are gated").

## What the agent can do

Operators can ask about CPQ in plain language, for example:

- "Which fibre offerings are active, and what charges do they have?"
- "What do I need to fill in to configure offering X?"
- "Price offering X with 1 Gbit bandwidth on a 36 month term, in EUR."
- "Can offerings X and Y be sold together?"
- "Show the latest quotes of customer Acme and explain the totals of the newest one."
- "Which subscriptions expire in the next 60 days?"
- "What does customer Acme have installed today?"
- "Create a draft quote for Acme and add offering X with this configuration." (approval card)

The agent knows the CPQ concepts: product specification (attributes, relationships, bundle slots), offering (sellable package with NRC / MRC / usage charges), configuration (run-time attribute values per line), pricing (pricing tables and tiers, then price rules: discounts, surcharges, overrides), the quote lifecycle (new, incomplete, ready, in_approval, pre_approved, approved, with_customer, accepted / rejected / cancelled) and the ARC quote types (new, amend, renew, cancel).

Rules in its prompt:

- It never states a price, total or discount that did not come from `cpq.calculate_price`, `cpq.get_quote` or `cpq.get_order`.
- It reads the configurable attributes before pricing or adding a line, and uses only the codes and values they return.
- It shows the currency next to every amount and never adds NRC to MRC.
- It asks before any write, and writes only through the approval card.
- It never converts quotes to orders, activates orders or changes inventory.

## Tools

Every tool calls an existing CPQ REST route in-process (the framework's AI API operation runner). So the tool needs the same permission as the route, sees only the caller's tenant and organization, and gets the route's validation and mutation guards. Tools never read the database directly. List tools return `{ items, total, page, pageSize, totalPages }` and take `page` and `pageSize` (max 100).

The runner refuses to call a route that does not export `openApi`. Every route listed below must keep its `openApi` export.

### Read tools

| Tool | Backing route | Permission | Returns |
|---|---|---|---|
| `cpq.list_offerings` | `GET /api/cpq/product-offerings` | `cpq.offerings.view` | Offerings with their charge definitions |
| `cpq.get_offering` | `GET /api/cpq/product-offerings?id=` | `cpq.offerings.view` | One offering, its specification summary, charges, bundle components |
| `cpq.get_bundle_tree` | `GET /api/cpq/bundle-tree` | `cpq.offerings.view` | Bundle component tree and its structural validation |
| `cpq.list_specifications` | `GET /api/cpq/product-specifications` | `cpq.specifications.view` | Product specifications |
| `cpq.get_specification` | `GET /api/cpq/product-specifications?id=` | `cpq.specifications.view` | Attributes with options and constraints, offerings, relationships, slots |
| `cpq.get_configurable_attributes` | `GET /api/cpq/quotes/attributes` | `cpq.quotes.view` | Run-time attributes of an offering with the options still allowed for the values chosen so far |
| `cpq.calculate_price` | `POST /api/cpq/quotes/price` | `cpq.quotes.view` | NRC / MRC totals, usage charges and per-charge breakdown with rule adjustments. Saves nothing. |
| `cpq.validate_configuration` | `POST /api/cpq/quotes/validate-relationships` | `cpq.quotes.view` | Requires / excludes / parent-child errors for a set of offerings. Saves nothing. |
| `cpq.list_price_rules` | `GET /api/cpq/price-rules` | `cpq.pricing.view` | Price rules with scope, value and filters |
| `cpq.list_quotes` | `GET /api/cpq/quotes` | `cpq.quotes.view` | Quotes with number, customer, status, type, version |
| `cpq.get_quote` | `GET /api/cpq/quotes/:quoteId` | `cpq.quotes.view` | Quote with lines, charges, pricing summary and validation result |
| `cpq.list_subscriptions` | `GET /api/cpq/inventory/subscriptions` | `cpq.inventory.view` | Customer subscriptions |
| `cpq.get_subscription` | `GET /api/cpq/inventory/subscriptions?id=` | `cpq.inventory.view` | One subscription with items and assets |
| `cpq.list_assets` | `GET /api/cpq/inventory/assets` | `cpq.inventory.view` | Customer assets |
| `cpq.get_asset` | `GET /api/cpq/inventory/assets?id=` | `cpq.inventory.view` | One asset |
| `cpq.get_customer_inventory` | `GET /api/cpq/inventory/customer/:customerId` | `cpq.inventory.view` | Whole installed base of one customer |
| `cpq.list_expiring_subscriptions` | `GET /api/cpq/inventory/subscriptions/expiring` | `cpq.inventory.view` | Subscriptions whose term ends within N days (default 30) |
| `cpq.get_subscription_change_log` | `GET /api/cpq/inventory/subscriptions/:id/change-log` | `cpq.arc.changelog.view` | Amend / renew / cancel history of a subscription |
| `cpq.list_orders` | `GET /api/cpq/orders` | `cpq.orders.view` | CPQ orders |
| `cpq.get_order` | `GET /api/cpq/orders/:orderId` | `cpq.orders.view` | One order with lines and pricing summary |

`cpq.calculate_price` and `cpq.validate_configuration` use POST routes but persist nothing, so they are read tools (MCP advertises them as read-only).

### Write tools

| Tool | Backing route | Permission | What it does |
|---|---|---|---|
| `cpq.create_quote` | `POST /api/cpq/quotes` | `cpq.quotes.manage` | Creates an empty draft quote of type "new" for a customer, optionally linked to a deal. |
| `cpq.add_quote_line` | `POST /api/cpq/quotes/:quoteId/items` | `cpq.quotes.manage` + `cpq.quotes.view` | Adds a configured offering as a new line. The server prices it and recalculates the quote. |
| `cpq.update_quote_line` | `PUT /api/cpq/quotes/:quoteId/items/:lineId` | `cpq.quotes.manage` + `cpq.quotes.view` | Changes configuration (merged over the current values), quantity or term of a line.  |
| `cpq.submit_quote_for_approval` | `POST /api/cpq/quotes/:quoteId/status` | `cpq.quotes.manage` + `cpq.quotes.view` | Moves a quote from new, incomplete or ready to `in_approval`. Project approval rules still apply. |

### Catalog write tools (catalog assistant only)

| Tool | Backing route | Permission | What it does |
|---|---|---|---|
| `cpq.create_offering` | `POST /api/cpq/product-offerings` | `cpq.offerings.manage` + `cpq.specifications.view` | Creates an offering on an existing specification. The type follows the specification; `isSellable` defaults to the specification's `defaultOfferingSellable`. |
| `cpq.add_bundle_component` | `POST /api/cpq/offering-components` | `cpq.offerings.manage` + `cpq.offerings.view` + `cpq.specifications.view` | Adds a child offering to a slot of a bundle offering, optionally as a default component. Bundle rules (V-COMP codes) apply. |
| `cpq.remove_bundle_component` | `DELETE /api/cpq/offering-components` | `cpq.offerings.manage` + `cpq.offerings.view` | Removes a component from a bundle. Refuses a component id that does not belong to the named bundle. Priced quotes keep their lines. |

The write tools that act on an existing quote also need `cpq.quotes.view`, because they read the quote through `GET /api/cpq/quotes/:quoteId` to build the preview card.

## How writes are gated

1. **Approval card.** The agent is write-capable with `mutationPolicy: 'confirm-required'` (same as the core customers and catalog agents). A write tool call never runs on its own: the runtime stores a pending action and shows a preview card (the new quote header, the new line, the line before and after, or the status change). The write runs only after the operator clicks **Confirm**. Pending actions expire after `AI_PENDING_ACTION_TTL_SECONDS` (default 15 minutes).
2. **Stale check.** On confirm the runtime reads the quote again. If anyone changed its status, revision or lines since the preview, the confirm is refused (412) and the agent has to propose the change again.
3. **Fail closed outside the chat.** Each write tool refuses to run unless the call comes from an approved pending action (`approvedPendingActionId`, set only by the framework's pending-action executor). The MCP server runs tools directly without an approval card, so a write call from an MCP client is refused with "This write needs approval in the in-app AI chat; it cannot run over MCP" and nothing is written.
4. **Permissions twice.** The tool's permissions are checked before the call, and the CPQ route checks them again. Route mutation guards (approval rules, ARC checks) run exactly as for a manual edit.
5. **Tenant lock.** A tenant that wants no AI writes sets the agent to `read-only` in `/backend/config/ai-assistant/agents`. The write tools are then removed before the model sees them. Overrides can only make the agent stricter, never looser.

Every CPQ write tool is flagged destructive, so it always goes through the approval card, also when a tenant sets the agent to `destructive-confirm-required`. A tenant that wants no AI writes sets the agent to `read-only`.

Not exposed as AI tools on purpose: converting a quote to an order, activating an order, ARC quote creation from a subscription, price adjustments, deleting quotes or lines, and any pricing table or inventory edit. Catalog edits are limited to the three catalog write tools above (no specifications, slots, charges or price rules).

## Catalog assistant

`cpq.catalog_assistant` (#128) helps catalog admins set up offerings and bundles: create an offering on an existing specification, and add or remove bundle components. It sees the catalog read tools and the three catalog write tools, nothing from quotes, inventory or orders. The quoting assistant does not get the catalog write tools, so a sales chat cannot change the catalog.

- It needs `cpq.offerings.manage`, so only catalog admins see it.
- Every write goes through the same approval card and fail-closed gate as the quote writes. The preview shows the specification and the new offering fields, or the bundle, slot and component being added or removed.
- Example: "Show the slots of bundle Fiber Home and add offering ONT as the default CPE component."

## Who can use it

- The quoting assistant needs `cpq.quotes.view`, the catalog assistant `cpq.offerings.manage`. The default CPQ roles have them.
- Each tool also needs its own permission (tables above). A user without `cpq.inventory.view` can open the agent, but inventory questions fail with a permission error.
- No new permissions were added. Nothing to sync.

## Try it

1. After installing or upgrading, run `yarn generate` (registers the agent and tools) and restart `yarn dev`.
2. Configure an AI provider, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`.
3. Open **`/backend/config/ai-assistant/playground`**, pick **CPQ Quoting Assistant**, and try a starter suggestion (active offerings, price a configuration, explain a quote, renewals due).
4. The topbar AI launcher (Cmd/Ctrl+L) lists the agent too, for users with `cpq.quotes.view`.

## MCP clients

The same tools are exposed by the MCP server (`yarn mcp:dev` for local clients with an API key, `yarn mcp:serve` for the web chat). An MCP client sees each `cpq.*` tool with its input schema and description. Read tools work as in the chat, with the permissions of the API key's user. Write tools are listed as not read-only, but a direct call is refused because there is no approval card outside the in-app chat.

## For developers

- Tool packs: `packages/cpq/src/modules/cpq/ai-tools/` (`catalog-pack`, `catalog-write-pack`, `pricing-pack`, `quotes-pack`, `inventory-pack`, `orders-pack`, shared helpers in `_shared.ts`).
- Agents: `packages/cpq/src/modules/cpq/ai-agents.ts`.
- Tests: `packages/cpq/src/modules/cpq/__tests__/ai-tools/`. They check each tool's input schema, the request it builds and the response mapping, that tool permissions equal the backing route's `requireFeatures` (read statically from the route file), the write gate, the preview and stale-check fingerprint, request bodies against the route validators, and that every `cpq.*` tool on the agent's allowlist exists.
- Adding a tool: wrap an existing documented route (it must export `openApi`) with `defineCpqApiTool`, copy the route's `requireFeatures` into `requiredFeatures`, add it to the agent's allowlist, add a case to `tools.test.ts`, and run `yarn generate`.
