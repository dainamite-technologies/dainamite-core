import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { readAssetCosts } from '../../../../../services/costs/inventoryCostView'
import { canViewCosts } from '../../../../_helpers/costAccess'
import { costPlusEnabled, costToggleOff } from '../../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

/** GET /api/cpq/inventory/assets/{assetId}/costs: the costs an asset owns (and `ownerItemId` when its item owns them). */
export const metadata = { GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] } }

const pathParams = z.object({ assetId: z.string().uuid() })
const queryParams = z.object({ includeEnded: z.enum(['true', 'false']).optional().default('false') })

export async function GET(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { assetId } = pathParams.parse(await params)
    const query = queryParams.parse({ includeEnded: new URL(req.url).searchParams.get('includeEnded') ?? undefined })
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const view = await canViewCosts(ctx)
    return NextResponse.json(await readAssetCosts(ctx.em, assetId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, { canViewCosts: view, includeEnded: query.includeEnded === 'true' }))
  } catch (error) { return handleArcError(error, 'cpq/inventory/assets/[assetId]/costs.GET') }
}

const statusCost = z.object({ id: z.string().uuid(), costKey: z.string(), name: z.string(), role: z.string(), costType: z.string(), valueStatus: z.string(), status: z.string() })
const readResponse = z.object({
  assetId: z.string().uuid(),
  assetStatus: z.string(),
  ownerItemId: z.string().uuid().nullable(),
  currencyCode: z.string().optional(),
  costs: z.array(statusCost.passthrough()),
  margin: z.record(z.string(), z.unknown()).nullable().optional(),
}).describe('ownerItemId is set when the asset was created with its own item (ARC add) and that item owns the costs; costs is then empty. Without cpq.costs.view only id, costKey, name, role, costType, valueStatus and status per cost; with it also currencyCode, values, startedAt, endedAt, lastChangeId and margin')

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Costs', pathParams, methods: { GET: {
  summary: 'Read the inventory costs of an asset (status only without cpq.costs.view)',
  query: queryParams,
  responses: [{ status: 200, description: 'Asset-owned costs and ownerItemId; margin for cpq.costs.view holders', schema: readResponse }],
  errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(401, 'Unauthorized'), cpqErrorDoc(403, 'Missing permission'), cpqErrorDoc(404, 'Asset not found, also returned while the tenant toggle cpq.cost_plus is off')],
} } }
