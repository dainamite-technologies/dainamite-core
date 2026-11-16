import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../../context'
import { cpqChangeLogQuerySchema } from '../../../../../data/validators'
import type { DefaultCpqInventoryService } from '../../../../../services/cpqInventoryService'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

/**
 * GET /api/cpq/inventory/subscriptions/[subscriptionId]/change-log
 *
 * Paginated CpqSubscriptionChangeLog timeline for a subscription
 * (most recent first).
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.arc.changelog.view'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError
    const { subscriptionId } = await params
    const url = new URL(req.url)
    const query = cpqChangeLogQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as DefaultCpqInventoryService
    const result = await service.listChangeLog(
      subscriptionId,
      { page: query.page, pageSize: query.pageSize },
      scope,
    )
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions/[subscriptionId]/change-log.GET')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ ARC',
  summary: 'CPQ subscription change log',
  pathParams: z.object({ subscriptionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List the ARC change-log timeline of a subscription',
      description: 'Paginated history of ARC changes applied to the subscription, most recent first.',
      query: cpqChangeLogQuerySchema,
      responses: [{ status: 200, description: 'Paginated change-log entries' }],
      errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(500, 'Internal error')],
    },
  },
}
