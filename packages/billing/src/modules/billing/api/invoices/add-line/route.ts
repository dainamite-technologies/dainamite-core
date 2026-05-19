import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingInvoiceAddLineSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.edit_draft'] },
}

export const metadata = routeMetadata

const addLineResponseSchema = z.object({
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
      commandId: 'billing.invoices.add_draft_line',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingInvoiceAddLineSchema.parse(scoped)
      },
      response: ({ result }) => ({
        invoiceId: result?.invoiceId ?? null,
        invoiceLineId: result?.invoiceLineId ?? null,
        auditId: result?.auditId ?? null,
      }),
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingInvoiceLineAdd',
  pluralName: 'BillingInvoiceLineAdds',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingInvoiceAddLineSchema,
    responseSchema: addLineResponseSchema,
    description:
      'Appends a new line to a draft invoice (e.g. operator adds a ' +
      'one-off adjustment). Writes a `DraftInvoiceEdit` audit row ' +
      '(action=`line_added`, `before_json=null`). Recomputes invoice ' +
      'totals. Refuses non-draft invoices.',
  },
})
