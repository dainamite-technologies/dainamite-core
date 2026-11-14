import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqConvertQuoteToOrderSchema } from '../../data/validators'
import { isOrderError } from '../../services/cpqOrderService'
import type { DefaultCpqOrderService } from '../../services/cpqOrderService'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc } from '../_helpers/quoteRouteOpenApi'

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
    return NextResponse.json({ error: err.message, ...err.details }, { status: err.status })
  }
  const errObj = err as Record<string, unknown>
  if (typeof errObj?.status === 'number' && typeof errObj?.error === 'string') {
    return NextResponse.json({ error: errObj.error }, { status: errObj.status as number })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Orders',
  summary: 'CPQ orders',
  methods: {
    POST: {
      summary: 'Convert a CPQ quote into an order',
      description:
        'Creates the sales order and CPQ order configuration from the quote. Refused for cancelled or rejected quotes; mutation guards (resource kind `cpq.quote`, action `convert_to_order`) run first.',
      requestBody: { schema: cpqConvertQuoteToOrderSchema },
      responses: [{ status: 201, description: 'Created order' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Quote cannot be converted in its status or is already converted'),
        cpqErrorDoc(422, 'Quote has no lines, has invalid stored adjustments, or COSTS_NOT_CONFIRMED (a price-basis cost is not confirmed or has expired, or a cost-plus charge has no price; body `lines: [{ quoteLineId, costKeys, chargeCodes }]` names the blocking cost keys and the unpriced cost-plus charge codes per line, either list may be empty; ARC cancel lines never block), or blocked by a mutation guard'),
      ],
    },
    GET: {
      summary: 'List CPQ orders',
      query: z.object({
        customerId: z.string().uuid().optional(),
        sourceQuoteId: z.string().uuid().optional(),
        salesOrderId: z.string().uuid().optional(),
        cpqStatus: z.string().optional(),
        currencyCode: z.string().optional(),
        search: z.string().optional(),
        sortField: z.enum(['createdAt', 'updatedAt', 'cpqStatus', 'activatedAt', 'currencyCode']).optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      }),
      responses: [{ status: 200, description: 'Paged list of CPQ orders' }],
    },
  },
}
