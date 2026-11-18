import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../../context'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { customerId } = await params
    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const filters: Record<string, unknown> = {}
    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    const offeringId = url.searchParams.get('offeringId')
    if (offeringId) filters.offeringId = offeringId

    const result = await service.getCustomerParentItems(customerId, filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/inventory/customer/parent-items.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ customer parent items',
  pathParams: z.object({ customerId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List subscription items of a customer that can act as parents for add-ons',
      description: 'Used when configuring a child line on a quote that must attach to an item the customer already owns.',
      query: z.object({
        productId: z.string().uuid().optional(),
        offeringId: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: 'Candidate parent items' }],
      errors: [cpqErrorDoc(500, 'Internal error')],
    },
  },
}
