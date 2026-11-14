import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../context'
import type { CpqQuoteCostService } from '../../../services/costs/quoteCostService'
import { handleArcError } from '../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../_helpers/quoteRouteOpenApi'

/** What depends on cost-plus pricing. The one cost endpoint that stays available with the toggle off. */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.costs.view'] } }

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const service = ctx.container.resolve<CpqQuoteCostService>('cpqQuoteCostService')
    return NextResponse.json(await service.usage({ organizationId: ctx.organizationId, tenantId: ctx.tenantId }))
  } catch (error) { return handleArcError(error, 'cpq/cost-plus/usage.GET') }
}

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Pricing', methods: { GET: {
  summary: 'Cost-plus usage: toggle state, active cost-plus charges, open quotes with costs',
  responses: [{ status: 200, description: 'Usage counters (openRequests and liveSubscriptions are filled by later features)',
    schema: z.object({ enabled: z.boolean(), costPlusCharges: z.number(), openQuotes: z.number(), openRequests: z.number(), liveSubscriptions: z.number() }) }],
  errors: [cpqErrorDoc(403, 'Missing permission')],
} } }
