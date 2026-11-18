import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/unassign` — unassign a payment (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

const bodySchema = z.object({ paymentId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.unassign',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.paymentId,
    logLabel: 'billing/payments/unassign.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Unassign a payment',
      description: 'Reverses an assignment of a matched payment that has no allocations (status → unmatched).',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 409, description: '`billing.payment.has_allocations` — un-allocate first' },
      ],
    },
  },
}
