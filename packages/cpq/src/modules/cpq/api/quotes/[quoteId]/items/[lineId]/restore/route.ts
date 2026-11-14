import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../../../../../context'
import { isQuotingError } from '../../../../../../services/cpqQuotingService'
import { resolveQuotingService } from '../../../../../resolveQuotingService'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../../../_helpers/quoteMutationGuard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CPQ_GUARDED_WRITE_ERRORS } from '../../../../../_helpers/quoteRouteOpenApi'
import { resolveAuditActor } from '../../../../../../lib/auditActor'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string; lineId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { quoteId, lineId } = await params
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      resourceId: lineId,
      operation: 'update',
      mutationPayload: { quoteId, restore: true },
    })
    if (!guard.ok) return guard.response

    const service = resolveQuotingService(ctx)
    const result = await service.restoreQuoteItem(quoteId, lineId, scope, resolveAuditActor(ctx.auth))
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    if (isQuotingError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[cpq/quotes/[quoteId]/items/[lineId]/restore.POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'Restore a subscription item marked for removal',
  pathParams: z.object({ quoteId: z.string().uuid(), lineId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Restore a removed subscription item on an Amend / Renew quote',
      description:
        'Turns a `cancel` line that mirrors a live subscription item back into a `modify` line, rebuilt from the item (configuration, quantity, stored price). Its cancelled mirrored components are restored with it. 409 when the line is not a removed item, its parent is still removed, or the item is no longer active. Mutation guards run first (resource kind `cpq.quote_line`, update).',
      responses: [{ status: 200, description: 'Quote after the restore' }],
      errors: CPQ_GUARDED_WRITE_ERRORS.filter((doc) => doc.status !== 400),
    },
  },
}
