import { z } from 'zod'
import { costAmount } from './costs'
import { COST_NOTE_MAX_LENGTH, isoDate } from './quote-costs'

/**
 * Post-conversion re-confirmation of an order line cost (ARC costs spec Q-D13, API Contracts). Value, currency,
 * supplier, validity and supplier term only: the cost key, role, type, source and model never change, and a rate is
 * never accepted in the body (it is resolved at the write). At least one field must be present.
 */
export const cpqOrderLineCostReconfirmSchema = z.object({
  unitAmount: costAmount.optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  supplierId: z.string().uuid().nullish(),
  supplierName: z.string().trim().max(255).nullish(),
  supplierQuoteRef: z.string().trim().max(255).nullish(),
  validUntil: isoDate.nullish(),
  supplierTermEnd: isoDate.nullish(),
  supplierMinTermMonths: z.number().int().min(1).max(600).nullish(),
  note: z.string().trim().max(COST_NOTE_MAX_LENGTH).nullish(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'Provide at least one field to re-confirm' })

export type OrderLineCostReconfirm = z.infer<typeof cpqOrderLineCostReconfirmSchema>
