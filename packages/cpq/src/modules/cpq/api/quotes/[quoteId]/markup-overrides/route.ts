import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../context'
import { cpqQuoteMarkupOverrideClearSchema, cpqQuoteMarkupOverrideSetSchema } from '../../../../data/quote-costs'
import { costCommandRoute } from '../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_QUOTE_MARKUP_OVERRIDE_RESOURCE_KIND } from '../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['cpq.quotes.manage', 'cpq.costs.manage'] },
}
type Params = { params: Promise<{ quoteId: string }> }

export async function PUT(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqQuoteMarkupOverrideSetSchema.parse(await req.json())
    return await costCommandRoute(req, ctx, {
      quoteId, commandId: 'cpq.quote_markup_override.set', resourceKind: CPQ_QUOTE_MARKUP_OVERRIDE_RESOURCE_KIND, operation: 'update',
      body, schema: cpqQuoteMarkupOverrideSetSchema, ownedKeys: [], buildInput: (override) => ({ quoteId, override }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/markup-overrides.PUT') }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId } = cpqQuoteIdPathParams.parse(await params)
    const body = cpqQuoteMarkupOverrideClearSchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    return await costCommandRoute(req, ctx, {
      quoteId, commandId: 'cpq.quote_markup_override.clear', resourceKind: CPQ_QUOTE_MARKUP_OVERRIDE_RESOURCE_KIND, operation: 'delete',
      body, schema: cpqQuoteMarkupOverrideClearSchema, ownedKeys: [], buildInput: (override) => ({ quoteId, override }), status: 200,
    })
  } catch (error) { return handleArcError(error, 'cpq/quotes/markup-overrides.DELETE') }
}

const toggleOff = cpqErrorDoc(404, 'Quote or markup override not found — also returned while the tenant toggle cpq.cost_plus is off')
const writeResponse = z.object({ override: z.record(z.string(), z.unknown()).nullable(), pricingRevision: z.number(), margin: z.record(z.string(), z.unknown()).optional() })
export const openApi: OpenApiRouteDoc = { tag: 'CPQ Quotes', pathParams: cpqQuoteIdPathParams, methods: {
  PUT: { summary: 'Set the markup of a cost-plus charge on one quote line', requestBody: { schema: cpqQuoteMarkupOverrideSetSchema },
    responses: [{ status: 200, description: 'Override (cpq.costs.view only), margin and new pricing revision; the quote is re-priced', schema: writeResponse }],
    errors: [cpqErrorDoc(400, 'Validation error (e.g. target margin >= 100)'), cpqErrorDoc(403, 'Missing permission'), toggleOff, cpqErrorDoc(409, 'COST_LOCKED or STALE_REVISION'),
      cpqErrorDoc(422, 'CHARGE_NOT_COST_PLUS, CHARGE_NOT_FOUND, LINE_NOT_ELIGIBLE or a mutation-guard rejection')] },
  DELETE: { summary: 'Clear a markup override', query: cpqQuoteMarkupOverrideClearSchema,
    responses: [{ status: 200, description: 'Margin (cpq.costs.view only) and new pricing revision; the quote is re-priced', schema: writeResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'), toggleOff, cpqErrorDoc(409, 'COST_LOCKED or STALE_REVISION'), cpqErrorDoc(422, 'Blocked by a mutation guard')] },
} }
