import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../../context'
import { cpqChangeLogQuerySchema } from '../../../../../data/validators'
import type { DefaultCpqInventoryService } from '../../../../../services/cpqInventoryService'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { canViewCosts } from '../../../../_helpers/costAccess'
import { costPlusEnabled } from '../../../../_helpers/costCommandRoute'
import { stripSnapshotCosts } from '../../../../../services/costs/inventoryCostSnapshot'
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
    // Snapshots carry `items[].costs` / `assets[].costs` (commercially confidential): kept only for holders of
    // `cpq.costs.view` while the cost-plus toggle is on, stripped otherwise (feature spec Q7). No 403: the rest is unchanged.
    const showCosts = (await canViewCosts(ctx)) && (await costPlusEnabled(ctx))
    if (showCosts) return NextResponse.json(result)
    return NextResponse.json({
      ...result,
      items: result.items.map((entry) => ({
        ...entry,
        beforeSnapshot: stripSnapshotCosts(entry.beforeSnapshot),
        afterSnapshot: stripSnapshotCosts(entry.afterSnapshot),
      })),
    })
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
      description: 'Paginated history of ARC changes applied to the subscription, most recent first. Snapshot `items[].costs` and `assets[].costs` (optional arrays, omitted when empty) are present only for cpq.costs.view holders while the cpq.cost_plus toggle is on; they are stripped otherwise.',
      query: cpqChangeLogQuerySchema,
      responses: [{ status: 200, description: 'Paginated change-log entries' }],
      errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(500, 'Internal error')],
    },
  },
}
