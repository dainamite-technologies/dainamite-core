import { z } from 'zod'

/** Response schemas shared by the cost index routes' `openApi` docs. */
export const costIndexItemSchema = z.object({
  id: z.string().uuid(), code: z.string(), name: z.string(), unit: z.string(), currencyCode: z.string(),
  description: z.string().nullable(), isActive: z.boolean(),
}).passthrough()

export const costIndexCurrentSchema = z.object({ effectiveDate: z.string(), value: z.string(), revision: z.number() }).nullable()
  .describe('Value in force today (highest revision at the latest effective date on or before today), or null')
