# Billing AI agent and tools

`@dainamite/billing` plugs into the Open Mercato AI assistant (`@open-mercato/ai-assistant`). It ships:

- an AI tool pack (`packages/billing/src/modules/billing/ai-tools.ts`), and
- one agent, **Billing Operator Assistant** (`billing.operator_assistant`, in `ai-agents.ts`).

`@dainamite/cpq-billing-connector` adds one more read tool and extends the billing agent with it.

The in-app AI chat and MCP clients (Claude Code, MCP Inspector, OpenCode) see the same tools, registered from the same `ai-tools.generated.ts`.

## What the agent can do

Operators can ask about live billing data in plain language, for example:

- "Which invoices are overdue right now, and how much is outstanding per account?"
- "Summarize the last Bill Run: status, accounts billed, failures and totals."
- "Why did the run for account Acme fail?"
- "Show the balance and latest transactions of prepaid account Beta."
- "Which payments are still unmatched?"
- "How will CPQ order X be billed?" (needs the connector)

The agent knows the billing concepts: accounts (postpaid / prepaid), items (one-time, recurring, usage), charge timing (in advance / in arrears), proration, Bill Run modes (real / test / dry), catch-up cycles (one draft per missed bill date) and the invoice lifecycle (draft, posted, paid, credited).

Rules in its prompt:

- It never states an amount, balance, count or date that did not come from a tool result.
- It shows the currency next to every amount.
- It prefers reading past runs, then a dry or test run. It never proposes a real run.
- It asks before any write, and writes only through the approval card.

## Tools

Every tool calls an existing billing REST route in-process. So the tool needs the same permission as the route, sees only the caller's tenant and organization, and gets the route's validation. Tools never read the database directly. List tools return `{ items, total, page, pageSize, totalPages }`, take `limit` (max 100) and `page`, and return the rows as the route projects them.

### Read tools

| Tool | Backing route | Permission |
|---|---|---|
| `billing.list_accounts` | `GET /api/billing/accounts` | `billing.account.view` |
| `billing.get_account` | `GET /api/billing/accounts?id=` + `GET /api/billing/accounts/:id/summary` | `billing.account.view` |
| `billing.list_items` | `GET /api/billing/items` | `billing.item.view` |
| `billing.list_usage` | `GET /api/billing/usage` | `billing.usage.view` |
| `billing.list_invoices` | `GET /api/billing/invoices` | `billing.invoice.view` |
| `billing.get_invoice` | `GET /api/billing/invoices/:id` (lines, allocations, corrections) | `billing.invoice.view` |
| `billing.list_payments` | `GET /api/billing/payments` | `billing.payment.view` |
| `billing.get_payment` | `GET /api/billing/payments/:id` (with allocations) | `billing.payment.view` |
| `billing.list_transactions` | `GET /api/billing/transactions` (prepaid ledger) | `billing.balance.view` |
| `billing.list_statements` | `GET /api/billing/statements` | `billing.statement.view` |
| `billing.get_statement` | `GET /api/billing/statements?id=` | `billing.statement.view` |
| `billing.list_bill_runs` | `GET /api/billing/runs` | `billing.run.view` |
| `billing.get_bill_run` | `GET /api/billing/runs?id=` + `GET /api/billing/run-outcomes?billRunId=` | `billing.run.view` |
| `billing.list_run_outcomes` | `GET /api/billing/run-outcomes` | `billing.run.view` |
| `cpq_billing_connector.get_order_setup` (connector) | `GET /api/cpq_billing_connector/order-setups/:orderId` | `cpq_billing_connector.order_setup.view` |

Notes:

- `billing.get_account` includes the receivables summary and, for prepaid accounts, the balance, balance status, credit limit and last statement.
- `billing.get_invoice` drops the buyer / seller snapshots (names, addresses, tax ids) unless the call asks for them with `includeParties: true`.
- The "active only" and "rated only" filters can only narrow to `true`. The accounts, items and usage routes read the query value `false` as `true`, so the tools never send it.

### Write tools

| Tool | Backing route | Permission | What it does |
|---|---|---|---|
| `billing.trigger_bill_run` | `POST /api/billing/runs` | `billing.run.trigger` | Starts a **dry** or **test** run, optionally for an as-of date and selected accounts. Real runs are not available to the agent. |
| `billing.record_payment` | `POST /api/billing/payments` | `billing.payment.manage` | Records a manual payment. With an account it is matched and applied to that account's open invoices, oldest due first. |

## How writes are gated

1. **Confirm required.** The agent ships with `readOnly: false` and `mutationPolicy: 'confirm-required'`.
2. **Approval card.** A write tool call never runs on its own. The runtime stores a pending action and shows a preview card (run mode, as-of date, accounts; or the payment fields). The write runs only after the operator clicks **Confirm**. Pending actions expire after `AI_PENDING_ACTION_TTL_SECONDS` (default 15 minutes).
3. **Fail closed outside the chat.** Each write tool checks that the call comes from an approved pending action. A direct call, for example from an MCP client, is refused with an error and nothing is written.
4. **Permissions twice.** The tool's permission is checked before the call, and the billing route checks it again.
5. **Never a real run.** `billing.trigger_bill_run` accepts only `mode: dry | test`, both in the tool call and again when the approved action runs.

Per-tenant mutation-policy overrides (`/backend/config/ai-assistant/agents`) can only make an agent stricter, never looser. A tenant that wants no AI writes at all sets the billing agent to `read-only` there; the write tools are then removed before the model sees them.

## Who can use it

- The agent needs `billing.account.view`. Admins (`billing.*`), `billing_admin` and `billing_finance_user` have it by default.
- Each tool also needs its own permission (table above). A user without `billing.payment.view` can open the agent, but payment questions fail with a permission error.
- No new permissions were added. Nothing to sync.

## Try it

1. After installing or upgrading, run `yarn generate` (registers the agent and tools) and restart `yarn dev`.
2. Configure an AI provider, for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`.
3. Open **`/backend/config/ai-assistant/playground`**, pick **Billing Operator Assistant**, and try a starter suggestion (overdue invoices, last Bill Run, failed outcomes, prepaid balance).
4. The topbar AI launcher (Cmd/Ctrl+L) lists the agent too, for users with `billing.account.view`.

## MCP clients

The same tools are exposed by the MCP server (`yarn mcp:dev` for local clients with an API key, `yarn mcp:serve` for the web chat). An MCP client sees each `billing.*` tool with its input schema and description. Read tools work as in the chat, with the permissions of the API key's user. Write tools are listed as not read-only, but a direct call is refused because there is no approval card outside the in-app chat.

## For developers

- Tool packs: `packages/billing/src/modules/billing/ai-tools/` (`accounts-pack`, `items-usage-pack`, `invoices-pack`, `payments-ledger-pack`, `runs-pack`, `mutation-pack`, shared helpers in `_shared.ts`).
- Agent: `packages/billing/src/modules/billing/ai-agents.ts`.
- Connector tool and agent extension: `packages/cpq-billing-connector/src/modules/cpq_billing_connector/ai-tools.ts` and `ai-agents.ts` (`aiAgentExtensions`, appends the order setup tool to the billing agent). Billing never imports the connector.
- Tests: `__tests__/ai-tools/` in both packages. They check each tool's request and response mapping, that tool permissions cover the backing route's `requireFeatures`, the write gate, and that every `billing.*` tool on the agent's allowlist exists.
- Adding a tool: wrap an existing documented route (it must export `openApi`), copy the route's `requireFeatures` into the tool's `requiredFeatures`, add it to the agent's allowlist, add it to `TOOL_ROUTES` in the test, and run `yarn generate`.
