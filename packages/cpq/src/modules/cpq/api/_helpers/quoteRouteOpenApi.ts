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
