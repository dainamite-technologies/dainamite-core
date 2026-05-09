import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { cpqExpiringSubscriptionsQuerySchema } from '../../../../data/validators'
import type { DefaultCpqInventoryService } from '../../../../services/cpqInventoryService'
import { handleArcError } from '../../../_helpers/handleArcError'

/**
 * GET /api/cpq/inventory/subscriptions/expiring
 *
 * List active subscriptions whose currentTermEnd falls within the next
 * `withinDays` days. Drives the operator's renewal triage view.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.expiring.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

export const openApi = {
  '/api/cpq/inventory/subscriptions/expiring': {
    parameters: [
      {
        name: 'withinDays',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
      },
      { name: 'customerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      {
        name: 'billingCycle',
        in: 'query',
        schema: { type: 'string', enum: ['monthly', 'quarterly', 'annually'] },
      },
      { name: 'status', in: 'query', schema: { type: 'string', default: 'active' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
    ],
    get: {
      tags: ['CPQ ARC'],
      summary: 'List subscriptions expiring within N days',
      responses: {
        '200': { description: 'Paginated subscriptions' },
        '401': { description: 'Unauthorized' },
      },
    },
  },
}
