/**
 * Shared helpers for the CPQ AI tool packs.
 *
 * Every CPQ AI tool is API-backed: it wraps an existing CPQ REST route
 * in-process through the framework's AI API operation runner
 * (`createAiApiOperationRunner`, via `defineApiBackedAiTool`). The runner
 * resolves the route from the generated manifest, refuses undocumented
 * routes (no `openApi` export), asserts that the tool's `requiredFeatures`
 * cover the route's `requireFeatures`, and calls the handler with a trusted
 * auth envelope. Endpoint RBAC, tenant scoping and Zod validation therefore
 * stay owned by the route; tools never touch the ORM directly.
 *
 * Paths passed to the runner omit the `/api` prefix (the runner adds it), so
 * `/cpq/quotes` targets `GET|POST /api/cpq/quotes`.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  defineApiBackedAiTool,
  type ApiBackedAiToolConfig,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiApiOperationResponse,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type {
  AiToolDefinition,
  McpToolContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

export type CpqAiToolDefinition = AiToolDefinition

export type CpqQueryValue = string | number | boolean | null | undefined

/** Hard cap shared by every list tool. Matches the route-side `pageSize` clamp. */
export const CPQ_AI_MAX_PAGE_SIZE = 100

export const pageField = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('1-based page number (default 1).')

export const pageSizeField = z
  .number()
  .int()
  .min(1)
  .max(CPQ_AI_MAX_PAGE_SIZE)
  .optional()
  .describe(`Rows per page (default 50, max ${CPQ_AI_MAX_PAGE_SIZE}).`)

export const sortDirField = z
  .enum(['asc', 'desc'])
  .optional()
  .describe('Sort direction (default desc, newest first).')

export const configurationField = z
  .record(z.string(), z.unknown())
  .describe(
    'Attribute values keyed by attribute code, for example { "bandwidth": "100M", "contract_term": 24 }. Use the codes returned by cpq.get_configurable_attributes or cpq.get_specification; never invent codes.',
  )

/** Drops `undefined`, `null` and empty-string values so the query string only carries real filters. */
export function compactQuery(query: Record<string, CpqQueryValue>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    out[key] = typeof value === 'string' ? value.trim() : value
  }
  return out
}

/** Encodes one path segment (ids arrive from the model, so never trust them raw). */
export function seg(value: string): string {
  return encodeURIComponent(value)
}

