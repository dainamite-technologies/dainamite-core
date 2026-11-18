import { z } from 'zod'
import { runCommandRoute } from '../../../lib/commandRoute'

/**
 * `DELETE /api/billing/runs/{id}` — delete a TEST or DRY Bill Run with its
 * test invoices and outcomes (Spec F, F-D1). Real runs are refused (422).
 */

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['billing.run.delete'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const emptyBodySchema = z.object({}).passthrough()

const deleteResponseSchema = z.object({
  ok: z.literal(true),
  invoicesRemoved: z.number().int().nonnegative(),
})

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = paramsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return Response.json({ error: 'Invalid Bill Run id', code: 'billing.request.invalid' }, { status: 400 })
  }
  const billRunId = parsedParams.data.id
  return runCommandRoute(
    req,
    {
      commandId: 'billing.runs.delete',
      bodySchema: emptyBodySchema,
      resourceKind: 'billing.bill_run',
      resourceId: () => billRunId,
      operation: 'delete',
      toInput: (_body, scope) => ({ ...scope, billRunId }),
      logLabel: 'billing/runs/[id].DELETE',
    },
    {},
  )
}

export const openApi = {
  methods: {
    DELETE: {
      tags: ['Billing'],
      summary: 'Delete a test or dry Bill Run',
      description:
        'Hard-deletes a test or dry-run Bill Run, its outcomes and the test invoices it wrote (with lines and draft-edit audit rows). ' +
        'Retry runs that point at it keep existing with their parent link cleared. Real runs are never deleted.',
      pathParams: paramsSchema,
      responses: [{ status: 200, description: 'Deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 404, description: '`billing.run.not_found`' },
        { status: 409, description: '`billing.run.running`' },
        { status: 422, description: '`billing.run.delete_real_forbidden`' },
      ],
    },
  },
}
