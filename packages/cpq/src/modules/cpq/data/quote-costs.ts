import { z } from 'zod'
import { COST_ROLES, COST_TYPES, COST_VALUE_STATUSES, costAmount } from './costs'

/**
 * Quote-side cost writes (App Spec §1.4.6 / R10 / R11): manual cost lines,
 * value entry and confirmation, and per-line markup overrides. Pure schemas.
 */

/** Cost keys of manual lines: `manual:` + a short unique id. Element codes cannot contain `:`, so they never collide. */
export const MANUAL_COST_KEY_PREFIX = 'manual:'
export const COST_NOTE_MAX_LENGTH = 500

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Not a calendar date')

const expectedRevision = z.number().int().min(0)

const valueFields = {
  unitAmount: costAmount.nullish(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullish(),
  valueStatus: z.enum(COST_VALUE_STATUSES).nullish(),
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().trim().max(255).nullish(),
  supplierQuoteRef: z.string().trim().max(255).nullish(),
  validUntil: isoDate.nullish(),
  supplierTermEnd: isoDate.nullish(),
  supplierMinTermMonths: z.number().int().min(1).max(600).nullish(),
  note: z.string().trim().max(COST_NOTE_MAX_LENGTH).nullish(),
}

const structureFields = {
  name: z.string().trim().min(1).max(255),
  role: z.enum(COST_ROLES),
  costType: z.enum(COST_TYPES),
  source: z.enum(['fixed', 'on_request']),
  costModel: z.enum(['flat', 'per_unit']),
}

export const cpqQuoteLineCostCreateSchema = z.object({
  quoteLineId: z.string().uuid(),
  /** null / omitted = a line-level margin_only cost. */
  chargeCode: z.string().trim().min(1).max(100).nullish(),
  ...structureFields,
  ...valueFields,
  expectedRevision: expectedRevision.optional(),
}).strict()

/** The line and the cost key are immutable. */
export const cpqQuoteLineCostUpdateSchema = z.object({
  chargeCode: z.string().trim().min(1).max(100).nullish(),
  ...structureFields,
  ...valueFields,
  expectedRevision: expectedRevision.optional(),
}).partial().strict()

export const cpqQuoteLineCostDeleteSchema = z.object({ expectedRevision: z.coerce.number().int().min(0).optional() }).strict()

export const cpqCostPreviewSchema = z.object({
  offeringId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  quantity: z.number().finite().min(0).optional(),
}).strict().refine((value) => Boolean(value.offeringId) !== Boolean(value.productId), { message: 'Provide exactly one of offeringId or productId' })

export type QuoteLineCostCreate = z.infer<typeof cpqQuoteLineCostCreateSchema>
export type QuoteLineCostUpdate = z.infer<typeof cpqQuoteLineCostUpdateSchema>
export type CostPreviewInput = z.infer<typeof cpqCostPreviewSchema>
