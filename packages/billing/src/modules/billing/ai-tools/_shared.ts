/**
 * Shared helpers for the billing AI tool packs.
 *
 * Every billing tool is API-backed: it calls an existing `/api/billing/*` route
 * in-process through the framework's AI API operation runner, so the route's
 * RBAC (`metadata.requireFeatures`), tenant / organization scoping and Zod
 * validation are reused as-is. Tools never touch the ORM directly.
 */
import { z } from 'zod'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiApiOperationResponse,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { BillingToolContext } from './types'

export const DEFAULT_LIST_LIMIT = 25
export const MAX_LIST_LIMIT = 100

/** Pagination fields shared by every `billing.list_*` tool. */
export const listPaginationInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .optional()
    .describe(`Rows per page (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).`),
  page: z.number().int().min(1).optional().describe('1-based page number (default 1).'),
}

export const isoDateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

export type QueryValue = string | number | boolean | null | undefined
export type QueryRecord = Record<string, QueryValue>

export function assertTenantScope(ctx: BillingToolContext): { tenantId: string; organizationId: string | null } {
  if (!ctx.tenantId) {
    throw new Error('Tenant context is required for billing.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

/**
 * Builds the route query for a paginated list: `page` / `pageSize` plus every
 * defined filter. `undefined` / `null` / empty-string filters are dropped so
 * the route sees only what the model actually asked for.
 */
export function buildListQuery(
  input: { limit?: number; page?: number },
  filters: QueryRecord = {},
): QueryRecord {
  const query: QueryRecord = {
    page: input.page ?? 1,
    pageSize: Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
  }
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    query[key] = typeof value === 'string' ? value.trim() : value
  }
  return query
}

export type PagedListOutput = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type PagedListApiResponse = {
  items?: unknown
  total?: unknown
  page?: unknown
  pageSize?: unknown
  totalPages?: unknown
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
  )
}

/**
 * Normalizes the `{ items, total, page, pageSize, totalPages }` envelope every
 * billing list route returns (CRUD factory and the hand-written SQL routes
 * share it). Rows are passed through as the route projects them.
 */
export function mapPagedList(
  response: AiApiOperationResponse<unknown>,
  input: { limit?: number; page?: number },
): PagedListOutput {
  const data = (response.data ?? {}) as PagedListApiResponse
  const pageSize = asNumber(data.pageSize, Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))
  const total = asNumber(data.total, 0)
  return {
    items: asRecordArray(data.items),
    total,
    page: asNumber(data.page, input.page ?? 1),
    pageSize,
    totalPages: asNumber(data.totalPages, total === 0 ? 1 : Math.ceil(total / pageSize)),
  }
}

/**
 * Runs one in-process API operation on behalf of `tool`. The runtime normally
 * puts the executing tool on `ctx.tool`; the fallback keeps the runner's
 * route-feature coverage check working when a caller (a test, the test runner)
 * passes a bare context.
 */
export async function runBillingOperation<T = unknown>(
  ctx: BillingToolContext,
  tool: Pick<AiToolDefinition, 'name' | 'requiredFeatures'>,
  request: AiApiOperationRequest,
): Promise<AiApiOperationResponse<T>> {
  const runner = createAiApiOperationRunner({
    ...ctx,
    tool: ctx.tool ?? (tool as AiToolDefinition),
  })
  return runner.run<T>(request)
}

/** 404 / 403 from a detail route means "not visible to this caller". */
export function isNotFound(response: AiApiOperationResponse<unknown>): boolean {
  return !response.success && (response.statusCode === 404 || response.statusCode === 403)
}

export function failureMessage(response: AiApiOperationResponse<unknown>, fallback: string): string {
  return response.error ?? fallback
}

/**
 * Mutation tools run only after the operator confirmed the pending action in
 * the in-app approval card: the framework's pending-action executor is the
 * only caller that sets `approvedPendingActionId`. A direct call (an MCP
 * client invoking the tool, a misconfigured runtime) fails closed here instead
 * of writing without approval.
 */
export function assertApprovedMutation(ctx: BillingToolContext, toolName: string): void {
  if (!ctx.approvedPendingActionId) {
    throw new Error(
      `${toolName} writes billing data and runs only after the operator approves it in the AI chat approval card.`,
    )
  }
}
