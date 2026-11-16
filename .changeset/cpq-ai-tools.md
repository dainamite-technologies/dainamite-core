---
'@dainamite/cpq': minor
---

CPQ now works with the Open Mercato AI assistant, in the in-app AI chat and for MCP clients.

- **24 AI tools** (`ai-tools.ts`), each a thin wrapper over an existing CPQ REST route, so they use the same permissions, tenant scoping and validation as the API. Read tools: offerings, specifications and their attributes, bundle trees, configurable attributes for an offering, price calculation (`cpq.calculate_price`), offering combination validation, price rules, quotes with lines and totals, subscriptions, assets, a customer's installed base, expiring subscriptions, subscription change log, and orders.
- **4 write tools**: create a draft quote, add a configured line, update a line, submit a quote for approval. They run only after the operator confirms the preview card in the AI chat. A direct call, for example from an MCP client, is refused and nothing is written.
- **CPQ Quoting Assistant** agent (`cpq.quoting_assistant`, needs `cpq.quotes.view`). It knows the CPQ concepts, always prices through the calculate-price API instead of guessing, and asks before any write. A tenant can lock it to read-only in `/backend/config/ai-assistant/agents`.
- **New required peer dependency (breaking)**: `@open-mercato/ai-assistant` `^0.9.0`, and the `ai_assistant` module must be enabled. It ships in the 1.0.0 major. See `MIGRATION.md`.

No new permissions and no migrations. After upgrading, run `yarn generate` and restart the app. Try it at `/backend/config/ai-assistant/playground`. Details: `manuals/cpq-ai-agent.md`.
