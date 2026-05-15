import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import {
  cpqInventorySubscriptionCreateSchema,
  cpqInventorySubscriptionUpdateSchema,
} from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const id = url.searchParams.get('id')
    if (id) {
      const result = await service.getSubscription(id, scope)
      return NextResponse.json(result)
    }

    const filters: Record<string, unknown> = {}
    const customerId = url.searchParams.get('customerId')
    if (customerId) filters.customerId = customerId
    const status = url.searchParams.get('status')
    if (status) filters.status = status.split(',')
    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    const sourceOrderId = url.searchParams.get('sourceOrderId')
    if (sourceOrderId) filters.sourceOrderId = sourceOrderId
    const billingCycle = url.searchParams.get('billingCycle')
    if (billingCycle) filters.billingCycle = billingCycle
    const search = url.searchParams.get('search')
    if (search) filters.search = search
    const expiringWithinDays = url.searchParams.get('expiringWithinDays')
    if (expiringWithinDays) {
      const n = Number(expiringWithinDays)
      if (Number.isFinite(n) && n > 0) filters.expiringWithinDays = Math.min(365, n)
    }

    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name', 'status', 'startDate', 'currentTermEnd'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    if ((ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)) {
      filters.sortField = sortFieldParam
    }
    filters.sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    filters.page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    filters.pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const result = await service.listSubscriptions(filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/inventory/subscriptions.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventorySubscriptionCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.createSubscription(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/subscriptions.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventorySubscriptionUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.updateSubscription(id, updates, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/subscriptions.PUT]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    await service.deleteSubscription(id, scope)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/inventory/subscriptions.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
