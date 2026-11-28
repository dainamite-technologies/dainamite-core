/**
 * Module-root AI tool contribution for the CPQ module.
 *
 * The Open Mercato generator walks every module root for a top-level
 * `ai-tools.ts` and registers the `aiTools` / default export in
 * `ai-tools.generated.ts`. From there the tools reach both the in-app AI
 * chat (through agents that whitelist them, see `ai-agents.ts`) and MCP
 * clients (the MCP server exposes every registered tool, ACL-checked per
 * call against `requiredFeatures`).
 *
 * Every tool is API-backed: it calls an existing CPQ REST route in-process,
 * so route RBAC, tenant scoping, validation and mutation guards are reused.
 * Write tools (`isMutation: true`) run only from an approved pending action
 * (`approvedPendingActionId`), so an MCP client can read but never write.
 * See `ai-tools/_shared.ts` and `manuals/cpq-ai-agent.md`.
 */
import { catalogAiTools } from './ai-tools/catalog-pack'
import { catalogWriteAiTools } from './ai-tools/catalog-write-pack'
import { pricingAiTools } from './ai-tools/pricing-pack'
import { quotesAiTools } from './ai-tools/quotes-pack'
import { inventoryAiTools } from './ai-tools/inventory-pack'
import { ordersAiTools } from './ai-tools/orders-pack'
import { priceAdjustmentsAiTools } from './ai-tools/price-adjustments-pack'
import type { CpqAiToolDefinition } from './ai-tools/_shared'

export const aiTools: CpqAiToolDefinition[] = [
  ...catalogAiTools,
  ...catalogWriteAiTools,
  ...pricingAiTools,
  ...quotesAiTools,
  ...inventoryAiTools,
  ...ordersAiTools,
  ...priceAdjustmentsAiTools,
]

export default aiTools
