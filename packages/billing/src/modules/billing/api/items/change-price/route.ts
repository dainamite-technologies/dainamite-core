import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/**
 * `POST /api/billing/items/change-price` — change a recurring item's price
 * from a date on: the item ends the day before `effectiveDate` and a copy with
 * `unitPrice` starts on it (same account, description, timing, proration,
 * VAT, price basis, references and end date). Returns both item ids.
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.item.manage'] },
}

const bodySchema = z.object({
  id: z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unitPrice: z.coerce.number().finite().nonnegative(),
})

const responseSchema = z.object({ previousItemId: z.string().uuid(), newItemId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.items.change_price',
    bodySchema,
    resourceKind: 'billing.item',
    resourceId: (body) => body.id,
    logLabel: 'billing/items/change-price.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: "Change a recurring item's price from a date",
      description:
        'Ends the item the day before `effectiveDate` and creates a copy with the new `unitPrice` (on the item price basis) ' +
        'starting on `effectiveDate`. Already-billed days after the change are credited / re-charged by the Bill Run per the ' +
        "item's proration setting, so nothing is billed twice. When the change credits billed days (prorate on, item billed " +
        'past the effective date) a customer-facing reason is required: `creditReason` or `creditReasonCode` + `creditReasonParams`.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Both item ids', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Item not found' },
        {
          status: 422,
          description:
            '`billing.item.price_change_recurring_only` / `_inactive` / `_before_start` (must be after the start date) / `_after_end`; ' +
            '`billing.item.credit_reason_required` when the change credits billed days and no reason is given',
        },
      ],
    },
  },
}
