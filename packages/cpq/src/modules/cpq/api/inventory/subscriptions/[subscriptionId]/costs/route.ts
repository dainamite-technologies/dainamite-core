import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { readSubscriptionCosts } from '../../../../../services/costs/inventoryCostView'
import { canViewCosts } from '../../../../_helpers/costAccess'
import { costPlusEnabled, costToggleOff } from '../../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

/** GET /api/cpq/inventory/subscriptions/{subscriptionId}/costs: item and cost-owning asset costs. */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] } }

const pathParams = z.object({ subscriptionId: z.string().uuid() })
const queryParams = z.object({ includeEnded: z.enum(['true', 'false']).optional().default('false') })

export async function GET(req: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { subscriptionId } = pathParams.parse(await params)
    const query = queryParams.parse({ includeEnded: new URL(req.url).searchParams.get('includeEnded') ?? undefined })
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const view = await canViewCosts(ctx)
    return NextResponse.json(await readSubscriptionCosts(ctx.em, subscriptionId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, { canViewCosts: view, includeEnded: query.includeEnded === 'true' }))
  } catch (error) { return handleArcError(error, 'cpq/inventory/subscriptions/[subscriptionId]/costs.GET') }
}

const statusCost = z.object({ id: z.string().uuid(), costKey: z.string(), name: z.string(), role: z.string(), costType: z.string(), valueStatus: z.string(), status: z.string() })
const readResponse = z.object({
  subscriptionId: z.string().uuid(),
  currencyCode: z.string().optional(),
  items: z.array(z.object({ subscriptionItemId: z.string().uuid(), itemStatus: z.string(), costs: z.array(statusCost.passthrough()), margin: z.record(z.string(), z.unknown()).nullable().optional() })),
  assets: z.array(z.object({ assetId: z.string().uuid(), assetStatus: z.string(), costs: z.array(statusCost.passthrough()), margin: z.record(z.string(), z.unknown()).nullable().optional() })),
  margin: z.record(z.string(), z.unknown()).optional(),
}).describe('Without cpq.costs.view only id, costKey, name, role, costType, valueStatus and status per cost (assets lists cost-owning assets only); with it also currencyCode, values, startedAt, endedAt, lastChangeId, per-item / per-asset margin (null when the owner is not live) and the subscription roll-up margin')

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Costs', pathParams, methods: { GET: {
  summary: 'Read the inventory costs of a subscription (status only without cpq.costs.view)',
  query: queryParams,
  responses: [{ status: 200, description: 'Item and asset costs, and margins for cpq.costs.view holders', schema: readResponse }],
  errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Subscription not found, also returned while the tenant toggle cpq.cost_plus is off')],
} } }
