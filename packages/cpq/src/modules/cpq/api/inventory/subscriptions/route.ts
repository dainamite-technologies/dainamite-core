import { NextResponse } from 'next/server'
import { handleArcError } from '../../_helpers/handleArcError'
import { z } from 'zod'
import { cpqContextError, resolveCpqRouteContext } from '../../context'
import {
  cpqInventorySubscriptionCreateSchema,
  cpqInventorySubscriptionUpdateSchema,
} from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqPaginationQuery, cpqSortDirQuery, cpqDeleteByIdBody, cpqSuccessResponseSchema, CPQ_CRUD_WRITE_ERRORS } from '../../_helpers/quoteRouteOpenApi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cpq.inventory.view'] },
  POST: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.inventory.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

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
    return handleArcError(err, 'cpq/inventory/subscriptions.GET')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqInventorySubscriptionCreateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.createSubscription(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions.POST')
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const body = cpqInventorySubscriptionUpdateSchema.parse(await req.json())
    const { id, ...updates } = body
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    const result = await service.updateSubscription(id, updates, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions.PUT')
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { id } = (await req.json()) as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const service = ctx.container.resolve('cpqInventoryService') as any

    await service.deleteSubscription(id, scope)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleArcError(err, 'cpq/inventory/subscriptions.DELETE')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Inventory',
  summary: 'CPQ inventory subscriptions',
  methods: {
    GET: {
      summary: 'List customer subscriptions in CPQ inventory, or get one by id',
      description:
        'With `id` returns a single subscription; otherwise a paged list. `status` accepts a comma-separated list. `expiringWithinDays` (1 to 365) keeps subscriptions whose current term ends within that window.',
      query: cpqPaginationQuery.extend({
        id: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        status: z.string().optional(),
        productId: z.string().uuid().optional(),
        sourceOrderId: z.string().uuid().optional(),
        billingCycle: z.string().optional(),
        search: z.string().optional(),
        expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'code', 'name', 'status', 'startDate', 'currentTermEnd']).optional(),
        sortDir: cpqSortDirQuery,
      }),
      responses: [{ status: 200, description: 'Subscription, or paged list of subscriptions' }],
      errors: [cpqErrorDoc(404, 'Subscription not found'), cpqErrorDoc(500, 'Internal error')],
    },
    POST: {
      summary: 'Create a subscription in CPQ inventory',
      description: 'Manual creation. Subscriptions are normally provisioned by order activation.',
      requestBody: { schema: cpqInventorySubscriptionCreateSchema },
      responses: [{ status: 201, description: 'Created subscription' }],
      errors: CPQ_CRUD_WRITE_ERRORS,
    },
    PUT: {
      summary: 'Update a subscription in CPQ inventory',
      description: 'Status changes go through `POST /api/cpq/inventory/subscriptions/status`.',
      requestBody: { schema: cpqInventorySubscriptionUpdateSchema },
      responses: [{ status: 200, description: 'Updated subscription' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Subscription not found'), cpqErrorDoc(500, 'Internal error'),
      ],
    },
    DELETE: {
      summary: 'Delete a subscription from CPQ inventory',
      requestBody: { schema: cpqDeleteByIdBody },
      responses: [{ status: 200, description: 'Deleted', schema: cpqSuccessResponseSchema }],
      errors: [
        cpqErrorDoc(400, 'Missing id'),
        cpqErrorDoc(404, 'Subscription not found'), cpqErrorDoc(500, 'Internal error'),
      ],
    },
  },
}
