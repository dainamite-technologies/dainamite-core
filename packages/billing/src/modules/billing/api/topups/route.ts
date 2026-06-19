import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingTopup } from '../../data/entities'
import { billingEntityIds } from '../../data/entityIds'
import {
  billingTopupCreateSchema,
  billingTopupListQuerySchema,
} from '../../data/validators'
import {
  createBillingCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

/**
 * `/api/billing/topups` — GET (list registered top-ups) + POST (initiate).
 *
 * The nested, spec-faithful `POST /api/billing/accounts/{id}/topups` is a thin
 * wrapper that injects the path id as `billAccountId` and delegates here, so
 * all the RBAC / command-bus / side-effect plumbing lives in one place.
 */

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['billing.topup.view'] },
  POST: { requireAuth: true, requireFeatures: ['billing.topup.create'] },
}

export const metadata = routeMetadata

const billingTopupListItemSchema = z.object({
  id: z.string().uuid(),
  bill_account_id: z.string().uuid(),
  status: z.string(),
  amount: z.string(),
  currency_code: z.string(),
  provider_key: z.string(),
  payment_id: z.string().uuid(),
  gateway_transaction_id: z.string().uuid().nullable(),
  transaction_id: z.string().uuid().nullable(),
  receipt_invoice_id: z.string().uuid().nullable(),
  source_ref: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

const topupCreateResponseSchema = z.object({
  topupId: z.string().uuid(),
  paymentId: z.string().uuid(),
  status: z.string(),
  transactionId: z.string().uuid().nullable(),
  redirectUrl: z.string().nullable(),
  clientSecret: z.string().nullable(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingTopup,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: billingTopupListQuerySchema,
    entityId: billingEntityIds.topup,
    fields: [
      'id',
      'bill_account_id',
      'status',
      'amount',
      'currency_code',
      'provider_key',
      'payment_id',
      'gateway_transaction_id',
      'transaction_id',
      'receipt_invoice_id',
      'source_ref',
      'metadata',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      amount: 'amount',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.id === 'string' && query.id) {
        filters.id = { $eq: query.id }
      }
      if (typeof query.billAccountId === 'string' && query.billAccountId) {
        filters.bill_account_id = { $eq: query.billAccountId }
      }
      if (typeof query.status === 'string' && query.status) {
        filters.status = { $eq: query.status }
      }
      if (typeof query.search === 'string' && /^[0-9a-fA-F-]{36}$/.test(query.search.trim())) {
        filters.id = { $eq: query.search.trim() }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'billing.topups.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingTopupCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({
        topupId: result?.topupId ?? null,
        paymentId: result?.paymentId ?? null,
        status: result?.status ?? null,
        transactionId: result?.transactionId ?? null,
        redirectUrl: result?.redirectUrl ?? null,
        clientSecret: result?.clientSecret ?? null,
      }),
      status: 201,
    },
  },
})

const { POST } = crud
export { POST }
export const GET = crud.GET

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingTopup',
  pluralName: 'BillingTopups',
  querySchema: billingTopupListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(billingTopupListItemSchema),
  create: {
    schema: billingTopupCreateSchema,
    responseSchema: topupCreateResponseSchema,
    description:
      'Registers a prepaid top-up (status=pending) and opens a payment ' +
      'session via core/payment_gateways. The balance is credited only on ' +
      '`payment_gateways.payment.captured` (the capture subscriber issues the ' +
      'VAT receipt). Returns the topup id, the payment session redirect URL / ' +
      'client secret, and the gateway transaction id.',
  },
})