export type CpqPagedApiResponse<TItem = Record<string, unknown>> = {
  items?: TItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export type CpqPagedOutput<TItem = Record<string, unknown>> = {
  items: TItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Normalizes the `{ items, total, page, pageSize, totalPages }` envelope every
 * CPQ list route returns. Missing fields fall back to the requested paging so
 * the model always gets a complete pagination contract.
 */
export function toPagedOutput<TItem = Record<string, unknown>>(
  data: CpqPagedApiResponse<TItem> | undefined,
  requested: { page?: number; pageSize?: number },
): CpqPagedOutput<TItem> {
  const items = Array.isArray(data?.items) ? data!.items : []
  const page = typeof data?.page === 'number' ? data.page : requested.page ?? 1
  const pageSize = typeof data?.pageSize === 'number' ? data.pageSize : requested.pageSize ?? 50
  const total = typeof data?.total === 'number' ? data.total : items.length
  const totalPages = typeof data?.totalPages === 'number'
    ? data.totalPages
    : pageSize > 0 ? Math.ceil(total / pageSize) : 0
  return { items, total, page, pageSize, totalPages }
}

/** Returns the response body as a plain record (or an empty one). */
export function responseRecord(response: AiApiOperationResponse<unknown>): Record<string, unknown> {
  const data = response.data
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

export class CpqAiMutationNotApprovedError extends Error {
  readonly code = 'mutation_not_approved'
  constructor(toolName: string) {
    super(
      `"${toolName}" changes data. This write needs approval in the in-app AI chat; it cannot run over MCP or as a direct call. Make the change in the CPQ backoffice instead.`,
    )
    this.name = 'CpqAiMutationNotApprovedError'
  }
}

/**
 * Fail-closed write gate. The framework's pending-action executor is the only
 * caller that sets `approvedPendingActionId` (after the operator confirmed the
 * preview card). Any other path that reaches a mutation handler, such as the
 * MCP HTTP server (which executes registered tools directly after the feature
 * check, without the approval gate), is refused before the route is called.
 */
export function assertApprovedPendingAction(ctx: Pick<McpToolContext, 'approvedPendingActionId'>, toolName: string): void {
  if (typeof ctx.approvedPendingActionId !== 'string' || ctx.approvedPendingActionId.length === 0) {
    throw new CpqAiMutationNotApprovedError(toolName)
  }
}

export type CpqApiToolConfig<TInput, TApi, TOutput> = ApiBackedAiToolConfig<TInput, TApi, TOutput> & {
  /**
   * Marks a write that deletes or overwrites existing data. Forwarded to the
   * framework `isDestructive` flag (drives the approval gate under the
   * `destructive-confirm-required` policy and the MCP `destructiveHint`).
   * Ignored for `isMutation: true` tools, which are always flagged.
   */
  isDestructive?: boolean
}

/**
 * Typed wrapper over `defineApiBackedAiTool` that erases the generics so packs
 * can collect heterogeneous tools in one `CpqAiToolDefinition[]`. For
 * `isMutation: true` tools it also wires `assertApprovedPendingAction` in
 * front of `toOperation`, so no write route is ever called without an
 * approved pending action.
 */
export function defineCpqApiTool<TInput, TApi, TOutput>(
  config: CpqApiToolConfig<TInput, TApi, TOutput>,
): CpqAiToolDefinition {
  const { isDestructive, ...apiConfig } = config
  const toOperation: ApiBackedAiToolConfig<TInput, TApi, TOutput>['toOperation'] = apiConfig.isMutation === true
    ? (input, ctx) => {
        assertApprovedPendingAction(ctx, apiConfig.name)
        return apiConfig.toOperation(input, ctx)
      }
    : apiConfig.toOperation
  const definition = defineApiBackedAiTool<TInput, TApi, TOutput>({ ...apiConfig, toOperation })
  // `defineApiBackedAiTool` does not forward `isDestructive`; set it on the
  // same object so the handler's own back-reference stays identical.
  // Every CPQ write is flagged destructive: under the tenant policy
  // `destructive-confirm-required` a non-destructive write would run without
  // an approval card, so `assertApprovedPendingAction` would refuse it. With
  // the flag every write always goes through the card.
  const destructive = apiConfig.isMutation === true ? true : isDestructive
  if (destructive !== undefined) Object.assign(definition, { isDestructive: destructive })
  return definition as unknown as CpqAiToolDefinition
}

/**
 * Runs a read operation on behalf of `tool` from a context that does not carry
 * the tool back-reference (the mutation-preview `loadBeforeRecord` path). The
 * runner needs `ctx.tool.requiredFeatures` to check route coverage, so mutation
 * tools that preview through a GET route must also list that route's feature.
 */
export async function runAsTool<T>(
  tool: CpqAiToolDefinition,
  ctx: McpToolContext,
  request: AiApiOperationRequest,
): Promise<AiApiOperationResponse<T>> {
  const execCtx: AiToolExecutionContext = { ...ctx, tool }
  return createAiApiOperationRunner(execCtx).run<T>(request)
}

/* -------------------------------------------------------------------------- */
/*  Quote snapshot helpers (mutation previews + stale-version checks)          */
/* -------------------------------------------------------------------------- */

export type CpqQuoteLineSnapshot = {
  lineId: string
  offeringId?: string | null
  offeringName?: string | null
  quantity?: number | null
  configuration?: Record<string, unknown> | null
  startDate?: string | null
  termMonths?: number | null
  endDate?: string | null
  nrcTotal?: number | null
  mrcTotal?: number | null
}

export type CpqQuoteSnapshot = {
  id: string
  quoteId?: string | null
  quoteNumber?: string | null
  customerId?: string | null
  cpqStatus?: string | null
  version?: number | null
  pricingRevision?: number | null
  currencyCode?: string | null
  pricingSummary?: { nrcTotal?: number | null; mrcTotal?: number | null } | null
  lines?: CpqQuoteLineSnapshot[] | null
}

/** Loads a quote through `GET /api/cpq/quotes/:id`; returns `null` when it is missing or not visible. */
export async function loadQuoteSnapshot(
  tool: CpqAiToolDefinition,
  ctx: McpToolContext,
  quoteId: string,
): Promise<CpqQuoteSnapshot | null> {
  try {
    const response = await runAsTool<CpqQuoteSnapshot>(tool, ctx, {
      method: 'GET',
      path: `/cpq/quotes/${seg(quoteId)}`,
    })
    if (!response.success || !response.data || typeof response.data.id !== 'string') return null
    return response.data
  } catch {
    return null
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/**
 * Deterministic fingerprint of the operator-visible quote state. The pending
 * action stores it at preview time; the confirm route recomputes it and
 * refuses with 412 `stale_version` when someone edited the quote in between.
 * CPQ quote configurations have no single `updatedAt` that moves on every line
 * edit, so the fingerprint covers status, revision counters and every line.
 */
export function quoteRecordVersion(quote: CpqQuoteSnapshot): string {
  const lines = (quote.lines ?? [])
    .map((line) => ({
      lineId: line.lineId,
      offeringId: line.offeringId ?? null,
      quantity: line.quantity ?? null,
      configuration: line.configuration ?? null,
      startDate: line.startDate ?? null,
      termMonths: line.termMonths ?? null,
      endDate: line.endDate ?? null,
    }))
    .sort((a, b) => a.lineId.localeCompare(b.lineId))
  const payload = stableStringify({
    cpqStatus: quote.cpqStatus ?? null,
    version: quote.version ?? null,
    pricingRevision: quote.pricingRevision ?? null,
    currencyCode: quote.currencyCode ?? null,
    lines,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export function quoteLabel(quote: CpqQuoteSnapshot): string {
  return quote.quoteNumber && quote.quoteNumber.trim().length > 0 ? quote.quoteNumber : quote.id
}
