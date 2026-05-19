import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingAccount } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  billingAccountCreateSchema,
  billingAccountListQuerySchema,
  billingAccountUpdateSchema,
} from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

// ─── Auth / RBAC ─────────────────────────────────────────────────

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.account.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.account.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['billing.account.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['billing.account.manage'] },
}

export const metadata = routeMetadata

// ─── List response item shape (informational — used by OpenAPI) ──

const billingAccountListItemSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  name: z.string(),
  currencyCode: z.string(),
  billCycle: z.string(),
  billCycleAnchor: z.string(),
  invoiceEmail: z.string(),
  invoiceLanguage: z.string(),
  taxId: z.string().nullable(),
  invoiceAddress: z.record(z.string(), z.unknown()),
  nextBillDate: z.string(),
  lastBillDate: z.string().nullable(),
  isActive: z.boolean(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const rawBodySchema = z.object({}).passthrough()

// ─── CRUD route ──────────────────────────────────────────────────

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingAccount,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingAccountListQuerySchema,
    entityId: billingEntityIds.account,
    fields: [
      'id',
      'customer_id',
      'name',
      'currency_code',
      'bill_cycle',
      'bill_cycle_anchor',
      'invoice_email',
      'invoice_language',
      'tax_id',
      'invoice_address',
      'next_bill_date',
      'last_bill_date',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      nextBillDate: 'next_bill_date',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.customerId === 'string' && query.customerId) {
        filters.customer_id = { $eq: query.customerId }
      }
      if (typeof query.currencyCode === 'string' && query.currencyCode) {
        filters.currency_code = { $eq: query.currencyCode.toUpperCase() }
      }
      if (typeof query.billCycle === 'string' && query.billCycle) {
        filters.bill_cycle = { $eq: query.billCycle }
      }
      if (typeof query.isActive === 'boolean') {
        filters.is_active = { $eq: query.isActive }
      }
      if (typeof query.search === 'string' && query.search.trim()) {
        const pattern = `%${query.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`
        filters.name = { $ilike: pattern }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'billing.accounts.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingAccountCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'billing.accounts.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingAccountUpdateSchema.parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'billing.accounts.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const id =
          (raw && typeof raw === 'object' && 'id' in raw ? (raw as { id?: unknown }).id : null) ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (typeof id !== 'string' || !id) {
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
  resourceName: 'BillingAccount',
  pluralName: 'BillingAccounts',
  querySchema: billingAccountListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingAccountListItemSchema),
  create: {
    schema: billingAccountCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description: 'Creates a new billing account for a customer.',
  },
  update: {
    schema: billingAccountUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a billing account. `currencyCode` and `customerId` are immutable.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a billing account (sets `deleted_at`).',
  },
})
