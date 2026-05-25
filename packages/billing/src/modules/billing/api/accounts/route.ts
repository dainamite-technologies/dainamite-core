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

// The list endpoint projects raw column names — snake_case.
const billingAccountListItemSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string(),
  name: z.string(),
  currency_code: z.string(),
  bill_cycle: z.string(),
  bill_cycle_anchor: z.string(),
  invoice_email: z.string(),
  invoice_language: z.string(),
  tax_id: z.string().nullable(),
  invoice_address: z.record(z.string(), z.unknown()),
  next_bill_date: z.string(),
  last_bill_date: z.string().nullable(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
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
    buildFilters: async (query, ctx) => {
      // TEMP DEBUG (XD-254): print auth/scope to understand why CI returns
      // empty list while local prod returns the row. Remove once root
      // cause is fixed.
      try {
        // eslint-disable-next-line no-console
        console.warn(
          '[billing.accounts.buildFilters DEBUG]',
          JSON.stringify({
            query,
            auth: {
              tenantId: (ctx as { auth?: { tenantId?: unknown } } | undefined)?.auth?.tenantId,
              orgId: (ctx as { auth?: { orgId?: unknown } } | undefined)?.auth?.orgId,
              sub: (ctx as { auth?: { sub?: unknown } } | undefined)?.auth?.sub,
            },
            selectedOrganizationId: (ctx as { selectedOrganizationId?: unknown } | undefined)
              ?.selectedOrganizationId,
            organizationIds: (ctx as { organizationIds?: unknown } | undefined)?.organizationIds,
          }),
        )
      } catch {}
      const filters: Record<string, unknown> = {}
      // `?id=<uuid>` narrows the list to one row — the detail page
      // reads a single account through this filter.
      if (typeof query.id === 'string' && query.id) {
        filters.id = { $eq: query.id }
      }
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
  hooks: {
    // TEMP DEBUG (XD-254): also probe the DB directly so we can see
    // whether the row actually exists vs the QE is filtering it out.
    afterList: async (payload: unknown, ctx: unknown) => {
      try {
        const items = (payload as { items?: unknown[]; total?: number } | null)?.items ?? []
        const total = (payload as { total?: number } | null)?.total
        const ctxAny = ctx as {
          auth?: { tenantId?: unknown; orgId?: unknown }
          selectedOrganizationId?: unknown
          query?: { id?: unknown }
          container: { resolve: (name: string) => unknown }
        }
        const queriedId = typeof ctxAny.query?.id === 'string' ? ctxAny.query.id : null
        if (!queriedId) return

        const em = ctxAny.container.resolve('em') as {
          getConnection: () => { execute: (sql: string, params?: unknown[]) => Promise<unknown[]> }
        }
        const conn = em.getConnection()
        const rows = (await conn.execute(
          "SELECT id, tenant_id::text AS tenant_id, organization_id::text AS organization_id, deleted_at FROM billing_accounts WHERE id = ?",
          [queriedId],
        )) as Array<Record<string, unknown>>
        const dbCount = rows.length
        const scopedRows = (await conn.execute(
          "SELECT id FROM billing_accounts WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL",
          [queriedId, ctxAny.auth?.tenantId, ctxAny.auth?.orgId],
        )) as Array<Record<string, unknown>>
        const scopedDbCount = scopedRows.length

        // Cross-check: ask the QE directly with the same params the
        // route should be passing. If THIS also returns 0 with row
        // present in DB, the bug is reproducible from any caller — not
        // factory-specific.
        let qeDirectCount: number | string = 'skip'
        let qeDirectErr: string | null = null
        try {
          const qe = ctxAny.container.resolve('queryEngine') as {
            query: (
              entity: string,
              opts: Record<string, unknown>,
            ) => Promise<{ items: unknown[]; total: number }>
          }
          const direct = await qe.query('billing:billing_account', {
            tenantId: ctxAny.auth?.tenantId,
            organizationId: ctxAny.auth?.orgId,
            organizationIds: ctxAny.auth?.orgId ? [ctxAny.auth.orgId] : undefined,
            filters: { id: { $eq: queriedId } },
            fields: ['id', 'tenant_id', 'organization_id', 'deleted_at'],
            page: { page: 1, pageSize: 5 },
          })
          qeDirectCount = direct.items.length
        } catch (err) {
          qeDirectErr = err instanceof Error ? err.message : String(err)
        }

        // Also check what information_schema thinks about billing_accounts columns
        // — the QE gates scope filters on columnExists() and might be reading
        // a wrong table name.
        let infoSchemaColumns: string[] = []
        let infoSchemaTables: string[] = []
        try {
          const cols = (await conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_accounts' ORDER BY column_name",
          )) as Array<{ column_name: string }>
          infoSchemaColumns = cols.map((c) => c.column_name)
          const tables = (await conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'billing%' ORDER BY table_name",
          )) as Array<{ table_name: string }>
          infoSchemaTables = tables.map((t) => t.table_name)
        } catch {}

        // eslint-disable-next-line no-console
        console.warn('[billing.accounts.afterList DEBUG]', JSON.stringify({
          queriedId,
          qeItemsCount: items.length,
          qeTotal: total,
          qeDirectCount,
          qeDirectErr,
          dbCount,
          scopedDbCount,
          dbRows: rows,
          ctxAuth: { tenantId: ctxAny.auth?.tenantId, orgId: ctxAny.auth?.orgId },
          selectedOrganizationId: ctxAny.selectedOrganizationId,
          infoSchemaColumns,
          infoSchemaTables,
        }))
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[billing.accounts.afterList DEBUG] error', err instanceof Error ? err.message : err)
      }
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
