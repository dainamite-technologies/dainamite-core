import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingAccountUsage } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  billingUsageCreateSchema,
  billingUsageListQuerySchema,
} from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

// ─── Auth / RBAC ─────────────────────────────────────────────────
//
// Usage is append-only — no update or delete. The narrow scope here
// lets us mint API keys for external metering systems with ONLY
// `billing.usage.ingest`, eliminating an entire blast radius.

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.usage.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.usage.ingest'] },
}

export const metadata = routeMetadata

const billingUsageListItemSchema = z.object({
  id: z.string().uuid(),
  billAccountId: z.string().uuid(),
  uomCode: z.string(),
  quantity: z.string(), // numeric(18,4) → string
  periodStart: z.string(),
  periodEnd: z.string(),
  lineDescription: z.string().nullable(),
  sourceRef: z.string().nullable(),
  ratedInBillRunId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const usageCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  deduplicated: z.boolean(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingAccountUsage,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingUsageListQuerySchema,
    entityId: billingEntityIds.usage,
    fields: [
      'id',
      'bill_account_id',
      'uom_code',
      'quantity',
      'period_start',
      'period_end',
      'line_description',
      'source_ref',
      'rated_in_bill_run_id',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      periodStart: 'period_start',
      periodEnd: 'period_end',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.billAccountId === 'string' && query.billAccountId) {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.uomCode === 'string' && query.uomCode) {
        filters.uom_code = { $eq: query.uomCode }
      }
      if (typeof query.rated === 'boolean') {
        filters.rated_in_bill_run_id = query.rated ? { $ne: null } : { $eq: null }
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
  actions: {
    create: {
      commandId: 'billing.usage.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingUsageCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({
        id: result?.id ?? null,
        deduplicated: Boolean(result?.deduplicated),
      }),
      status: 200,
    },
    // Usage has no update or delete by design — see file header.
  },
})

const { POST } = crud
export { POST }
export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingUsageRecord',
  pluralName: 'BillingUsageRecords',
  querySchema: billingUsageListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingUsageListItemSchema),
  create: {
    schema: billingUsageCreateSchema,
    responseSchema: usageCreateResponseSchema,
    description:
      'Ingests a pre-aggregated usage record. Idempotent via `sourceRef`. ' +
      'Usage records are immutable once persisted — to correct a mis-aggregation, ' +
      "post a `one_time` Billing Item credit (the spec's refund model).",
  },
})
