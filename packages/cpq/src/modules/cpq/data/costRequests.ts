import { z } from 'zod'

/** Query of `GET /api/cpq/cost-requests` (feature spec §API Contracts). Pure schema. */
export const COST_REQUEST_STATUS_FILTERS = ['requested', 'answered', 'declined', 'cancelled', 'all'] as const
export const COST_REQUEST_MAX_PAGE_SIZE = 100

export const cpqCostRequestListQuerySchema = z.object({
  /** Default `requested` (the open queue). */
  status: z.enum(COST_REQUEST_STATUS_FILTERS).default('requested'),
  cancelReason: z.string().trim().min(1).max(50).optional(),
  supplierId: z.string().uuid().optional(),
  /** The quote's id (`cpq_quote_line_costs.quote_id`, the sales quote id). */
  quoteId: z.string().uuid().optional(),
  /** `true` keeps open requests older than the working-day threshold; implies status `requested`. */
  overdue: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  /** Quote number, customer name or cost name (case-insensitive substring). */
  search: z.string().trim().min(1).max(100).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(COST_REQUEST_MAX_PAGE_SIZE).default(25),
})
export type CostRequestListQuery = z.infer<typeof cpqCostRequestListQuerySchema>

export const cpqCostRequestIdParamsSchema = z.object({ costId: z.string().uuid() })
