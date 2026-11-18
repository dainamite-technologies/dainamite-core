import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveCpqRouteContext } from '../../../../../context'
import { resolveQuotingService } from '../../../../../resolveQuotingService'
import { CPQ_QUOTE_LINE_RESOURCE_KIND, runCpqMutationGuards } from '../../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../../_helpers/quoteRouteOpenApi'
import { handleArcError } from '../../../../../_helpers/handleArcError'
import { resolveAuditActor } from '../../../../../../lib/auditActor'

/**
 * `cpq.quotes.manage` is enforced by the dispatcher. The ARC feature that matches the quote's type
 * (`cpq.arc.amend.manage` / `cpq.arc.renew.manage`) is checked by the service, because only it knows the type:
 * the route resolves which of the two the caller holds and passes them along.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.quotes.manage'] },
}

const pathParams = z.object({ quoteId: z.string().uuid(), lineId: z.string().uuid() })
const bodySchema = z.object({ expectedRevision: z.coerce.number().int().min(0).optional() }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ quoteId: string; lineId: string }> }) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { quoteId, lineId } = pathParams.parse(await params)
    const rawBody = await req.text()
    const body = bodySchema.parse(rawBody.trim() ? JSON.parse(rawBody) : {})
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const rbac = ctx.container.resolve<RbacService>('rbacService')
    const featureScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId || null }
    const allowedTypes: Array<'amend' | 'renew'> = []
    if (await rbac.userHasAllFeatures(ctx.auth.sub, ['cpq.arc.amend.manage'], featureScope)) allowedTypes.push('amend')
    if (await rbac.userHasAllFeatures(ctx.auth.sub, ['cpq.arc.renew.manage'], featureScope)) allowedTypes.push('renew')
    if (allowedTypes.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_QUOTE_LINE_RESOURCE_KIND,
      resourceId: lineId,
      operation: 'update',
      mutationPayload: { quoteId, refreshFromSubscription: true },
    })
    if (!guard.ok) return guard.response

    const service = resolveQuotingService(ctx)
    const result = await service.refreshMirrorFromSubscription(quoteId, lineId, scope, resolveAuditActor(ctx.auth), body.expectedRevision, allowedTypes)
    await guard.runAfterSuccess()
    return NextResponse.json(result)
  } catch (err) {
    return handleArcError(err, 'cpq/quotes/[quoteId]/items/[lineId]/refresh-from-subscription.POST')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'CPQ Quotes',
  summary: 'Refresh an Amend / Renew line from its subscription item',
  pathParams,
  methods: {
    POST: {
      summary: 'Re-mirror one standalone Amend / Renew line from its live subscription item',
      description:
        'Rebuilds the line from the subscription item: configuration, quantity, stored charges and the carried costs (fresh carry hashes, so a stale-cost conversion / activation refusal clears). The line\'s previous cost lines are soft-deleted and their open cost requests cancelled (`reconfigured`, one `request_cancelled` signal each, published after commit). Needs `cpq.quotes.manage` plus the ARC feature matching the quote type (`cpq.arc.amend.manage` or `cpq.arc.renew.manage`, checked in the handler: 403 otherwise). Works with the `cpq.cost_plus` toggle off (the carried rows exist regardless). `expectedRevision` is optional (STALE_REVISION on a mismatch). Mutation guards run first (resource kind `cpq.quote_line`, update).',
      requestBody: { schema: bodySchema, description: 'Optional body; an empty body is accepted' },
      responses: [{ status: 200, description: 'The quote after the refresh (QuoteResult)' }],
      errors: [
        cpqErrorDoc(400, 'Validation error'),
        cpqErrorDoc(403, 'Missing the ARC feature of the quote type'),
        cpqErrorDoc(404, 'Quote or line not found'),
        cpqErrorDoc(409, 'COST_LOCKED (the line is priced from costs and the quote is cost-locked), STALE_REVISION, ITEM_NOT_ACTIVE (the subscription item ended), or the quote is terminal / the line is marked for removal'),
        cpqErrorDoc(422, 'NOT_ARC_MIRROR (not an Amend / Renew mirror line), MERGE_LINE (a merge-renew line has no subscription item to refresh from) or a mutation-guard rejection'),
      ],
    },
  },
}
