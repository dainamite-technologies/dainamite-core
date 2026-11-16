---
'@dainamite/billing': minor
---

Billing is now usable by AI agents. The package ships an AI tool pack (`ai-tools.ts`) and a `billing.operator_assistant` agent (`ai-agents.ts`) for the Open Mercato AI assistant: the in-app chat and MCP clients see the same tools.

- 14 read tools (`billing.list_accounts`, `billing.get_account`, `billing.list_items`, `billing.list_usage`, `billing.list_invoices`, `billing.get_invoice`, `billing.list_payments`, `billing.get_payment`, `billing.list_transactions`, `billing.list_statements`, `billing.get_statement`, `billing.list_bill_runs`, `billing.get_bill_run`, `billing.list_run_outcomes`). Each one calls the existing `/api/billing/*` route, so it needs the same permission as the matching back-office page and sees only the caller's organization.
- 2 write tools, `billing.trigger_bill_run` (dry and test mode only, never a real run) and `billing.record_payment`. They run only after the operator approves the preview card in the AI chat. A direct call without that approval, for example from an MCP client, is refused.
- The agent uses `mutationPolicy: 'confirm-required'`: every write needs the operator's confirmation. A tenant can switch it to `read-only` in the AI assistant settings.

No new permissions and no migration. The package now lists `@open-mercato/ai-assistant` `^0.9.0` as a peer dependency. After upgrading, run `yarn generate` so the agent and the tools are registered. See `manuals/billing-ai-agent.md`.
