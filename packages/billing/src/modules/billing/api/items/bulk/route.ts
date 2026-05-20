import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingItem } from '../../../data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingItemBulkCreateSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/items/bulk` — batch-create Billing Items.
 *
 * One scope envelope, up to 500 item payloads. Idempotent per
 * `source_ref` with a *single* batched existence check, then a
 * single flush. The CPQ connector's subscription-activated /
 * -amended / -renewed subscribers are the primary callers — bulk
 * collapses what used to be one `billing.items.create` round-trip
 * per charge.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
}

export const metadata = routeMetadata

const bulkResultEntrySchema = z.object({
  sourceRef: z.string().nullable(),
  id: z.string().uuid(),
  deduplicated: z.boolean(),
})

const bulkResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  deduplicated: z.number().int().nonnegative(),
  items: z.array(bulkResultEntrySchema),
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
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.item,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.items.bulk_create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingItemBulkCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({
        created: result?.created ?? 0,
        deduplicated: result?.deduplicated ?? 0,
        items: result?.items ?? [],
      }),
      status: 200,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingItemBulkCreate',
  pluralName: 'BillingItemBulkCreates',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingItemBulkCreateSchema,
    responseSchema: bulkResponseSchema,
    description:
      'Batch-creates up to 500 Billing Items under one scope envelope. ' +
      'Idempotent per `sourceRef` (one batched existence check). ' +
      'Returns `{ created, deduplicated, items: [{ sourceRef, id, ' +
      'deduplicated }] }`. Always HTTP 200 — duplicates are reported ' +
      'in the body, never an error.',
  },
})
