import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { billingEntityIds } from '../../../data/entityIds'
import { billingInvoicePostSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'
import { BillingInvoice } from '../../../data/entities'

/**
 * `POST /api/billing/invoices/post`
 *
 * Operator action: flip a billing-drafted invoice from `draft` →
 * `posted`. The command refuses non-draft inputs (409 with
 * `billing.invoice.not_draft`) and test-mode invoices (409 with
 * `billing.invoice.test_run`). The series number is claimed at post
 * (Spec 0 numbering masks) — drafts carry a temporary `DRAFT-…` number.
 * 409 `billing.invoice.number_conflict` when the mask repeats an issued
 * number.
 *
 * Implemented as a create-only `makeCrudRoute` so it inherits the same
 * RBAC + OpenAPI plumbing as the rest of the billing surface. The
 * `entity` is `BillingInvoice` only because the factory requires one;
 * the GET half is never exposed on this URL.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.post'] },
}

export const metadata = routeMetadata

const postResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.literal('posted'),
  lineCount: z.number().int().nonnegative(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingInvoice,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: z.object({}).passthrough(),
    // `entityId` is technically a core/sales concept, but the factory
    // only needs it as an identifier — using a billing-namespaced one
    // keeps the registry tidy (no surprise list endpoints).
    entityId: billingEntityIds.draftInvoiceEdit,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.invoices.post',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingInvoicePostSchema.parse(scoped)
      },
      response: ({ result }) => ({
        invoiceId: result?.invoiceId ?? null,
        invoiceNumber: result?.invoiceNumber ?? null,
        status: result?.status ?? null,
        lineCount: result?.lineCount ?? 0,
      }),
      status: 200,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingInvoicePost',
  pluralName: 'BillingInvoicePosts',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingInvoicePostSchema,
    responseSchema: postResponseSchema,
    description:
      'Flips a billing-drafted `core/sales` invoice from `draft` to ' +
      '`posted`. Refuses non-draft invoices (409 / ' +
      '`billing.invoice.not_draft`) and test-mode invoices (409 / ' +
      '`billing.invoice.test_run`). Fires `billing.invoice.posted` + ' +
      'one `billing.invoice.line_posted` per line. The invoice number ' +
      'is NOT re-assigned (set at draft create — see Phase 2 deviation).',
  },
})
