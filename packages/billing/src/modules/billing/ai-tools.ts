/**
 * Module-root AI tool contribution for the billing module.
 *
 * The Open Mercato generator walks every module root for `ai-tools.ts` and
 * registers the `aiTools` / default export in `ai-tools.generated.ts`, which
 * feeds both the in-app AI chat (typed agents) and the MCP server. Every tool
 * here wraps an existing `/api/billing/*` route in-process (see
 * `ai-tools/_shared.ts`), so route RBAC, tenant scoping and validation are
 * reused. Writes (`ai-tools/mutation-pack.ts`) go through the framework's
 * pending-action approval card. See `manuals/billing-ai-agent.md`.
 */
import accountsAiTools from './ai-tools/accounts-pack'
import itemsUsageAiTools from './ai-tools/items-usage-pack'
import invoicesAiTools from './ai-tools/invoices-pack'
import paymentsLedgerAiTools from './ai-tools/payments-ledger-pack'
import runsAiTools from './ai-tools/runs-pack'
import mutationAiTools from './ai-tools/mutation-pack'
import type { BillingAiToolDefinition } from './ai-tools/types'

export const aiTools: BillingAiToolDefinition[] = [
  ...accountsAiTools,
  ...itemsUsageAiTools,
  ...invoicesAiTools,
  ...paymentsLedgerAiTools,
  ...runsAiTools,
  ...mutationAiTools,
]

export default aiTools
