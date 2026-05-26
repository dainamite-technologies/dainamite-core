import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingInvoiceRemoveLineSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.edit_draft'] },
}

export const metadata = routeMetadata

const removeLineResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceLineId: z.string().uuid(),
  auditId: z.string().uuid(),
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
      commandId: 'billing.invoices.remove_draft_line',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingInvoiceRemoveLineSchema.parse(scoped)
      },
      response: ({ result }) => ({
        invoiceId: result?.invoiceId ?? null,
        invoiceLineId: result?.invoiceLineId ?? null,
        auditId: result?.auditId ?? null,
      }),
      status: 200,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingInvoiceLineRemove',
  pluralName: 'BillingInvoiceLineRemoves',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingInvoiceRemoveLineSchema,
    responseSchema: removeLineResponseSchema,
    description:
      'Removes one line from a draft invoice (hard delete — the line ' +
      'never existed as far as future readers are concerned). Writes ' +
      'a `DraftInvoiceEdit` audit row (action=`line_removed`, ' +
      '`after_json=null`) carrying the before-snapshot for forensics. ' +
      'Recomputes invoice totals. Refuses non-draft invoices.',
  },
})
