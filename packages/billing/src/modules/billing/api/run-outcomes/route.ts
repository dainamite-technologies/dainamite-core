import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { BillRunOutcome } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  BILL_RUN_OUTCOME_STATUSES,
} from '../../data/validators'
import { createBillingCrudOpenApi, createPagedListResponseSchema } from '../openapi'

/**
 * `GET /api/billing/run-outcomes` — list per-account outcomes,
 * typically filtered by `billRunId` to populate the "show me what
 * happened in this run" detail panel.
 *
 * Read-only; outcomes are written by the engine itself, never by API
 * clients.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.run.view'] },
}

export const metadata = routeMetadata

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    billRunId: z.string().uuid().optional(),
    billAccountId: z.string().uuid().optional(),
    status: z.enum(BILL_RUN_OUTCOME_STATUSES).optional(),
  })
  .passthrough()

const billRunOutcomeListItemSchema = z.object({
  id: z.string().uuid(),
  billRunId: z.string().uuid(),
  billAccountId: z.string().uuid(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  warnings: z.record(z.string(), z.unknown()).nullable(),
  draftInvoiceId: z.string().uuid().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillRunOutcome,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listQuerySchema,
    entityId: billingEntityIds.runOutcome,
    fields: [
      'id',
      'bill_run_id',
      'bill_account_id',
      'status',
      'error_message',
      'warnings',
      'draft_invoice_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.billRunId === 'string') filters.bill_run_id = { $eq: query.billRunId }
      if (typeof query.billAccountId === 'string') {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.status === 'string') filters.status = { $eq: query.status }
      return filters
    },
  },
})

export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillRunOutcome',
  pluralName: 'BillRunOutcomes',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billRunOutcomeListItemSchema),
})
