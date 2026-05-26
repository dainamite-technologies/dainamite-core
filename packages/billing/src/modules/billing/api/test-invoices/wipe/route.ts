import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingWipeTestInvoicesSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/test-invoices/wipe` — hard-delete invoices
 * flagged `metadata.test_run=true` for this tenant. Optionally
 * scoped to a `billRunId` so an operator can wipe a single test run
 * without nuking other test data.
 *
 * Modelled as POST (not DELETE) because the body carries the scope
 * fields and modern Next.js routers reject DELETE-with-body more
 * consistently than they accept it; keeping POST keeps the surface
 * uniform with the rest of the billing API.
 *
 * Gated by `billing.run.trigger` (test mode is part of the
 * "operate Bill Runs" toolkit). Phase 4c admin UI exposes this
 * behind a confirm dialog on the Bill Run detail page.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.run.trigger'] },
}

export const metadata = routeMetadata

const wipeResponseSchema = z.object({
  invoicesRemoved: z.number().int().nonnegative(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesInvoice,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.draftInvoiceEdit,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.invoices.wipe_test',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingWipeTestInvoicesSchema.parse(scoped)
      },
      response: ({ result }) => ({
        invoicesRemoved: result?.invoicesRemoved ?? 0,
      }),
      status: 200,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingTestInvoiceWipe',
  pluralName: 'BillingTestInvoiceWipes',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingWipeTestInvoicesSchema,
    responseSchema: wipeResponseSchema,
    description:
      'Hard-deletes test invoices (`metadata.test_run=true`) for the ' +
      'authenticated tenant. Pass `billRunId` to wipe only invoices ' +
      'from a specific test Bill Run. Returns the count removed. ' +
      'Test data should not pollute production history, so this is a ' +
      'hard delete, not a soft delete.',
  },
})
