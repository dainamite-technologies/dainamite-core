import { NextResponse } from 'next/server'
import { cpqContextError, resolveCpqRouteContext } from '../../../context'
import { cpqAddQuoteItemSchema } from '../../../../data/validators'
import { resolveQuotingService } from '../../../resolveQuotingService'
import { handleArcError } from '../../../_helpers/handleArcError'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CPQ_GUARDED_WRITE_ERRORS, cpqErrorDoc, cpqQuoteIdPathParams } from '../../../_helpers/quoteRouteOpenApi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    const contextError = cpqContextError(ctx)
    if (contextError) return contextError

    const { quoteId } = await params
    const body = cpqAddQuoteItemSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      operation: 'create',
      mutationPayload: { quoteId, ...body },
    })
    if (!guard.ok) return guard.response
    const effective = guard.modifiedPayload
      ? cpqAddQuoteItemSchema.parse({ ...body, ...guard.modifiedPayload })
      : body

    const service = resolveQuotingService(ctx)
    const result = await service.addQuoteItem(quoteId, effective, scope)
    await guard.runAfterSuccess()
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/items.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'CPQ quote lines',
  pathParams: cpqQuoteIdPathParams,
  methods: {
    POST: {
      summary: 'Add a configured line to a CPQ quote',
      description:
        'Prices the line and recalculates the quote. Mutation guards run first (resource kind `cpq.quote_line`, create). `_arc*` configuration keys are server-owned and ignored. An offering with `isSellable: false` is component-only: adding it without `parentLineId` returns 422 `V-QLINE-1` (`code`, `offeringId` in the body).',
      requestBody: { schema: cpqAddQuoteItemSchema },
      responses: [{ status: 201, description: 'Quote after the line was added' }],
      errors: [
        ...CPQ_GUARDED_WRITE_ERRORS.filter((doc) => doc.status !== 422),
        cpqErrorDoc(422, 'Blocked by a mutation guard, or `V-QLINE-1`: a component-only offering (`isSellable: false`) added without `parentLineId`'),
      ],
    },
  },
}
