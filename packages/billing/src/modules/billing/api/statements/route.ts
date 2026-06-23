import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { BillingStatement } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import { billingStatementListQuerySchema } from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

/**
 * `GET /api/billing/statements` — paged consumption statements (SPEC-002 P3).
 * Filter by account, status, and a `period_end` window. `?id=` narrows to one
 * row for the detail page. Generation goes through
 * POST /api/billing/statements/generate.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.statement.view'] },
}

export const metadata = routeMetadata

const billingStatementListItemSchema = z.object({
  id: z.string().uuid(),
  bill_account_id: z.string().uuid(),
  bill_run_id: z.string().uuid().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  currency_code: z.string(),
  opening_balance: z.string(),
  total_topups: z.string(),
  total_usage: z.string(),
  total_recurring: z.string(),
  total_adjustments: z.string(),
  closing_balance: z.string(),
  debit_breakdown: z.record(z.string(), z.unknown()).nullable(),
  status: z.string(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingStatement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: billingStatementListQuerySchema,
    entityId: billingEntityIds.statement,
    fields: [
      'id',
      'bill_account_id',
      'bill_run_id',
      'period_start',
      'period_end',
      'currency_code',
      'opening_balance',
      'total_topups',
      'total_usage',
      'total_recurring',
      'total_adjustments',
      'closing_balance',
      'debit_breakdown',
      'status',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      periodEnd: 'period_end',
      periodStart: 'period_start',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.id === 'string' && query.id) {
        filters.id = { $eq: query.id }
      }
      if (typeof query.billAccountId === 'string' && query.billAccountId) {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.status === 'string' && query.status) {
        filters.status = { $eq: query.status }
      }
      if (query.periodEndFrom instanceof Date) {
        filters.period_end = Object.assign(
          (filters.period_end as Record<string, unknown>) ?? {},
          { $gte: query.periodEndFrom },
        )
      }
      if (query.periodEndTo instanceof Date) {
        filters.period_end = Object.assign(
          (filters.period_end as Record<string, unknown>) ?? {},
          { $lte: query.periodEndTo },
        )
      }
      return filters
    },
  },
  actions: {},
})

export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingStatement',
  pluralName: 'BillingStatements',
  querySchema: billingStatementListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingStatementListItemSchema),
})
