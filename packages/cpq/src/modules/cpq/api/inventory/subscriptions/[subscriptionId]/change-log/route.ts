import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqChangeLogQuerySchema } from '../../../../../data/validators'
import type { DefaultCpqInventoryService } from '../../../../../services/cpqInventoryService'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { canViewCosts } from '../../../../_helpers/costAccess'
import { costPlusEnabled } from '../../../../_helpers/costCommandRoute'
import { stripSnapshotCosts } from '../../../../../services/costs/inventoryCostSnapshot'

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
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

export const openApi = {
  '/api/cpq/inventory/subscriptions/{subscriptionId}/change-log': {
    parameters: [
      {
        name: 'subscriptionId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
    ],
    get: {
      tags: ['CPQ ARC'],
      summary: 'List ARC change-log entries for a subscription',
      responses: {
        '200': {
          description: 'Paginated change log. Snapshot `items[].costs` and `assets[].costs` (optional arrays, omitted when empty) are present only for cpq.costs.view holders while the cpq.cost_plus toggle is on; they are stripped otherwise',
        },
        '401': { description: 'Unauthorized' },
      },
    },
  },
}
