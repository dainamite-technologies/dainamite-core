import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../context'
import {
  cpqInventorySubscriptionItemCreateSchema,
  cpqInventorySubscriptionItemUpdateSchema,
} from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqDeleteByIdBody, cpqSuccessResponseSchema } from '../../_helpers/quoteRouteOpenApi'

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

    const subscriptionId = url.searchParams.get('subscriptionId')
    const parentItemId = url.searchParams.get('parentItemId')
    if (!subscriptionId && !parentItemId) {
      return NextResponse.json(
        { error: 'At least one of subscriptionId or parentItemId is required' },
        { status: 400 },
      )
    }

    const filters: Record<string, unknown> = {}
    if (subscriptionId) filters.subscriptionId = subscriptionId
    if (parentItemId) filters.parentItemId = parentItemId
    const status = url.searchParams.get('status')
    if (status) filters.status = status

    const result = await service.listSubscriptionItems(filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cpq/inventory/subscription-items.GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventorySubscriptionItemCreateSchema.parse(await req.json())
    const { subscriptionId, ...input } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.addSubscriptionItem(subscriptionId, input, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/subscription-items.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqInventorySubscriptionItemUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.updateSubscriptionItem(id, updates, scope)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    console.error('[cpq/inventory/subscription-items.PUT]', err)
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

    await service.deleteSubscriptionItem(id, scope)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cpq/inventory/subscription-items.DELETE]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ inventory subscription items',
  methods: {
    GET: {
      summary: 'List the items of a subscription, or the children of a parent item',
      description: 'At least one of `subscriptionId` or `parentItemId` is required.',
      query: z.object({
        subscriptionId: z.string().uuid().optional(),
        parentItemId: z.string().uuid().optional(),
        status: z.string().optional(),
      }),
      responses: [{ status: 200, description: 'Subscription items' }],
      errors: [
        cpqErrorDoc(400, 'At least one of subscriptionId or parentItemId is required'),
        cpqErrorDoc(500, 'Internal error'),
      ],
    },
    POST: {
      summary: 'Add an item to a subscription in CPQ inventory',
      requestBody: { schema: cpqInventorySubscriptionItemCreateSchema },
      responses: [{ status: 201, description: 'Created subscription item' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(500, 'Internal error (also returned when the subscription or parent item does not exist)'),
      ],
    },
    PUT: {
      summary: 'Update a subscription item in CPQ inventory',
      requestBody: { schema: cpqInventorySubscriptionItemUpdateSchema },
      responses: [{ status: 200, description: 'Updated subscription item' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(500, 'Internal error (also returned when the item does not exist)'),
      ],
    },
    DELETE: {
      summary: 'Delete a subscription item from CPQ inventory',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: [
        cpqErrorDoc(400, 'Missing id'),
        cpqErrorDoc(500, 'Internal error (also returned when the item does not exist)'),
      ],
    },
  },
}
