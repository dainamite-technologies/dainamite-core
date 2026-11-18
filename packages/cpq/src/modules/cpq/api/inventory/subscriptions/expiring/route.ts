import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqExpiringSubscriptionsQuerySchema } from '../../../../data/validators'
import type { DefaultCpqInventoryService } from '../../../../services/cpqInventoryService'
import { handleArcError } from '../../../_helpers/handleArcError'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

/**
 * GET /api/cpq/inventory/subscriptions/expiring
 *
 * List active subscriptions whose currentTermEnd falls within the next
 * `withinDays` days. Drives the operator's renewal triage view.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const url = new URL(req.url)
    const query = cpqExpiringSubscriptionsQuerySchema.parse({
      withinDays: url.searchParams.get('withinDays') ?? undefined,
      customerId: url.searchParams.get('customerId') ?? undefined,
      billingCycle: url.searchParams.get('billingCycle') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as DefaultCpqInventoryService
    const result = await service.findExpiringSubscriptions(query, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions/expiring.GET')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ expiring subscriptions',
  methods: {
    GET: {
      summary: 'List subscriptions whose current term ends within N days',
      description: 'Drives renewal triage. Defaults: `withinDays=30`, `status=active`.',
      query: cpqExpiringSubscriptionsQuerySchema,
      responses: [{ status: 200, description: 'Paginated subscriptions' }],
      errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(500, 'Internal error')],
    },
  },
}
