import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillRun } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  billingRunListQuerySchema,
  billingRunTriggerSchema,
} from '../../data/validators'
import { createBillingCrudOpenApi, createPagedListResponseSchema } from '../openapi'

/**
 * `/api/billing/runs` — GET (history list) + POST (manual trigger).
 *
 * The triggered-by enum gate:
 *   - `trigger` feature is required for `real` mode (which mutates
 *     production state).
 *   - `dry_run` feature alone is enough for `mode=dry` (finance auditor
 *     persona). The route-level RBAC check on POST requires `trigger`,
 *     so dry-run callers must hold both `dry_run` AND `trigger` here —
 *     a deliberate tightening over what the spec persona table suggests.
 *
 *   If we ever want auditors to drive dry-runs without holding `trigger`,
 *   we split into two routes (POST `/runs` for real, POST `/runs/dry` for
 *   dry). Postponed until an operator actually asks.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.run.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.run.trigger'] },
}

export const metadata = routeMetadata

const billRunListItemSchema = z.object({
  id: z.string().uuid(),
  triggeredBy: z.string(),
  parentRunId: z.string().uuid().nullable(),
  dryRun: z.boolean(),
  testMode: z.boolean(),
  catchUp: z.boolean(),
  scopedAccountIds: z.array(z.string().uuid()).nullable(),
  asOfDate: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  status: z.string(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const triggerResponseSchema = z.object({
  billRunId: z.string().uuid(),
  status: z.string(),
  outcomesCount: z.number().int().nonnegative(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillRun,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingRunListQuerySchema,
    entityId: billingEntityIds.run,
    fields: [
      'id',
      'triggered_by',
      'parent_run_id',
      'dry_run',
      'test_mode',
      'catch_up',
      'scoped_account_ids',
      'as_of_date',
      'started_at',
      'finished_at',
      'status',
      'summary',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      asOfDate: 'as_of_date',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.status === 'string') filters.status = { $eq: query.status }
      if (typeof query.triggeredBy === 'string') filters.triggered_by = { $eq: query.triggeredBy }
      if (typeof query.parentRunId === 'string') filters.parent_run_id = { $eq: query.parentRunId }
      if (query.asOfDateFrom instanceof Date) {
        filters.as_of_date = Object.assign(
          (filters.as_of_date as Record<string, unknown>) ?? {},
          { $gte: query.asOfDateFrom },
        )
      }
      if (query.asOfDateTo instanceof Date) {
        filters.as_of_date = Object.assign(
          (filters.as_of_date as Record<string, unknown>) ?? {},
          { $lte: query.asOfDateTo },
        )
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'billing.runs.trigger',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingRunTriggerSchema.parse(scoped)
      },
      response: ({ result }) => ({
        billRunId: result?.billRunId ?? null,
        status: result?.status ?? null,
        outcomesCount: result?.outcomesCount ?? 0,
      }),
      status: 201,
    },
    // Runs are append-only — no update / delete on this surface. A
    // failed run is corrected by triggering a `retry-failed` (separate
    // route).
  },
})

const { POST } = crud
export { POST }
export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillRun',
  pluralName: 'BillRuns',
  querySchema: billingRunListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billRunListItemSchema),
  create: {
    schema: billingRunTriggerSchema,
    responseSchema: triggerResponseSchema,
    description:
      'Triggers a Bill Run. `mode=real` (default) persists drafts and ' +
      'advances state; `mode=test` persists test-flagged drafts without ' +
      'advancing state; `mode=dry` computes everything in memory and ' +
      'persists nothing. Returns HTTP 409 (`billing.run.lock_busy`) when ' +
      'another run is in flight for the same tenant.',
  },
})
