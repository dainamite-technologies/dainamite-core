import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqQuoteLineCostDeleteSchema, cpqQuoteLineCostUpdateSchema } from '../../../../../data/quote-costs'
import { costCommandRoute } from '../../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_COST_RESOURCE_KIND } from '../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] },
}
const pathParams = z.object({ quoteId: z.string().uuid(), costId: z.string().uuid() })
type Params = { params: Promise<{ quoteId: string; costId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqQuoteLineCostUpdateSchema.parse(await req.json())
    return await costCommandRoute(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.update', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, operation: 'update',
      body, schema: cpqQuoteLineCostUpdateSchema, ownedKeys: [], buildInput: (patch) => ({ quoteId, costId, patch }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId].PATCH') }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, costId } = pathParams.parse(await params)
    const body = cpqQuoteLineCostDeleteSchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    return await costCommandRoute(req, ctx, {
      quoteId, commandId: 'cpq.quote_line_cost.delete', resourceKind: CPQ_QUOTE_LINE_COST_RESOURCE_KIND, resourceId: costId, operation: 'delete',
      body, schema: cpqQuoteLineCostDeleteSchema, ownedKeys: [], buildInput: (effective) => ({ quoteId, costId, ...effective }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/costs/[costId].DELETE') }
}

const toggleOff = cpqErrorDoc(404, 'Quote or cost line not found — also returned while the tenant toggle cpq.cost_plus is off')
const writeResponse = z.object({ cost: z.record(z.string(), z.unknown()).nullable(), pricingRevision: z.number(), margin: z.record(z.string(), z.unknown()).optional() })
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams, methods: {
  PATCH: { summary: 'Edit, enter or confirm the value of a quote cost line', requestBody: { schema: cpqQuoteLineCostUpdateSchema },
    responses: [{ status: 200, description: 'Updated cost line, margin (cpq.costs.view only) and new pricing revision', schema: writeResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), toggleOff,
      cpqErrorDoc(409, 'COST_LOCKED (price-basis change while locked; margin-only, confirmation and validity changes are exempt) or STALE_REVISION'),
      cpqErrorDoc(422, 'NOTE_REQUIRED, VALIDITY_EVIDENCE_REQUIRED, FIELD_NOT_ALLOWED, LINE_NOT_ELIGIBLE, AMOUNT_REQUIRED, CURRENCY_NO_RATE, PRICE_BASIS_REQUIRES_COST_PLUS or a mutation-guard rejection')] },
  DELETE: { summary: 'Delete a manual quote cost line', query: cpqQuoteLineCostDeleteSchema,
    responses: [{ status: 200, description: 'Margin (cpq.costs.view only) and new pricing revision', schema: writeResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), toggleOff, cpqErrorDoc(409, 'COST_LOCKED or STALE_REVISION'),
      cpqErrorDoc(422, 'CATALOG_COST_NOT_DELETABLE (catalog lines follow the catalog; set the value instead) or a mutation-guard rejection')] },
} }
