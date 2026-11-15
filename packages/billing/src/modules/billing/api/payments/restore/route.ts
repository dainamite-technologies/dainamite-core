import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/restore` — restore an ignored payment (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

const bodySchema = z.object({ paymentId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.restore',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.paymentId,
    logLabel: 'billing/payments/restore.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Restore an ignored payment',
      description: 'Restores an ignored payment to matched (credit applied again) or unmatched.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 409, description: '`billing.payment.not_ignored`' },
      ],
    },
  },
}
