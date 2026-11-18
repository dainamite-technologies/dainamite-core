import { z } from 'zod'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'

/** Error body every CPQ quote route returns (`{ error, ... }`). */
export const cpqErrorResponseSchema = z.object({ error: z.string() }).passthrough()

export function cpqErrorDoc(status: number, description: string): OpenApiResponseDoc {
  return { status, description, schema: cpqErrorResponseSchema }
}

export const cpqQuoteIdPathParams = z.object({ quoteId: z.string().uuid() })

/** Shared error docs for quote writes guarded by mutation guards. */
export const CPQ_GUARDED_WRITE_ERRORS: OpenApiResponseDoc[] = [
  cpqErrorDoc(400, 'Validation error'),
  cpqErrorDoc(404, 'Quote or line not found'),
  cpqErrorDoc(409, 'Quote is in a terminal status'),
  cpqErrorDoc(422, 'Blocked by a mutation guard'),
]

/** Adding / reconfiguring a quote line: the guarded-write errors, with COST_LOCKED on the 409. */
export const CPQ_LINE_WRITE_ERRORS: OpenApiResponseDoc[] = CPQ_GUARDED_WRITE_ERRORS.map((doc) => (doc.status === 409
  ? cpqErrorDoc(409, 'Quote is in a terminal status, or COST_LOCKED: the quote is cost-locked (status outside new / incomplete / ready, or an order exists) and the line is priced from costs (its offering / product has an active cost-plus charge) — adding it, or changing its configuration or quantity, is refused; move the quote back to Ready')
  : doc))

/** `page` / `pageSize` query params shared by CPQ list endpoints (pageSize capped at 100). */
export const cpqPaginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

/** `sortDir` query param shared by CPQ list endpoints. */
export const cpqSortDirQuery = z.enum(['asc', 'desc']).optional()

/** Body of the CPQ `DELETE` endpoints that take the record id in the JSON body. */
export const cpqDeleteByIdBody = z.object({ id: z.string() })

/** `{ success: true }` acknowledgement returned by CPQ delete endpoints. */
export const cpqSuccessResponseSchema = z.object({ success: z.literal(true) })

/** Error docs for the standard CPQ CRUD write (`POST`/`PUT`) handlers. */
export const CPQ_CRUD_WRITE_ERRORS: OpenApiResponseDoc[] = [
  cpqErrorDoc(400, 'Validation error'),
  cpqErrorDoc(500, 'Internal error'),
]

/** Error docs for CPQ CRUD updates and deletes addressed by id. */
export const CPQ_CRUD_BY_ID_ERRORS: OpenApiResponseDoc[] = [
  cpqErrorDoc(400, 'Validation error or missing id'),
  cpqErrorDoc(404, 'Record not found'),
  cpqErrorDoc(500, 'Internal error'),
]
