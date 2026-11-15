import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/unallocate` — remove an allocation (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

const bodySchema = z.object({ allocationId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.unallocate',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.allocationId,
    logLabel: 'billing/payments/unallocate.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Remove an allocation',
      description: 'Un-allocates a payment or credit memo allocation (soft delete, history kept). The source\'s unallocated amount is restored and the invoice recomputed.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 404, description: 'Allocation not found' },
      ],
    },
  },
}
