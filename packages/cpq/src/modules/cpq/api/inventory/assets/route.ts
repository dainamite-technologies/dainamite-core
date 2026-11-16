import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import {
  cpqInventoryAssetCreateSchema,
  cpqInventoryAssetUpdateSchema,
} from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema } from '../../_helpers/quoteRouteOpenApi'

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
    const search = url.searchParams.get('search')
    if (search) filters.search = search

    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name', 'status', 'assetType', 'purchasePrice'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    if ((ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)) {
      filters.sortField = sortFieldParam
    }
    filters.sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

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

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ inventory assets',
  methods: {
    GET: {
      summary: 'List customer assets in CPQ inventory, or get one by id',
      description: 'With `id` returns a single asset; otherwise a paged list.',
      query: cpqPaginationQuery.extend({
        id: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        status: z.string().optional(),
        assetType: z.string().optional(),
        productId: z.string().uuid().optional(),
        subscriptionId: z.string().uuid().optional(),
        subscriptionItemId: z.string().uuid().optional(),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name', 'status', 'assetType', 'purchasePrice']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: 'Asset, or paged list of assets' }],
      errors: [cpqErrorDoc(500, 'Internal error (also returned when `id` does not exist)')],
    },
    POST: {
      summary: 'Create an asset in CPQ inventory',
      requestBody: { schema: cpqInventoryAssetCreateSchema },
      responses: [{ status: 201, description: 'Created asset' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(500, 'Internal error (also returned when the linked subscription or item does not exist)'),
      ],
    },
    PUT: {
      summary: 'Update an asset in CPQ inventory',
      description: 'Status changes go through `POST /api/cpq/inventory/assets/status`.',
      requestBody: { schema: cpqInventoryAssetUpdateSchema },
      responses: [{ status: 200, description: 'Updated asset' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(500, 'Internal error (also returned when the asset does not exist)'),
      ],
    },
    DELETE: {
      summary: 'Delete an asset from CPQ inventory',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: [
        cpqErrorDoc(400, 'Missing id'),
        cpqErrorDoc(500, 'Internal error (also returned when the asset does not exist)'),
      ],
    },
  },
}
