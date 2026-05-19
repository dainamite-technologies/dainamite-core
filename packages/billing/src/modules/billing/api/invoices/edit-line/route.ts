import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesInvoice } from '@open-mercato/core/modules/sales/data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import {
  billingInvoiceAddLineSchema,
  billingInvoiceEditLineSchema,
  billingInvoiceRemoveLineSchema,
} from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/invoices/edit-line` — edits one line of a draft
 * invoice. Refuses non-drafts (409 / `billing.invoice.not_draft`).
 * Writes a `DraftInvoiceEdit` audit row per spec. Recomputes invoice
 * totals from the surviving lines after the edit.
 *
 * Operator surface: route is gated by `billing.invoice.edit_draft`.
 * Future Phase 4c admin UI calls into the same command via this route.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.edit_draft'] },
}

export const metadata = routeMetadata

const editLineResponseSchema = z.object({
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
      commandId: 'billing.invoices.edit_draft_line',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingInvoiceEditLineSchema.parse(scoped)
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
  resourceName: 'BillingInvoiceLineEdit',
  pluralName: 'BillingInvoiceLineEdits',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingInvoiceEditLineSchema,
    responseSchema: editLineResponseSchema,
    description:
      'Edits one line of a draft invoice (description, quantity, ' +
      "unit_price, or explicit `totalNetAmount` override). Writes a " +
      '`DraftInvoiceEdit` audit row with before+after snapshots and ' +
      'recomputes invoice totals. Refuses non-draft invoices with ' +
      'HTTP 409 + `billing.invoice.not_draft`.',
  },
})

// Re-export the add/remove route schemas so the OpenAPI bundle keeps
// them discoverable from a single import surface — the dedicated
// routes (sibling folders) own the actual handlers.
export const _phaseSchemaRefs = {
  add: billingInvoiceAddLineSchema,
  remove: billingInvoiceRemoveLineSchema,
}
