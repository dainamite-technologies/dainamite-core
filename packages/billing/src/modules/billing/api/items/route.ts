import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingItem } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  billingItemCreateSchema,
  billingItemListQuerySchema,
  billingItemUpdateSchema,
} from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

// ─── Auth / RBAC ─────────────────────────────────────────────────

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.item.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
}

export const metadata = routeMetadata

// The list endpoint projects raw column names — snake_case.
const billingItemListItemSchema = z.object({
  id: z.string().uuid(),
  bill_account_id: z.string().uuid(),
  type: z.string(),
  bill_start_date: z.string(),
  bill_end_date: z.string().nullable(),
  description: z.string(),
  rate_json: z.record(z.string(), z.unknown()),
  uom_code: z.string().nullable(),
  subscription_id: z.string().nullable(),
  subscription_item_id: z.string().nullable(),
  source_ref: z.string().nullable(),
  currency_mismatch: z.boolean(),
  billed_to_date: z.string().nullable(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

// Response for create includes `deduplicated` so integrators can tell
// whether their POST resulted in a new row or hit the idempotency
// short-circuit on `source_ref`.
const itemCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  deduplicated: z.boolean(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingItem,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingItemListQuerySchema,
    entityId: billingEntityIds.item,
    fields: [
      'id',
      'bill_account_id',
      'type',
      'bill_start_date',
      'bill_end_date',
      'description',
      'rate_json',
      'uom_code',
      'subscription_id',
      'subscription_item_id',
      'source_ref',
      'currency_mismatch',
      'billed_to_date',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      billStartDate: 'bill_start_date',
      billEndDate: 'bill_end_date',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      // `?id=<uuid>` narrows the list to one row — the detail page
      // reads a single item through this filter.
      if (typeof query.id === 'string' && query.id) {
        filters.id = { $eq: query.id }
      }
      if (typeof query.billAccountId === 'string' && query.billAccountId) {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.type === 'string' && query.type) {
        filters.type = { $eq: query.type }
      }
      if (typeof query.subscriptionId === 'string' && query.subscriptionId) {
        filters.subscription_id = { $eq: query.subscriptionId }
      }
      if (typeof query.isActive === 'boolean') {
        filters.is_active = { $eq: query.isActive }
      }
      // `activeAt=<date>` returns items whose validity window covers
      // the supplied date (Bill Run engine uses the same predicate
      // shape internally — see spec "Mid-cycle recurring items").
      if (query.activeAt instanceof Date) {
        filters.bill_start_date = { $lte: query.activeAt }
        filters.$or = [
          { bill_end_date: null },
          { bill_end_date: { $gte: query.activeAt } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'billing.items.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingItemCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({
        id: result?.id ?? null,
        deduplicated: Boolean(result?.deduplicated),
      }),
      // Idempotent create returns 200 (vs 201). The spec mandates
      // duplicate POST returns the existing row, never creates a
      // duplicate — keeping the success status consistent makes
      // client-side handling trivial.
      status: 200,
    },
    update: {
      commandId: 'billing.items.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingItemUpdateSchema.parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'billing.items.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        // The factory hands delete a `{ body, query }` envelope — the
        // id may arrive in either, depending on the caller.
        const envelope = (raw ?? {}) as {
          body?: Record<string, unknown>
          query?: Record<string, unknown>
        }
        const body = envelope.body ?? {}
        const query = envelope.query ?? {}
        const scoped = withScopedPayload(body, ctx, translate)
        const id =
          (typeof body.id === 'string' && body.id) ||
          (typeof query.id === 'string' && query.id) ||
          null
        if (!id) {
          throw new Error('id is required')
        }
        return {
          id,
          tenantId: (scoped as { tenantId?: string }).tenantId,
          organizationId: (scoped as { organizationId?: string }).organizationId,
        }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud
export { POST, PUT, DELETE }
export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingItem',
  pluralName: 'BillingItems',
  querySchema: billingItemListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingItemListItemSchema),
  create: {
    schema: billingItemCreateSchema,
    responseSchema: itemCreateResponseSchema,
    description:
      'Creates a billing item. Idempotent via `sourceRef`: re-POSTing the same ' +
      '`(tenantId, billAccountId, sourceRef)` returns the existing row with ' +
      '`deduplicated: true` instead of creating a duplicate. The unique index ' +
      'on `(tenant_id, bill_account_id, source_ref)` is the correctness gate.',
  },
  update: {
    schema: billingItemUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a billing item. `type` and `sourceRef` are immutable — to change ' +
      'either, soft-delete the item and create a new one.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a billing item.',
  },
})
