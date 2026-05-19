import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import type { ZodTypeAny } from 'zod'

/**
 * Billing CRUD OpenAPI factory. Every billing API route imports this
 * and calls it with the resource's `create` / `update` / `del` schemas
 * — the framework picks up the resulting `openApi` export and merges
 * it into the global API documentation bundle.
 */
const buildBillingCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Billing',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createBillingCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildBillingCrudOpenApi(options)
}

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export { defaultCreateResponseSchema, defaultOkResponseSchema }
