import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingAccountTransaction } from '../../../data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingTransactionAdjustSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/transactions/adjust` (SPEC-002 P5) — manual balance
 * credit/debit (`type='adjustment'`), audited with the operator's `user_id`.
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.balance.adjust'] },
}

export const metadata = routeMetadata

const adjustResponseSchema = z.object({
  transactionId: z.string().uuid(),
  balance: z.string(),
  balanceStatus: z.enum(['ok', 'low', 'exhausted']),
  deduplicated: z.boolean(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingAccountTransaction,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.transaction,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.transactions.adjust',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingTransactionAdjustSchema.parse(scoped)
      },
      response: ({ result }) => ({
        transactionId: result?.transactionId ?? null,
        balance: result?.balance ?? null,
        balanceStatus: result?.balanceStatus ?? null,
        deduplicated: Boolean(result?.deduplicated),
      }),
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingBalanceAdjustment',
  pluralName: 'BillingBalanceAdjustments',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingTransactionAdjustSchema,
    responseSchema: adjustResponseSchema,
    description:
      'Manually credits (amount > 0) or debits (amount < 0) a prepaid ' +
      "account's balance. Audited with the operator's user id. Non-fiscal — " +
      'no receipt is issued. Returns the new balance + status.',
  },
})
