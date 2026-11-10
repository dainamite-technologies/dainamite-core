import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../context'
import { cpqRecalculateSchema } from '../../../../data/validators'
import { isQuotingError } from '../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { CPQ_QUOTE_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

// Recalculation re-resolves and (with `save: true`) persists prices, so it
// needs the same feature as any other quote write. The quote page always
// saves; viewers read stored prices through GET /api/cpq/quotes/{quoteId}.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId } = await params
    const body = cpqRecalculateSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    // Only a saved recalculation writes; a dry run needs no guard.
    const guard = body.save
      ? await runCpqMutationGuards(ctx, req, {
          resourceKind: CPQ_QUOTE_RESOURCE_KIND,
          resourceId: quoteId,
          operation: 'custom',
          mutationPayload: { action: 'recalculate' },
        })
      : null
    if (guard && !guard.ok) return guard.response

    const service = resolveQuotingService(ctx)
    const result = await service.recalculate(quoteId, body, scope)
    if (guard) await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
    }
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/recalculate.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote recalculation',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Re-price every line of a CPQ quote',
      description:
        'Re-resolves charges and price rules. With `save: true` the result is persisted (refused on accepted, rejected and cancelled quotes) and mutation guards (resource kind `cpq.quote`, action `recalculate`) run first. Frozen Amend mirror lines keep their stored price.',
      requestBody: { schema: cpqRecalculateSchema },
      responses: [{ status: 200, description: 'Recalculated quote' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(404, 'Quote not found'),
        cpqErrorDoc(409, 'Saved recalculation on a terminal quote'),
        cpqErrorDoc(422, 'Blocked by a mutation guard'),
      ],
    },
  },
}
