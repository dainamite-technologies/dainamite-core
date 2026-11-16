/**
 * Module-root AI agent contribution for the CPQ to Billing connector.
 *
 * The connector ships no agent of its own. It extends the billing package's
 * `billing.operator_assistant` (cross-module agent extension, applied by the
 * framework after the base agents load) so the billing agent can answer "how
 * will this CPQ order be billed" with `cpq_billing_connector.get_order_setup`.
 * The dependency points from the connector to billing, never the reverse.
 * The tool keeps its own feature gate (`cpq_billing_connector.order_setup.view`).
 */
import {
  defineAiAgentExtension,
  type AiAgentDefinition,
  type AiAgentExtension,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

export const BILLING_AGENT_ID = 'billing.operator_assistant'
export const ORDER_SETUP_TOOL = 'cpq_billing_connector.get_order_setup'

export const aiAgents: AiAgentDefinition[] = []

export const aiAgentExtensions: AiAgentExtension[] = [
  defineAiAgentExtension({
    targetAgentId: BILLING_AGENT_ID,
    appendAllowedTools: [ORDER_SETUP_TOOL],
    appendSystemPrompt:
      'CPQ ORDERS: CPQ orders are billed through the CPQ billing connector. When the operator asks how a CPQ order ' +
      'will be billed (which billing account, bill start dates per line, whether the setup was applied), call ' +
      'cpq_billing_connector.get_order_setup with the order id.',
    appendSuggestions: [
      {
        label: 'CPQ order billing setup',
        prompt: 'How will the CPQ order I name be billed: which account and which bill start dates?',
      },
    ],
  }),
]

export default aiAgents
