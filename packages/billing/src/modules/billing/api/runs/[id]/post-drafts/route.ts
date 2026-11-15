import { z } from 'zod'
import { readRequestBody, runCommandRoute } from '../../../../lib/commandRoute'

/**
 * `POST /api/billing/runs/{id}/post-drafts` — post the draft invoices of a
 * REAL Bill Run, one bounded batch per call (ascending id). Call again with
 * `afterInvoiceId = nextCursor` until `remaining` is 0. Each invoice is posted
 * through `billing.invoices.post`; failures are reported per invoice and do
 * not stop the batch, except incomplete seller settings (`stoppedReason`).
 */

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['billing.invoice.post'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  afterInvoiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const responseSchema = z.object({
  posted: z.number().int().nonnegative(),
  failed: z.array(
    z.object({ invoiceId: z.string().uuid(), number: z.string(), error: z.string(), code: z.string().nullable() }),
  ),
  nextCursor: z.string().uuid().nullable(),
  remaining: z.number().int().nonnegative(),
  stoppedReason: z.string().nullable(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return Response.json({ error: 'Invalid Bill Run id', code: 'billing.request.invalid' }, { status: 400 })
  }
  const billRunId = parsedParams.data.id
  return runCommandRoute(
    req,
    {
      commandId: 'billing.runs.post_drafts',
      bodySchema,
      resourceKind: 'billing.bill_run',
      resourceId: () => billRunId,
      toInput: (body, scope) => ({ ...body, ...scope, billRunId }),
      logLabel: 'billing/runs/[id]/post-drafts.POST',
    },
    await readRequestBody(req),
  )
}

export const openApi = {
  methods: {
    POST: {
      tags: ['Billing'],
      summary: "Post a real Bill Run's draft invoices (batched)",
      description:
        'Posts up to `limit` (default 25, max 100) draft invoices of a real Bill Run, ascending by id. ' +
        'Pass `nextCursor` back as `afterInvoiceId` until `remaining` is 0. Per-invoice failures are listed in ' +
        '`failed`; incomplete seller settings stop the batch (`stoppedReason: billing.settings.incomplete`).',
      pathParams: paramsSchema,
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Batch result', schema: responseSchema }],
      errors: [
        { status: 404, description: '`billing.run.not_found`' },
        { status: 409, description: '`billing.run.running`' },
        { status: 422, description: '`billing.run.not_real`' },
      ],
    },
  },
}
