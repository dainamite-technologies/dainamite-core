import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingAccount, BillingItem } from '../../data/entities'
import { loadPhasesByItem, loadStatusPeriodsByItem, serializePhases, serializeStatusPeriod } from '../../lib/itemSchedules'
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

const billingItemPhaseReadSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int(),
  name: z.string().nullable(),
  durationUnit: z.enum(['day', 'week', 'month', 'year']).nullable(),
  durationCount: z.number().int().nullable(),
  /** Stored "until" date when the phase was defined by a date (else null). */
  untilDate: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  priceType: z.enum(['free', 'fixed', 'percent_off', 'amount_off']),
  value: z.number().nullable(),
})

const billingItemStatusPeriodReadSchema = z.object({
  id: z.string().uuid(),
  billingItemId: z.string().uuid(),
  status: z.enum(['paused', 'suspended', 'grace']),
  fromDate: z.string(),
  toDate: z.string().nullable(),
  chargeBehavior: z.enum(['charge', 'no_charge']),
  reason: z.string().nullable(),
  appliedFrom: z.string().nullable(),
  appliedTo: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// The list endpoint projects raw column names — snake_case.
const billingItemListItemSchema = z.object({
  id: z.string().uuid(),
  bill_account_id: z.string().uuid(),
  bill_account_name: z.string().nullable(),
  /** Spec F (F2): the owning account's currency and mode, for the form. */
  bill_account_currency: z.string().nullable(),
  bill_account_mode: z.enum(['postpaid', 'prepaid']).nullable(),
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
  /** Part 2: why ending the item credited billed days (`{ kind: 'text' | 'code', … }`). */
  credit_reason: z.record(z.string(), z.unknown()).nullable().optional(),
  charge_timing: z.enum(['in_advance', 'in_arrears']),
  prorate: z.boolean(),
  tax_rate: z.union([z.string(), z.number()]),
  price_basis: z.enum(['net', 'gross']),
  /** L §4.2: own billing period; null = follow the account cycle. */
  billing_period_unit: z.enum(['daily', 'weekly', 'monthly', 'annually']).nullable().optional(),
  billing_period_interval: z.number().int().nullable().optional(),
  /** P §4.1: the price-phases switch. */
  phases_enabled: z.boolean().optional(),
  /** Contract C1 camelCase aliases of the three columns above. */
  billingPeriodUnit: z.enum(['daily', 'weekly', 'monthly', 'annually']).nullable().optional(),
  billingPeriodInterval: z.number().int().nullable().optional(),
  phasesEnabled: z.boolean().optional(),
  /** Price phases in order, with computed `startDate` / `endDate` (inclusive). */
  phases: z.array(billingItemPhaseReadSchema).optional(),
  /** Dated line status periods (paused / suspended / grace), oldest first. */
  statusPeriods: z.array(billingItemStatusPeriodReadSchema).optional(),
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
      'credit_reason',
      'charge_timing',
      'prorate',
      'tax_rate',
      'price_basis',
      'billing_period_unit',
      'billing_period_interval',
      'phases_enabled',
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
      if (typeof query.search === 'string' && query.search.trim()) {
        const pattern = `%${query.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`
        filters.description = { $ilike: pattern }
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
  hooks: {
    // Items reference their account by FK id only; the list + detail UI
    // wants the account name, currency and mode. One bounded query
    // (≤ pageSize ids) resolves it after the page is fetched.
    afterList: async (payload: unknown, ctx: unknown) => {
      const items = ((payload as { items?: unknown[] } | null)?.items ?? []) as Array<
        Record<string, unknown>
      >
      const accountIds = Array.from(
        new Set(
          items
            .map((row) => row.bill_account_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      )
      if (accountIds.length === 0) return
      const em = (ctx as { container: AwilixContainer }).container.resolve<EntityManager>('em')
      const accounts = await em.find(BillingAccount, { id: { $in: accountIds } })
      const byId = new Map(accounts.map((a) => [String(a.id), a] as const))
      for (const row of items) {
        const account = byId.get(String(row.bill_account_id))
        row.bill_account_name = account?.name ?? null
        row.bill_account_currency = account?.currencyCode ?? null
        row.bill_account_mode = account?.billingMode ?? null
      }
      // Phases and status periods: two bounded queries (≤ pageSize item ids).
      const first = items[0]
      const scope = {
        tenantId: String(first.tenant_id ?? ''),
        organizationId: String(first.organization_id ?? ''),
      }
      const itemIds = items.map((row) => String(row.id))
      const phases = await loadPhasesByItem(em, scope, itemIds)
      const statuses = await loadStatusPeriodsByItem(em, scope, itemIds)
      for (const row of items) {
        const id = String(row.id)
        const interval = row.billing_period_interval
        row.billing_period_interval = interval === null || interval === undefined ? null : Number(interval)
        row.billingPeriodUnit = row.billing_period_unit ?? null
        row.billingPeriodInterval = row.billing_period_interval
        row.phasesEnabled = Boolean(row.phases_enabled)
        row.phases = serializePhases({ billStartDate: String(row.bill_start_date) as never }, phases.get(id) ?? [])
        row.statusPeriods = (statuses.get(id) ?? []).map(serializeStatusPeriod)
      }
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
      'on `(tenant_id, bill_account_id, source_ref)` is the correctness gate. ' +
      'Recurring items accept `chargeTiming` (`in_advance` default | `in_arrears`) and ' +
      '`prorate` (default true); other types reject non-default values (400). ' +
      'An end date more than one day before the start date returns 422 `billing.item.end_before_start` ' +
      '(`end = start − 1` means cancelled before start; the item never bills). ' +
      'Recurring items only: `billingPeriodUnit` (`daily` | `weekly` | `monthly` | `annually`) + `billingPeriodInterval` (≥ 1) ' +
      'give the line its own billing period, counted from `billStartDate` with no stub; the price is per that period. In advance ' +
      'it is invoiced on the account bill date on or before each period start, in arrears on the first bill date after the ' +
      'period ends; short periods on a longer account cycle are grouped into one line (`quantity` periods). Omitted / null = ' +
      'follow the account cycle. `phases[]` (≤ 12, with `phasesEnabled`, which defaults to true when phases are sent) override ' +
      'the price back to back from `billStartDate`: each has `durationUnit` (`day` | `week` | `month` | `year`) + `durationCount` ' +
      'OR an inclusive `endDate`, and `priceType` `free` | `fixed` (price per billing period) | `percent_off` (0–100) | ' +
      '`amount_off`. Lines split on phase boundaries (prorated by days; `prorate=false` → the phase on the period\'s first day). ' +
      'After the last phase the regular `rateJson.unit_price` applies.',
  },
  update: {
    schema: billingItemUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a billing item. `type` and `sourceRef` are immutable — to change ' +
      'either, soft-delete the item and create a new one. `chargeTiming` / `prorate` ' +
      'may change at any time on recurring items — billing resumes from `billed_to_date`, ' +
      'so no day is billed twice. Moving `billEndDate` before `billed_to_date` on a prorated recurring item credits ' +
      'the billed days: the request must then carry a customer-facing reason — `creditReason` (operator text, ≤ 500 chars) ' +
      'or `creditReasonCode` + `creditReasonParams` (generated, rendered in the invoice language) — else 422 ' +
      '`billing.item.credit_reason_required`. A reason sent when nothing is credited is ignored. ' +
      '422 `billing.item.end_before_start` when the end date is more than one day before the start. ' +
      '`billingPeriodUnit` / `billingPeriodInterval` (recurring only; null clears = follow the account) may change at any ' +
      'time — billing resumes from `billed_to_date`. `phases` REPLACES the whole schedule; `phasesEnabled` toggles it. A ' +
      'phase change that would re-price a day already invoiced (on or before `billed_to_date`) is refused with 422 ' +
      '`billing.item.phase_edit_billed` — correct invoiced periods with a credit memo. 422 `billing.item.phases_recurring_only` / ' +
      '`billing.item.billing_period_recurring_only` on other item types. Ending an item drops its later phases.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a billing item.',
  },
})
