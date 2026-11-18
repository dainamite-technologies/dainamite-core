/**
 * Shared AI tool shape for the billing module.
 *
 * Billing tools are the framework's own `AiToolDefinition` (from
 * `@open-mercato/ai-assistant`), so the generator, the in-app chat runtime and
 * the MCP server all treat them exactly like the core customers / catalog packs.
 * The pack arrays are typed with the erased `BillingAiToolDefinition` so tools
 * with different input / output types can live in one list.
 */
import type {
  AiToolDefinition,
  McpToolContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

export type BillingAiToolDefinition = AiToolDefinition<unknown, unknown>

export type BillingToolContext = McpToolContext

/** Erase a typed tool definition to the pack-array shape. */
export function asBillingTool<TInput, TOutput>(
  tool: AiToolDefinition<TInput, TOutput>,
): BillingAiToolDefinition {
  return tool as unknown as BillingAiToolDefinition
}
