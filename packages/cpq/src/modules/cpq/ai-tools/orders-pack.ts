/**
 * CPQ order tools: list and inspect orders converted from accepted quotes.
 *
 * Read-only and API-backed (see `_shared.ts`). Quote-to-order conversion and
 * order activation are deliberately NOT exposed as AI tools: activation
 * materializes customer inventory and is an operator decision.
 */
import { z } from 'zod'
import {
  compactQuery,
  defineCpqApiTool,
  pageField,
  pageSizeField,
  responseRecord,
  seg,
  sortDirField,
  toPagedOutput,
  type CpqAiToolDefinition,
  type CpqPagedApiResponse,
} from './_shared'

/* -------------------------------------------------------------------------- */
/*  cpq.list_orders  ->  GET /api/cpq/orders                                   */
/* -------------------------------------------------------------------------- */

export const listOrdersInput = z.object({
  customerId: z.string().uuid().optional().describe('Customer entity id (UUID).'),
  sourceQuoteId: z.string().uuid().optional().describe('Only the order converted from this quote.'),
  cpqStatus: z
    .enum(['draft', 'pending_activation', 'active', 'cancelled', 'fulfilled'])
    .optional()
    .describe('CPQ order status filter.'),
  currencyCode: z.string().trim().min(3).max(3).optional().describe('ISO 4217 currency filter.'),
  search: z.string().trim().optional().describe('Free-text match on order number or customer.'),
  sortField: z.enum(['createdAt', 'updatedAt', 'cpqStatus', 'activatedAt', 'currencyCode']).optional().describe('Sort column (default createdAt).'),
  sortDir: sortDirField,
  page: pageField,
  pageSize: pageSizeField,
})
type ListOrdersInput = z.infer<typeof listOrdersInput>

const listOrdersTool = defineCpqApiTool<ListOrdersInput, CpqPagedApiResponse, ReturnType<typeof toPagedOutput>>({
  name: 'cpq.list_orders',
  displayName: 'List CPQ orders',
  description:
    'List CPQ orders (created from accepted quotes) with status, customer, currency and totals. Returns { items, total, page, pageSize, totalPages }.',
  inputSchema: listOrdersInput,
  requiredFeatures: ['cpq.orders.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: '/cpq/orders',
    query: compactQuery({
      customerId: input.customerId,
      sourceQuoteId: input.sourceQuoteId,
      cpqStatus: input.cpqStatus,
      currencyCode: input.currencyCode?.toUpperCase(),
      search: input.search,
      sortField: input.sortField,
      sortDir: input.sortDir,
      page: input.page,
      pageSize: input.pageSize,
    }),
  }),
  mapResponse: (response, input) => toPagedOutput(response.data, input),
})

/* -------------------------------------------------------------------------- */
/*  cpq.get_order  ->  GET /api/cpq/orders/:orderId                            */
/* -------------------------------------------------------------------------- */

export const getOrderInput = z.object({
  orderId: z.string().uuid().describe('CPQ order id or sales order id (UUID).'),
})
type GetOrderInput = z.infer<typeof getOrderInput>

const getOrderTool = defineCpqApiTool<GetOrderInput, Record<string, unknown>, { order: Record<string, unknown> }>({
  name: 'cpq.get_order',
  displayName: 'Get CPQ order',
  description:
    'Fetch one CPQ order with its lines, charges, pricing summary (NRC / MRC, list and discount figures), source quote, ARC quote type and `priceAdjustments`: the source quote\'s negotiated prices, read-only (target, months, phase name, type and value, reason with its label, author name and email). Returns { order }.',
  inputSchema: getOrderInput,
  requiredFeatures: ['cpq.orders.view'],
  toOperation: (input) => ({
    method: 'GET',
    path: `/cpq/orders/${seg(input.orderId)}`,
  }),
  mapResponse: (response) => ({ order: responseRecord(response) }),
})

export const ordersAiTools: CpqAiToolDefinition[] = [listOrdersTool, getOrderTool]

export default ordersAiTools
