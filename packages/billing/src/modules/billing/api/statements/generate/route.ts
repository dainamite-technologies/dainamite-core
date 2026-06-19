import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BillingStatement } from '../../../data/entities'
import { billingEntityIds } from '../../../data/entityIds'
import { billingStatementGenerateSchema } from '../../../data/validators'
import { createBillingCrudOpenApi } from '../../openapi'

/**
 * `POST /api/billing/statements/generate` (SPEC-002 P3) — manual statement
 * generation for a prepaid account. Reuses the Bill Run engine scoped to the
 * one account (same recurring-charge + anti-duplicate machinery).
 */

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.statement.generate'] },
}

export const metadata = routeMetadata

const generateResponseSchema = z.object({
  statementId: z.string().uuid().nullable(),
  billRunId: z.string().uuid(),
  status: z.string(),
})

const rawBodySchema = z.object({}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BillingStatement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: z.object({}).passthrough(),
    entityId: billingEntityIds.statement,
    fields: ['id'],
    buildFilters: async () => ({}),
  },
  actions: {
    create: {
      commandId: 'billing.statements.generate',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return billingStatementGenerateSchema.parse(scoped)
      },
      response: ({ result }) => ({
        statementId: result?.statementId ?? null,
        billRunId: result?.billRunId ?? null,
        status: result?.status ?? null,
      }),
      status: 201,
    },
  },
})

export const POST = crud.POST

export const openApi = createBillingCrudOpenApi({
  resourceName: 'BillingStatementGenerate',
  pluralName: 'BillingStatementGenerations',
  querySchema: z.object({}).passthrough(),
  listResponseSchema: z.object({ items: z.array(z.unknown()) }),
  create: {
    schema: billingStatementGenerateSchema,
    responseSchema: generateResponseSchema,
    description:
      'Generates a consumption statement for a prepaid account by running the ' +
      'period close (recurring charges → balance + statement) scoped to that ' +
      'account. Returns the statement id (null when the account is not due).',
  },
})
