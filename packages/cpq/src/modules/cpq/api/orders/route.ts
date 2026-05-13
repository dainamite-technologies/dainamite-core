import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqConvertQuoteToOrderSchema } from '../../data/validators'
import { OrderError } from '../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../services/cpqOrderService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.orders.manage'] },
  GET: { requireAuth: true, requireFeatures: ['cpq.orders.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqConvertQuoteToOrderSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.convertQuoteToOrder(body.quoteId, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleError(err, 'cpq/orders.POST')
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }
    const url = new URL(req.url)
    const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'cpqStatus', 'activatedAt', 'currencyCode'] as const
    const sortFieldParam = url.searchParams.get('sortField') ?? ''
    const sortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(sortFieldParam)
      ? (sortFieldParam as (typeof ALLOWED_SORT_FIELDS)[number])
      : undefined
    const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

    const filters = {
      customerId: url.searchParams.get('customerId') ?? undefined,
      sourceQuoteId: url.searchParams.get('sourceQuoteId') ?? undefined,
      salesOrderId: url.searchParams.get('salesOrderId') ?? undefined,
      cpqStatus: url.searchParams.get('cpqStatus') ?? undefined,
      currencyCode: url.searchParams.get('currencyCode') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      sortField,
      sortDir,
      page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
      pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
    } as const

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.listOrders(filters, scope)
    return NextResponse.json(result)
  } catch (err) {
    return handleError(err, 'cpq/orders.GET')
  }
}

function handleError(err: unknown, context: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
  }
  if (err instanceof OrderError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  const errObj = err as Record<string, unknown>
  if (typeof errObj?.status === 'number' && typeof errObj?.error === 'string') {
    return NextResponse.json({ error: errObj.error }, { status: errObj.status as number })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
