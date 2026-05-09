import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import {
  cpqInventoryAssetCreateSchema,
  cpqInventoryAssetUpdateSchema,
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
      const result = await service.getAsset(id, scope)
      return NextResponse.json(result)
    }

    const filters: Record<string, unknown> = {}
    const customerId = url.searchParams.get('customerId')
    if (customerId) filters.customerId = customerId
    const status = url.searchParams.get('status')
    if (status) filters.status = status
    const assetType = url.searchParams.get('assetType')
    if (assetType) filters.assetType = assetType
    const productId = url.searchParams.get('productId')
    if (productId) filters.productId = productId
    const subscriptionId = url.searchParams.get('subscriptionId')
    if (subscriptionId) filters.subscriptionId = subscriptionId
    const subscriptionItemId = url.searchParams.get('subscriptionItemId')
    if (subscriptionItemId) filters.subscriptionItemId = subscriptionItemId
    filters.page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    filters.pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '50')))

    const result = await service.listAssets(filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/inventory/assets.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventoryAssetCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.createAsset(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/assets.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventoryAssetUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.updateAsset(id, updates, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/assets.PUT]', err)
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

    await service.deleteAsset(id, scope)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/inventory/assets.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
