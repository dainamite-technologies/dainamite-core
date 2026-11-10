import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqConvertQuoteToOrderSchema } from '../../data/validators'
import { isOrderError } from '../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../services/cpqOrderService'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../_helpers/quoteMutationGuard'

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

    // Conversion turns a quote into an order — projects can block it (e.g.
    // until an approval workflow has signed a discounted quote off).
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_RESOURCE_KIND,
      resourceId: body.quoteId,
      operation: 'custom',
      mutationPayload: { action: 'convert_to_order' },
    })
    if (!guard.ok) return guard.response

    const service = ctx.container.resolve('cpqOrderService') as DefaultCpqOrderService
    const result = await service.convertQuoteToOrder(body.quoteId, scope)
    await guard.runAfterSuccess()
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
  if (isOrderError(err)) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  const errObj = err as Record<string, unknown>
  if (typeof errObj?.status === 'number' && typeof errObj?.error === 'string') {
    return NextResponse.json({ error: errObj.error }, { status: errObj.status as number })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export const openApi = {
  '/api/cpq/orders': {
    post: {
      tags: ['CPQ Orders'],
      summary: 'Convert a CPQ quote into an order',
      description:
        'Creates the sales order and CPQ order configuration from the quote. Refused for cancelled or rejected quotes; mutation guards (resource kind `cpq.quote`, action `convert_to_order`) run first.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['quoteId'],
              properties: { quoteId: { type: 'string', format: 'uuid' } },
            },
          },
        },
      },
      responses: {
        '201': { description: 'Created order' },
        '400': { description: 'Validation error' },
        '404': { description: 'Quote not found' },
        '409': { description: 'Quote cannot be converted in its status or is already converted' },
        '422': { description: 'Quote has no lines, or blocked by a mutation guard' },
      },
    },
    get: {
      tags: ['CPQ Orders'],
      summary: 'List CPQ orders',
      parameters: [
        { name: 'customerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'sourceQuoteId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'salesOrderId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'cpqStatus', in: 'query', schema: { type: 'string' } },
        { name: 'currencyCode', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        {
          name: 'sortField',
          in: 'query',
          schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'cpqStatus', 'activatedAt', 'currencyCode'] },
        },
        { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      ],
      responses: {
        '200': { description: 'Paged list of CPQ orders' },
      },
    },
  },
}
