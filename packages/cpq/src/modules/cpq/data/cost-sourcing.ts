import { z } from 'zod'

/**
 * Supplier cost sourcing write contracts (feature spec §API Contracts). Pure schemas.
 * The answer, decline and apply-answer contracts follow the request / cancel ones.
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/**
 * `POST …/costs/{costId}/answer`. No `expectedRevision`: the answer takes the quote lock itself (R11). The currency
 * format (ISO 4217, `^[A-Z]{3}$`, Q15) and `validUntil >= today` are checked by the service (`422`), after the
 * idempotency check, so a retried answer never fails on a date that passed meanwhile.
 */
export const cpqCostAnswerSchema = z.object({
  costRequestId: z.string().uuid(),
  unitAmount: z.number().finite().min(0).max(999_999_999_999),
  currencyCode: z.string().trim().min(1).max(10),
  valueStatus: z.enum(['confirmed', 'estimated']).default('confirmed'),
  supplierQuoteRef: z.string().trim().min(1).max(100),
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().trim().max(255).nullish(),
  validUntil: isoDate.nullish(),
  supplierTermEnd: isoDate.nullish(),
  supplierMinTermMonths: z.number().int().min(0).nullish(),
  note: z.string().trim().max(500).nullish(),
}).strict()
export type CostAnswerInput = z.input<typeof cpqCostAnswerSchema>

/** `POST …/costs/{costId}/decline`. */
export const cpqCostDeclineSchema = z.object({
  costRequestId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
}).strict()
export type CostDeclineInput = z.infer<typeof cpqCostDeclineSchema>

export const COST_ANSWER_OUTCOMES = ['applied', 'confirmed_unchanged', 'proposed', 'noop'] as const
export type CostAnswerOutcome = (typeof COST_ANSWER_OUTCOMES)[number]
