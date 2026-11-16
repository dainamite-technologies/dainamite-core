/**
 * Module-root AI tool contribution for the CPQ to Billing connector.
 *
 * One read-only tool, `cpq_billing_connector.get_order_setup`, wrapping
 * `GET /api/cpq_billing_connector/order-setups/:orderId` in-process through
 * the framework's AI API operation runner, so the route's RBAC
 * (`cpq_billing_connector.order_setup.view`), tenant scoping and validation
 * are reused. The tool is offered to the billing agent through the
 * `aiAgentExtensions` export in `ai-agents.ts` (billing must not depend on
 * this package, so the dependency points from the connector to billing).
 *
 * `@open-mercato/ai-assistant` is an optional peer of the connector: this file
 * imports only its types at load time and loads the operation runner inside
 * the handler, so an app without the AI assistant still builds and boots.
 */
import { z } from 'zod'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

export const ORDER_SETUP_VIEW_FEATURE = 'cpq_billing_connector.order_setup.view'

export const getOrderSetupInput = z.object({
  orderId: z.string().uuid().describe('CPQ order id (UUID).'),
})

export type GetOrderSetupInput = z.infer<typeof getOrderSetupInput>

export type GetOrderSetupOutput =
  | { found: false; orderId: string }
  | { found: true; orderId: string; view: Record<string, unknown> }

const GET_ORDER_SETUP = {
  name: 'cpq_billing_connector.get_order_setup',
  requiredFeatures: [ORDER_SETUP_VIEW_FEATURE],
}

export const getOrderSetupTool: AiToolDefinition<GetOrderSetupInput, GetOrderSetupOutput> = {
  name: GET_ORDER_SETUP.name,
  displayName: 'Get CPQ order billing setup',
  description:
    'Fetch how a CPQ order will be billed. view carries orderStatus, quoteType, editable (whether the setup can still ' +
    'change), setup (null until saved: accountMode existing / new, billingAccountId, currencyCode, ' +
    'defaultBillStartDate, lineBillStarts, appliedAt, appliedBillingAccountId), defaults.account (new-account values ' +
    'from the order customer) and defaults.lines (billable lines with their CPQ service start). Returns ' +
    '{ found: false } when the order is missing or outside the caller scope.',
  inputSchema: getOrderSetupInput,
  requiredFeatures: [...GET_ORDER_SETUP.requiredFeatures],
  tags: ['read', 'billing', 'cpq'],
  handler: async (rawInput, ctx) => {
    if (!ctx.tenantId) throw new Error('Tenant context is required for cpq_billing_connector.* tools')
    const input = getOrderSetupInput.parse(rawInput)
    const { createAiApiOperationRunner } = await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
    )
    const runner = createAiApiOperationRunner({
      ...ctx,
      tool: ctx.tool ?? (GET_ORDER_SETUP as AiToolDefinition),
    })
    const response = await runner.run<Record<string, unknown>>({
      method: 'GET',
      path: `/cpq_billing_connector/order-setups/${input.orderId}`,
    })
    if (!response.success) {
      if (response.statusCode === 404 || response.statusCode === 403) {
        return { found: false, orderId: input.orderId }
      }
      throw new Error(response.error ?? `Failed to load the billing setup of CPQ order ${input.orderId}`)
    }
    return { found: true, orderId: input.orderId, view: response.data ?? {} }
  },
}

export const aiTools: AiToolDefinition[] = [getOrderSetupTool as unknown as AiToolDefinition]

export default aiTools
