import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { BillingAccount } from '../../data/entities'
import { fetchAccountFinancials, fetchOverdueAccountIds, financialsOrZero } from '../../lib/accountFinancials'

/** A uuid no row has — narrows an `$in` filter to nothing. */
const NO_MATCH_ID = '00000000-0000-4000-8000-000000000000'
import { billingEntityIds } from '../../data/entityIds'
import { DEFAULT_INVOICE_LANGUAGE, INVOICE_LANGUAGE_CODES } from '../../lib/invoiceLanguages'
import {
  BILL_CYCLES,
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
  customer_kind: z.enum(['company', 'person']),
  name: z.string(),
  currency_code: z.string(),
  bill_cycle: z.enum(BILL_CYCLES),
  bill_cycle_interval: z.number().int(),
  bill_cycle_day: z.string().nullable(),
  invoice_email: z.string(),
  invoice_language: z.string(),
  tax_id: z.string().nullable(),
  invoice_address: z.record(z.string(), z.unknown()),
  next_bill_date: z.string(),
  last_bill_date: z.string().nullable(),
  billing_mode: z.string(),
  credit_limit: z.string(),
  payment_terms_days: z.number().int().nullable(),
  auto_send_invoice: z.boolean(),
  /** Spec F (F8): Σ outstanding of open receivables and its overdue subset (batched per page). */
  balance_due: z.string(),
  overdue_amount: z.string(),
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
      'customer_kind',
      'name',
      'currency_code',
      'bill_cycle',
      'bill_cycle_interval',
      'bill_cycle_day',
      'invoice_email',
      'invoice_language',
      'tax_id',
      'invoice_address',
      'next_bill_date',
      'last_bill_date',
      'billing_mode',
      'credit_limit',
      'payment_terms_days',
      'auto_send_invoice',
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
      const filters: Record<string, unknown> = {}
      // Spec F (F8): accounts with an overdue receivable — one indexed
      // DISTINCT over billing_invoices, intersected with any `id` filter.
      if (query.hasOverdue === true && ctx.auth?.tenantId) {
        const organizationIds = ctx.organizationIds ?? (ctx.selectedOrganizationId ? [ctx.selectedOrganizationId] : [])
        const em = ctx.container.resolve<EntityManager>('em')
        const overdueIds = await fetchOverdueAccountIds(em, { tenantId: ctx.auth.tenantId, organizationIds })
        filters.id = { $in: overdueIds.length > 0 ? overdueIds : [NO_MATCH_ID] }
      }
      // `?id=<uuid>` narrows the list to one row — the detail page
      // reads a single account through this filter.
      if (typeof query.id === 'string' && query.id) {
        const current = filters.id as { $in?: string[] } | undefined
        filters.id = current?.$in ? { $in: current.$in.includes(query.id) ? [query.id] : [NO_MATCH_ID] } : { $eq: query.id }
      }
      if (typeof query.customerId === 'string' && query.customerId) {
        filters.customer_id = { $eq: query.customerId }
      }
      if (typeof query.customerKind === 'string' && query.customerKind) {
        filters.customer_kind = { $eq: query.customerKind }
      }
      if (typeof query.currencyCode === 'string' && query.currencyCode) {
        filters.currency_code = { $eq: query.currencyCode.toUpperCase() }
      }
      if (typeof query.billCycle === 'string' && query.billCycle) {
        filters.bill_cycle = { $eq: query.billCycle }
      }
      if (typeof query.billingMode === 'string' && query.billingMode) {
        filters.billing_mode = { $eq: query.billingMode }
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
    // Spec F (F8): balance due / overdue per row — one GROUP BY for the page.
    afterList: async (payload: unknown, ctx: unknown) => {
      const items = ((payload as { items?: unknown[] } | null)?.items ?? []) as Array<Record<string, unknown>>
      if (items.length === 0) return
      const first = items[0]
      const tenantId = typeof first.tenant_id === 'string' ? first.tenant_id : null
      const organizationId = typeof first.organization_id === 'string' ? first.organization_id : null
      const ids = items.map((row) => row.id).filter((id): id is string => typeof id === 'string')
      const financials =
        tenantId && organizationId
          ? await fetchAccountFinancials(
              (ctx as { container: AwilixContainer }).container.resolve<EntityManager>('em'),
              { tenantId, organizationId },
              ids,
            )
          : new Map()
      for (const row of items) {
        const values = financialsOrZero(financials, String(row.id))
        row.balance_due = values.balance_due
        row.overdue_amount = values.overdue_amount
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

const BILL_CYCLE_DESCRIPTION =
  'Bill cycle = every `billCycleInterval` (default 1) `billCycle` units (`daily` | `weekly` | `monthly` | `annually`, default `monthly`), ' +
  'pinned to `billCycleDay`: `1`–`31` for monthly / annually (a day past the end of a short month means its last day), ' +
  '`mon`–`sun` for weekly, omitted / null for daily. Omitted day → the day `nextBillDate` falls on, else `1` / `mon`. ' +
  'Omitted `nextBillDate` → the first bill cycle day on or after today (daily: today); an explicit date off the cycle day bills one short alignment period first.'

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingAccount',
  pluralName: 'BillingAccounts',
  querySchema: billingAccountListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingAccountListItemSchema),
  create: {
    schema: billingAccountCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description:
      'Creates a new billing account for a customer — a company or a person (`customerKind`, default `company`). ' +
      `\`invoiceLanguage\` must be a language supported by the invoice template (${INVOICE_LANGUAGE_CODES.map((c) => `\`${c}\``).join(', ')}; default \`${DEFAULT_INVOICE_LANGUAGE}\`). ` +
      BILL_CYCLE_DESCRIPTION,
  },
  update: {
    schema: billingAccountUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a billing account. `currencyCode`, `customerId` and `customerKind` are immutable. ' +
      'Changing `billCycle`, `billCycleInterval` or `billCycleDay` without an explicit `nextBillDate` moves the next bill date to ' +
      'the next occurrence of the new bill cycle day; that Bill Run bills one short alignment period (in-advance charges prorated). ' +
      'An invalid cycle combination returns 400 `billing.account.invalid_bill_cycle`.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a billing account (sets `deleted_at`).',
  },
})
