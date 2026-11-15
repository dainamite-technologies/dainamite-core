import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/convert-to-topup` — convert a payment into a prepaid top-up (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage', 'billing.topup.create'] },
}

const bodySchema = z.object({ paymentId: z.string().uuid(), billAccountId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.convert_to_topup',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.paymentId,
    logLabel: 'billing/payments/convert-to-topup.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Convert a payment into a prepaid top-up',
      description: 'Turns an unmatched payment into a captured top-up of a prepaid account (balance credit, transaction and VAT receipt). Terminal; idempotent per payment.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 409, description: '`billing.payment.not_prepaid` / `currency_mismatch` / `not_convertible`' },
      ],
    },
  },
}
