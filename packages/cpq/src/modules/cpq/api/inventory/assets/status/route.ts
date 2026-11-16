import { NextResponse } from 'next/server'
import { handleArcError } from '../../../_helpers/handleArcError'
import { resolveCpqRouteContext } from '../../../context'
import { cpqInventoryStatusTransitionSchema } from '../../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventoryStatusTransitionSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.transitionAssetStatus(body.id, body.targetStatus, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/assets/status.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ asset status',
  methods: {
    POST: {
      summary: 'Transition an inventory asset to another status',
      description: 'Validates the transition against the asset state machine.',
      requestBody: { schema: cpqInventoryStatusTransitionSchema },
      responses: [{ status: 200, description: 'Asset with its new status' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(409, 'Transition not allowed'),
        cpqErrorDoc(404, 'Asset not found'), cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
