import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingItemStatusPeriod } from '../../../data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import {
  billingItemStatusPeriodCreateSchema,
  billingItemStatusPeriodListQuerySchema,
  billingItemStatusPeriodUpdateSchema,
} from '../../../data/validators'
import { createBillingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

/**
 * `/api/billing/items/status-periods` — dated line status (line-period-and-
 * status spec §4.3, contract C1): paused | suspended | grace from / to.
 *
 *   GET     list (filter by `billingItemId`, `status`, `id`)
 *   POST    create  → `billing.items.status_periods.create`
 *   PUT     update  → `billing.items.status_periods.update` (resume = set `toDate`)
 *   DELETE  delete  → `billing.items.status_periods.delete`
 *
 * Writes are undoable commands. Items with a `subscriptionId` (CPQ lines) are
 * read-only here (D6): CPQ emits the status event and the connector writes it.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.item.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
}

export const metadata = routeMetadata

const statusPeriodListItemSchema = z.object({
  id: z.string().uuid(),
  billing_item_id: z.string().uuid(),
  status: z.enum(['paused', 'suspended', 'grace']),
  from_date: z.string(),
  to_date: z.string().nullable(),
  charge_behavior: z.enum(['charge', 'no_charge']),
  reason: z.string().nullable(),
  /** Engine-owned: the days the Bill Run already left uncharged / credited. */
  applied_from: z.string().nullable(),
  applied_to: z.string().nullable(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

const createResponseSchema = z.object({ id: z.string().uuid().nullable() })
const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingItemStatusPeriod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingItemStatusPeriodListQuerySchema,
    entityId: billingEntityIds.itemStatusPeriod,
    fields: [
      'id',
      'billing_item_id',
      'status',
      'from_date',
      'to_date',
      'charge_behavior',
      'reason',
      'applied_from',
      'applied_to',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: { fromDate: 'from_date', createdAt: 'created_at' },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.id === 'string' && query.id) filters.id = { $eq: query.id }
      if (typeof query.billingItemId === 'string' && query.billingItemId) filters.billing_item_id = { $eq: query.billingItemId }
      if (typeof query.status === 'string' && query.status) filters.status = { $eq: query.status }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'billing.items.status_periods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return billingItemStatusPeriodCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'billing.items.status_periods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return billingItemStatusPeriodUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'billing.items.status_periods.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const envelope = (raw ?? {}) as { body?: Record<string, unknown>; query?: Record<string, unknown> }
        const body = envelope.body ?? {}
        const query = envelope.query ?? {}
        const scoped = withScopedPayload(body, ctx, translate) as { tenantId?: string; organizationId?: string }
        const id = (typeof body.id === 'string' && body.id) || (typeof query.id === 'string' && query.id) || null
        if (!id) throw new Error('id is required')
        return { id, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud
export { POST, PUT, DELETE }
export const GET = crud.GET

const errorsNote =
  '422 `billing.item.status_period_overlap` when the period overlaps another one on the item (periods never overlap); ' +
  '422 `billing.item.status_period_read_only` for an item with a `subscriptionId` (a CPQ line — change it on the CPQ ' +
  'subscription; the connector writes it); 422 `billing.item.status_period_end_before_start`; 422 ' +
  '`billing.item.status_period_recurring_only` on a one-time item; 404 when the item is missing. Undo re-applies the ' +
  'same overlap and read-only checks.'

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingItemStatusPeriod',
  pluralName: 'BillingItemStatusPeriods',
  querySchema: billingItemStatusPeriodListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(statusPeriodListItemSchema),
  create: {
    schema: billingItemStatusPeriodCreateSchema,
    responseSchema: createResponseSchema,
    description:
      'Sets a dated status on a billing line: `paused` (default `chargeBehavior: no_charge` — no recurring charge for the paused ' +
      'days, prorated), `suspended` (default `charge`; `no_charge` per suspension) or `grace` (a flag only, billed normally). ' +
      '`toDate` null = open-ended. A no-charge status over days already billed in advance is credited on the next Bill Run ' +
      '(reason = `reason`, else "Paused <from> – <to>"). Usage lines are never affected. ' +
      errorsNote,
  },
  update: {
    schema: billingItemStatusPeriodUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Changes a status period. Resume = set `toDate` on the open period (the last day of the status). Days left uncharged ' +
      'that are no longer covered are charged on the next Bill Run; newly covered billed days are credited. ' +
      errorsNote,
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a status period; days it left uncharged are charged on the next Bill Run. ' + errorsNote,
  },
})
