import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/** `POST /api/billing/invoices/delete-draft` — delete a DRAFT credit / debit memo (Spec D, D-D7). */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.correct'] },
}

const bodySchema = z.object({ invoiceId: z.string().uuid() })

export async function POST(req: Request) {
  return runCommandRoute(req, {
    commandId: 'billing.invoices.delete_draft',
    bodySchema,
    resourceKind: 'billing.invoice',
    resourceId: (body) => body.invoiceId,
    logLabel: 'billing/invoices/delete-draft.POST',
  })
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Delete a draft memo',
      description: 'Deletes a draft credit or debit memo with its lines. Posted documents are never deleted (no void).',
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: '`{ deleted: true }`' }],
      errors: [{ status: 409, description: '`billing.memo.not_draft`' }],
    },
  },
}
