import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/payments/allocate` — allocate a payment to invoices (Spec C). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.payment.manage'] },
}

const bodySchema = z.object({ paymentId: z.string().uuid(), allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.coerce.number().positive() })).min(1).max(100) })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.payments.allocate',
    bodySchema,
    resourceKind: 'billing.payment',
    resourceId: (body) => body.paymentId,
    logLabel: 'billing/payments/allocate.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Allocate a payment to invoices',
      description: 'Allocates amounts of a payment to open invoices / debit memos of its account. Invoice paid / outstanding / status are recomputed from allocations.',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated payment state' }],
      errors: [
        { status: 409, description: '`billing.allocation.exceeds_outstanding` / `insufficient_unallocated` / `account_mismatch` / `currency_mismatch` / `invoice_not_open`' },
      ],
    },
  },
}
