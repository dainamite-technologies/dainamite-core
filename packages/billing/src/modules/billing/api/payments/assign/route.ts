import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/assign` — assign a payment to a billing account (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

const bodySchema = z.object({ paymentId: z.string().uuid(), billAccountId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.assign',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.paymentId,
    logLabel: 'billing/payments/assign.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Assign a payment to a billing account',
      description: 'Assigns an unmatched payment to a postpaid account (status → matched) and applies it as credit to the account\'s open invoices, oldest due first.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 404, description: 'Payment or account not found' },
        { status: 409, description: '`billing.payment.not_unmatched` / `prepaid_account` / `currency_mismatch`' },
      ],
    },
  },
}
