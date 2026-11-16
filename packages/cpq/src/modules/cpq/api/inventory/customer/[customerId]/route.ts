import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../context'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { customerId } = await params
    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const filters: Record<string, unknown> = {}
    const status = url.searchParams.get('status')
    if (status) filters.status = status
    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    filters.includeTerminated = url.searchParams.get('includeTerminated') === 'true'

    const result = await service.getCustomerInventory(customerId, filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/inventory/customer.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ customer inventory',
  pathParams: z.object({ customerId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get the installed base (subscriptions and assets) of a customer',
      description: 'Terminated records are excluded unless `includeTerminated=true`.',
      query: z.object({
        status: z.string().optional(),
        productId: z.string().uuid().optional(),
        includeTerminated: z.enum(['true', 'false']).optional(),
      }),
      responses: [{ status: 200, description: 'Customer inventory' }],
      errors: [cpqErrorDoc(500, 'Internal error')],
    },
  },
}
