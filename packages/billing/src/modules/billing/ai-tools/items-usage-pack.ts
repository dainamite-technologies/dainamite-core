/**
 * `billing.list_items` + `billing.list_usage`.
 *
 * Read-only wrappers over `GET /api/billing/items` (the charge backlog of an
 * account: one-time, recurring and usage items) and `GET /api/billing/usage`
 * (ingested usage records waiting to be rated by a Bill Run).
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import { BILLING_ITEM_TYPES } from '../data/validators'
import {
  assertTenantScope,
  buildListQuery,
  isoDateInput,
  listPaginationInput,
  mapPagedList,
  type PagedListOutput,
} from './_shared'
import { asBillingTool, type BillingAiToolDefinition } from './types'

export const ITEM_VIEW_FEATURE = 'billing.item.view'
export const USAGE_VIEW_FEATURE = 'billing.usage.view'

export const listItemsInput = z.object({
  ...listPaginationInput,
  billAccountId: z.string().uuid().optional().describe('Restrict to the items of one billing account.'),
  type: z
    .enum(BILLING_ITEM_TYPES)
    .optional()
    .describe('one_time = billed once; recurring = billed every cycle; usage = rated from usage records.'),
  subscriptionId: z.string().trim().optional().describe('Restrict to items created from this CPQ subscription.'),
  search: z.string().trim().max(200).optional().describe('Free-text match on the item description.'),
  activeOnly: z.boolean().optional().describe('When true, only active items. Omit to include inactive ones.'),
  activeAt: isoDateInput
    .optional()
    .describe('YYYY-MM-DD: only items whose bill window (bill_start_date..bill_end_date) covers this date.'),
})

export type ListItemsInput = z.infer<typeof listItemsInput>

export const listItemsTool = defineApiBackedAiTool<ListItemsInput, unknown, PagedListOutput>({
  name: 'billing.list_items',
  displayName: 'List billing items',
  description:
    'List billing items (what an account is charged for). Returns { items, total, page, pageSize, totalPages }; each ' +
    'item carries id, bill_account_id, type, description, rate_json (price model), uom_code, bill_start_date, ' +
    'bill_end_date, billed_to_date, charge_timing (in_advance / in_arrears), prorate, tax_rate, price_basis ' +
    '(net / gross), subscription_id, is_active.',
  inputSchema: listItemsInput,
  requiredFeatures: [ITEM_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/items',
      query: buildListQuery(input, {
        billAccountId: input.billAccountId,
        type: input.type,
        subscriptionId: input.subscriptionId,
        search: input.search,
        // z.coerce.boolean on the route reads "false" as true: send only the positive filter.
        isActive: input.activeOnly === true ? 'true' : undefined,
        activeAt: input.activeAt,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const listUsageInput = z.object({
  ...listPaginationInput,
  billAccountId: z.string().uuid().optional().describe('Restrict to the usage of one billing account.'),
  uomCode: z.string().trim().optional().describe('Unit of measure code, e.g. GB or API_CALL.'),
  ratedOnly: z
    .boolean()
    .optional()
    .describe('When true, only usage already rated by a Bill Run. Omit to list rated and unrated usage.'),
  periodEndFrom: isoDateInput.optional().describe('YYYY-MM-DD: usage whose period ends on or after this date.'),
  periodEndTo: isoDateInput.optional().describe('YYYY-MM-DD: usage whose period ends on or before this date.'),
})

export type ListUsageInput = z.infer<typeof listUsageInput>

export const listUsageTool = defineApiBackedAiTool<ListUsageInput, unknown, PagedListOutput>({
  name: 'billing.list_usage',
  displayName: 'List usage records',
  description:
    'List ingested usage records. Returns { items, total, page, pageSize, totalPages }; each item carries id, ' +
    'bill_account_id, uom_code, quantity, period_start, period_end, line_description, source_ref and ' +
    'rated_in_bill_run_id (null = not billed yet).',
  inputSchema: listUsageInput,
  requiredFeatures: [USAGE_VIEW_FEATURE],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx)
    return {
      method: 'GET',
      path: '/billing/usage',
      query: buildListQuery(input, {
        billAccountId: input.billAccountId,
        uomCode: input.uomCode,
        // z.coerce.boolean on the route reads "false" as true: send only the positive filter.
        rated: input.ratedOnly === true ? 'true' : undefined,
        periodEndFrom: input.periodEndFrom,
        periodEndTo: input.periodEndTo,
      }),
    }
  },
  mapResponse: (response, input) => mapPagedList(response, input),
})

export const itemsUsageAiTools: BillingAiToolDefinition[] = [
  asBillingTool(listItemsTool),
  asBillingTool(listUsageTool),
]

export default itemsUsageAiTools
