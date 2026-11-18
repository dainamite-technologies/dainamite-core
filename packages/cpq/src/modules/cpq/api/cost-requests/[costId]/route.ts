import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../context'
import { cpqCostRequestIdParamsSchema } from '../../../data/costRequests'
import type { CpqCostRequestQueueService } from '../../../services/costs/costRequestQueue'
import { costPlusEnabled, costToggleOff } from '../../_helpers/costCommandRoute'
import { handleArcError } from '../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'
import { costRequestItemSchema } from '../../_helpers/costRequestOpenApi'

/** Same features as the list (Q13). The detail adds the current value and the proposal: `cpq.costs.view` is required. */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.quotes.view', 'cpq.costs.view'] } }
type Params = { params: Promise<{ costId: string }> }

export async function GET(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { costId } = cpqCostRequestIdParamsSchema.parse(await params)
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const queue = ctx.container.resolve<CpqCostRequestQueueService>('cpqCostRequestQueueService')
    const detail = await queue.detail(costId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId })
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return handleArcError(error, 'cpq/cost-requests/[costId].GET') }
}

const detailResponse = costRequestItemSchema.and(z.object({
  lineConfiguration: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  requestHistory: z.array(z.record(z.string(), z.unknown())).describe('Closed requests, newest last, no amounts'),
  current: z.object({
    valueStatus: z.string(), valueOrigin: z.string().nullable(), unitAmount: z.string().nullable(), currencyCode: z.string().nullable(),
    supplierId: z.string().nullable(), supplierName: z.string().nullable(), supplierQuoteRef: z.string().nullable(), validUntil: z.string().nullable(),
  }),
  proposedAnswer: z.record(z.string(), z.unknown()).nullable(),
}))

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqCostRequestIdParamsSchema, methods: { GET: {
  summary: 'Row expansion of one cost request: configuration, current value, history, proposal',
  responses: [{ status: 200, description: 'The list item plus lineConfiguration, note, requestHistory, current and proposedAnswer', schema: detailResponse }],
  errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'),
    cpqErrorDoc(404, 'Cost line not found, its quote is deleted, or the tenant toggle cpq.cost_plus is off')],
} } }
