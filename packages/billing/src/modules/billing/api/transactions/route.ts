import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { BillingAccountTransaction } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import { billingTransactionListQuerySchema } from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

/**
 * `GET /api/billing/transactions` — paged, append-only balance ledger
 * (SPEC-002). Filter by account, type, and a `created_at` window. The
 * write path is the command bus (real-time consume, top-up capture, period
 * close, manual adjustment) — there is no create/update/delete here.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.balance.view'] },
}

export const metadata = routeMetadata

const billingTransactionListItemSchema = z.object({
  id: z.string().uuid(),
  bill_account_id: z.string().uuid(),
  type: z.string(),
  amount: z.string(),
  currency_code: z.string(),
  balance_after: z.string(),
  usage_id: z.string().uuid().nullable(),
  billing_item_id: z.string().uuid().nullable(),
  topup_id: z.string().uuid().nullable(),
  statement_id: z.string().uuid().nullable(),
  description: z.string(),
  source_ref: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  user_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingAccountTransaction,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingTransactionListQuerySchema,
    entityId: billingEntityIds.transaction,
    fields: [
      'id',
      'bill_account_id',
      'type',
      'amount',
      'currency_code',
      'balance_after',
      'usage_id',
      'billing_item_id',
      'topup_id',
      'statement_id',
      'description',
      'source_ref',
      'metadata',
      'user_id',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
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
      if (typeof query.type === 'string' && query.type) {
        filters.type = { $eq: query.type }
      }
      if (query.createdFrom instanceof Date) {
        filters.created_at = Object.assign(
          (filters.created_at as Record<string, unknown>) ?? {},
          { $gte: query.createdFrom },
        )
      }
      if (query.createdTo instanceof Date) {
        filters.created_at = Object.assign(
          (filters.created_at as Record<string, unknown>) ?? {},
          { $lte: query.createdTo },
        )
      }
      return filters
    },
  },
  // Append-only — no create/update/delete on this surface. Manual
  // adjustments go through POST /api/billing/transactions/adjust.
  actions: {},
})

export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingAccountTransaction',
  pluralName: 'BillingAccountTransactions',
  querySchema: billingTransactionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingTransactionListItemSchema),
})
