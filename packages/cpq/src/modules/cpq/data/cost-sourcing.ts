import { z } from 'zod'

/**
 * Supplier cost sourcing write contracts (feature spec §API Contracts). Pure schemas.
 * Answer / decline / apply-answer contracts join them in the steps that implement those routes.
 */

export const COST_SOURCING_STATUSES = ['not_requested', 'requested', 'answered', 'declined', 'cancelled'] as const

const expectedRevision = z.number().int().min(0)

/** `POST …/costs/{costId}/request`. */
export const cpqCostRequestSchema = z.object({
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().trim().max(255).nullish(),
  note: z.string().trim().max(500).nullish(),
  expectedRevision: expectedRevision.optional(),
}).strict()
export type CostRequestInput = z.infer<typeof cpqCostRequestSchema>

/** `POST …/costs/{costId}/cancel-request`. */
export const cpqCostCancelRequestSchema = z.object({
  costRequestId: z.string().uuid(),
  note: z.string().trim().max(500).nullish(),
  expectedRevision: expectedRevision.optional(),
}).strict()
export type CostCancelRequestInput = z.infer<typeof cpqCostCancelRequestSchema>

/** The whole response of both routes: ids and statuses only, never an amount (App Spec I-4). */
export const cpqCostRequestResponseSchema = z.object({
  costId: z.string().uuid(),
  sourcingStatus: z.enum(COST_SOURCING_STATUSES),
  costRequestId: z.string().uuid().nullable(),
  requestSeq: z.number().int().nullable(),
  pricingRevision: z.number().int(),
})
export type CostRequestResponse = z.infer<typeof cpqCostRequestResponseSchema>
