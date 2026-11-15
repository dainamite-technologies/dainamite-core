import { z } from 'zod'

/** Response schema of one cost request row, shared by the queue routes' OpenAPI docs. */
export const costRequestItemSchema = z.object({
  costId: z.string().uuid(), quoteId: z.string().uuid(), quoteConfigurationId: z.string().uuid(),
  quoteNumber: z.string().nullable(), customerName: z.string().nullable(), quoteLineId: z.string().uuid(),
  productName: z.string().nullable(), offeringId: z.string().uuid().nullable(),
  costKey: z.string(), costName: z.string(), chargeCode: z.string().nullable(), role: z.string(), origin: z.string(),
  keyAttributes: z.record(z.string(), z.unknown()).describe('Line configuration values of the attributes that drive the cost'),
  sourcingStatus: z.enum(['not_requested', 'requested', 'answered', 'declined', 'cancelled']),
  cancelReason: z.string().nullable(), costRequestId: z.string().uuid().nullable(), requestSeq: z.number().nullable(),
  requestedAt: z.string().nullable(),
  ageWorkingDays: z.number().nullable().describe('Working days (Mon-Fri, UTC) since the request opened; null unless open'),
  overdue: z.boolean(),
  requestSupplierId: z.string().uuid().nullable(), requestSupplierName: z.string().nullable(),
  valueStatus: z.string(), hasAnswerPending: z.boolean(), cpqStatus: z.string(), orderId: z.string().uuid().nullable(),
}).describe('No amount, currency or supplier answer: only identity, status and timing')
