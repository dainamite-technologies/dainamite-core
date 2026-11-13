import { z } from 'zod'

/** Cost preview input (no persistence). Quote cost write schemas arrive with the write commands. */
export const cpqCostPreviewSchema = z.object({
  offeringId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  quantity: z.number().finite().min(0).optional(),
}).strict().refine((value) => Boolean(value.offeringId) !== Boolean(value.productId), { message: 'Provide exactly one of offeringId or productId' })

export type CostPreviewInput = z.infer<typeof cpqCostPreviewSchema>
