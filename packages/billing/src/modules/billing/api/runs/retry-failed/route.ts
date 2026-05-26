import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillRun } from '../../../data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingRunRetryFailedSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/runs/retry-failed`
 *
 * Creates a new Bill Run scoped to the failed-account ids from a parent
 * run, with `parent_run_id` set on the new run so the retry chain is
 * traceable. Returns the new run's id + status + outcomes count.
 *
 * Implemented as a "create-only" `makeCrudRoute` so the framework's
 * RBAC + OpenAPI + command-bus plumbing stays consistent with the rest
 * of the billing surface. The list/get half of the factory is never
 * exercised on this URL — only POST is exported.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.run.trigger'] },
}

export const metadata = routeMetadata

const retryResponseSchema = z.object({
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
  // No `list` — POST-only route. Keep a stub so the factory type-checks.
  list: {
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.run,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.runs.retry_failed',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingRunRetryFailedSchema.parse(scoped)
      },
      response: ({ result }) => ({
        billRunId: result?.billRunId ?? null,
        status: result?.status ?? null,
        outcomesCount: result?.outcomesCount ?? 0,
      }),
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillRunRetry',
  pluralName: 'BillRunRetries',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingRunRetryFailedSchema,
    responseSchema: retryResponseSchema,
    description:
      'Re-runs the failed accounts of an earlier Bill Run. The new run ' +
      'inherits the parent run\'s `asOfDate` and `catchUp` flag; its ' +
      '`parent_run_id` points back at the source. Returns 409 if there ' +
      'are no failed outcomes or if another run is in flight.',
  },
})
