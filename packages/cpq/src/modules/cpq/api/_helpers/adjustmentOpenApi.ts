import { z } from 'zod'
import { resolvedPriceAdjustmentSchema, targetPreviewErrorSchema } from '../../data/price-adjustments'

/** A stored adjustment as the API returns it (`adjustmentSnapshot`). */
export const adjustmentSnapshotDocSchema = resolvedPriceAdjustmentSchema.extend({
  quoteConfigurationId: z.string().uuid(),
  quoteId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
})

/** List / order read: the snapshot plus the author resolved on the server (D7). */
export const adjustmentListItemDocSchema = adjustmentSnapshotDocSchema.extend({
  createdByName: z.string().nullable().describe('The author\'s name; null when unknown (show the email, then the id).'),
  createdByEmail: z.string().nullable(),
})

/** Order read (D8): list item plus the reason label from the dictionary. */
export const orderAdjustmentDocSchema = adjustmentListItemDocSchema.extend({
  reasonLabel: z.string().nullable().describe('Label of reasonCode in cpq.price_adjustment_reason; null when the entry is gone.'),
})

/** The repriced quote (`QuoteResult`); documented loosely, its shape is the GET /api/cpq/quotes/{id} body. */
export const quoteResultDocSchema = z.object({ id: z.string(), pricingRevision: z.number().optional() }).passthrough()

export const targetWriteResponseSchema = z.object({
  adjustments: z.array(adjustmentSnapshotDocSchema).describe('The target\'s rows after the write, in month order.'),
  quote: quoteResultDocSchema,
})

export const targetPreviewResponseSchema = z.object({
  quote: quoteResultDocSchema,
  errors: z.array(targetPreviewErrorSchema).describe('Errors of the draft rows (temporary ids); any error blocks Save.'),
})
