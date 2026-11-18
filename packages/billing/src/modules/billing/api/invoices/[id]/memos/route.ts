import { z } from 'zod'
import { readRequestBody, runCommandRoute } from '../../../../lib/commandRoute'

/**
 * `POST /api/billing/invoices/[id]/memos` — create a DRAFT credit or debit
 * memo correcting a posted billing invoice (Spec D). Post it with
 * `POST /api/billing/invoices/post`.
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.correct'] },
}

const lineSchema = z.object({
  correctsLineId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive(),
  unitPriceNet: z.coerce.number().nonnegative(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
})

const bodySchema = z.object({
  invoiceId: z.string().uuid(),
  type: z.enum(['credit_memo', 'debit_memo']),
  reason: z.string().trim().min(1).max(1000),
  lines: z.array(lineSchema).max(200).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const raw = (await readRequestBody(req)) as Record<string, unknown>
  return runCommandRoute(
    req,
    {
      commandId: 'billing.invoices.create_memo',
      bodySchema,
      resourceKind: 'billing.invoice',
      resourceId: (body) => body.invoiceId,
      logLabel: 'billing/invoices/[id]/memos.POST',
    },
    { ...(raw && typeof raw === 'object' ? raw : {}), invoiceId: id },
  )
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: 'Create a credit or debit memo',
      description:
        'Creates a draft memo for a posted / partially paid / paid invoice (a fully credited invoice ' +
        'accepts debit memos only). `reason` is required and printed. Credit memo without `lines` = full ' +
        'credit of every original line; lines with `correctsLineId` keep the original VAT rate; new lines ' +
        'default to the organization rate. Amounts are positive — the document type gives the sign.',
      requestBody: { schema: bodySchema.omit({ invoiceId: true }) },
      responses: [{ status: 200, description: '`{ memoId, number, documentType, totalGross }`' }],
      errors: [
        { status: 409, description: '`billing.memo.invalid_original` / `billing.memo.exceeds_invoice`' },
        { status: 400, description: '`billing.memo.invalid_line`' },
      ],
    },
  },
}
