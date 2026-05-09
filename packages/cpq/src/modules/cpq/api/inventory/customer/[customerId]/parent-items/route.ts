import { NextResponse } from 'next/server'
import { resolveCpqRouteContext } from '../../../../context'

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
