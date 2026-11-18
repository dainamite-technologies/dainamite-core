/**
 * `cpq_billing_connector.get_order_setup` + the billing agent extension.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type {
  AiApiOperationRequest,
  AiApiOperationResponse,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const mockRun = jest.fn<Promise<AiApiOperationResponse<unknown>>, [AiApiOperationRequest]>()
const mockRunnerTools: Array<string | undefined> = []

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => ({
  createAiApiOperationRunner: (ctx: { tool?: { name: string } }) => {
    mockRunnerTools.push(ctx.tool?.name)
    return { run: (request: AiApiOperationRequest) => mockRun(request) }
  },
}))

import { aiTools, getOrderSetupTool } from '../../ai-tools'
import { aiAgents, aiAgentExtensions } from '../../ai-agents'
import { features } from '../../acl'

const MODULE_ROOT = path.resolve(__dirname, '..', '..')
const ROUTE_FILE = 'api/order-setups/[orderId]/route.ts'
const ORDER_ID = '77777777-7777-4777-8777-777777777777'

function ctx(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    container: {} as AwilixContainer,
    userFeatures: [],
    isSuperAdmin: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockRun.mockReset()
  mockRunnerTools.length = 0
})

describe('cpq_billing_connector.get_order_setup', () => {
  it('is the only connector tool and is read-only', () => {
    expect(aiTools.map((tool) => tool.name)).toEqual(['cpq_billing_connector.get_order_setup'])
    expect(getOrderSetupTool.isMutation).toBeUndefined()
  })

  it('requires the route GET feature, which acl.ts declares', async () => {
    const source = await fs.readFile(path.join(MODULE_ROOT, ROUTE_FILE), 'utf-8')
    const match = source.match(/\bGET:\s*\{[^}]*requireFeatures:\s*\[([^\]]*)\]/)
    const routeFeatures = Array.from(match![1].matchAll(/'([^']+)'/g)).map((m) => m[1])
    expect(routeFeatures).toEqual(['cpq_billing_connector.order_setup.view'])
    expect(getOrderSetupTool.requiredFeatures).toEqual(routeFeatures)
    expect(features.map((feature) => feature.id)).toContain('cpq_billing_connector.order_setup.view')
    expect(source).toMatch(/export const openApi\b/)
  })

  it('validates the order id', () => {
    expect(getOrderSetupTool.inputSchema.safeParse({ orderId: ORDER_ID }).success).toBe(true)
    expect(getOrderSetupTool.inputSchema.safeParse({ orderId: 'SO-1' }).success).toBe(false)
    expect(getOrderSetupTool.inputSchema.safeParse({}).success).toBe(false)
  })

  it('calls GET /cpq_billing_connector/order-setups/:orderId and wraps the view', async () => {
    const view = { orderId: ORDER_ID, editable: true, setup: null, defaults: { lines: [] } }
    mockRun.mockResolvedValueOnce({ success: true, statusCode: 200, data: view })
    const result = await getOrderSetupTool.handler({ orderId: ORDER_ID }, ctx())
    expect(mockRun).toHaveBeenCalledWith({ method: 'GET', path: `/cpq_billing_connector/order-setups/${ORDER_ID}` })
    expect(mockRunnerTools).toEqual(['cpq_billing_connector.get_order_setup'])
    expect(result).toEqual({ found: true, orderId: ORDER_ID, view })
  })

  it('maps 404 to found:false and other failures to an error', async () => {
    mockRun.mockResolvedValueOnce({ success: false, statusCode: 404, error: 'CPQ order not found' })
    await expect(getOrderSetupTool.handler({ orderId: ORDER_ID }, ctx())).resolves.toEqual({
      found: false,
      orderId: ORDER_ID,
    })
    mockRun.mockResolvedValueOnce({ success: false, statusCode: 500, error: 'Internal error' })
    await expect(getOrderSetupTool.handler({ orderId: ORDER_ID }, ctx())).rejects.toThrow('Internal error')
  })

  it('refuses to run without a tenant', async () => {
    await expect(getOrderSetupTool.handler({ orderId: ORDER_ID }, ctx({ tenantId: null }))).rejects.toThrow(/Tenant/)
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('billing agent extension', () => {
  it('ships no agent of its own', () => {
    expect(aiAgents).toEqual([])
  })

  it('appends the order setup tool to billing.operator_assistant', () => {
    expect(aiAgentExtensions).toHaveLength(1)
    const [extension] = aiAgentExtensions
    expect(extension.targetAgentId).toBe('billing.operator_assistant')
    expect(extension.appendAllowedTools).toEqual(['cpq_billing_connector.get_order_setup'])
    for (const name of extension.appendAllowedTools ?? []) {
      expect(aiTools.some((tool) => tool.name === name)).toBe(true)
    }
    expect(extension.appendSystemPrompt).toMatch(/cpq_billing_connector\.get_order_setup/)
  })
})
