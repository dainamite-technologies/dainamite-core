import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveCpqRouteContext } from '../../../../context'
import { cpqOrderLineCostReconfirmSchema } from '../../../../../data/order-costs'
import { readOrderCosts, redactedOrderCostView, type OrderCostsRead } from '../../../../../services/costs/orderCostView'
import type { OrderCostReconfirmResult } from '../../../../../services/costs/orderCostReconfirm'
import { canViewCosts } from '../../../../_helpers/costAccess'
import { costPlusEnabled, costToggleOff } from '../../../../_helpers/costCommandRoute'
import { handleArcError } from '../../../../_helpers/handleArcError'
import { CPQ_ORDER_LINE_COST_RESOURCE_KIND, runCpqMutationGuards } from '../../../../_helpers/quoteMutationGuard'
import { cpqErrorDoc } from '../../../../_helpers/quoteRouteOpenApi'

/**
 * PATCH /api/cpq/orders/{orderId}/costs/{orderLineCostId}: post-conversion cost re-confirmation (ARC costs Q-D13).
 * Margin only: the order's charges and totals never change, and no event is emitted (Q12).
 */
export const metadata = { PATCH: { requireAuth: true, requireFeatures: ['cpq.orders.manage', 'cpq.costs.manage'] } }

const pathParams = z.object({ orderId: z.string().uuid(), orderLineCostId: z.string().uuid() })
type Params = { params: Promise<{ orderId: string; orderLineCostId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { orderId, orderLineCostId } = pathParams.parse(await params)
    const body = cpqOrderLineCostReconfirmSchema.parse(await req.json())
    if (!(await costPlusEnabled(ctx))) return costToggleOff()
    const guard = await runCpqMutationGuards(ctx, req, {
      resourceKind: CPQ_ORDER_LINE_COST_RESOURCE_KIND, resourceId: orderLineCostId, operation: 'update',
      mutationPayload: { orderId, orderLineCostId, ...body },
    })
    if (!guard.ok) return guard.response
    // A guard may adjust the patch, never the path identifiers.
    const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => key !== 'orderId' && key !== 'orderLineCostId'))
    const patch = cpqOrderLineCostReconfirmSchema.parse({ ...body, ...modified })
    const commandCtx: CommandRuntimeContext = {
      container: ctx.container, auth: ctx.auth, organizationScope: ctx.organizationScope,
      selectedOrganizationId: ctx.organizationId, organizationIds: [ctx.organizationId], request: req,
    }
    const bus = ctx.container.resolve<CommandBus>('commandBus')
    const { result } = await bus.execute<Record<string, unknown>, OrderCostReconfirmResult>('cpq.order_line_cost.reconfirm', { input: { orderId, orderLineCostId, patch }, ctx: commandCtx })
    if (!result) throw new Error('Re-confirm command did not return a result')
    await guard.runAfterSuccess()
    // I-4: only holders of cpq.costs.view see values and the margin; the order margin is computed on read, never stored.
    if (!(await canViewCosts(ctx))) return NextResponse.json({ cost: redactedOrderCostView(result.cost as never) })
    const read: OrderCostsRead = await readOrderCosts(ctx.em, result.orderId, { organizationId: ctx.organizationId, tenantId: ctx.tenantId }, true)
    return NextResponse.json({ cost: result.cost, orderMargin: read.margin ?? null })
  } catch (error) { return handleArcError(error, 'cpq/orders/costs/[orderLineCostId].PATCH') }
}

const writeResponse = z.object({
  cost: z.record(z.string(), z.unknown()),
  orderMargin: z.record(z.string(), z.unknown()).nullable().optional(),
}).describe('Without cpq.costs.view: the status-only cost (id, costKey, name, role, costType, valueStatus) and no orderMargin. With it: the full cost (values, fx snapshot, supplier, validity) and the order margin recomputed on read')

export const openApi: OpenApiRouteDoc = { tag: 'CPQ Costs', pathParams, methods: {
  PATCH: {
    summary: 'Re-confirm the value, currency, supplier or validity of an order line cost before the order is activated (margin only; order charges and totals never change)',
    description: 'Runs in its own transaction under the source quote lock that activation also takes (lock order: source quote first, order row read unlocked), so it is serialized with activation. total_amount is recomputed (instance x fx_rate x quantity); reconfirmed_at / reconfirmed_by_user_id are set; no event is emitted. A changed value needs a new supplierQuoteRef or a note. At activation the subscription item cost takes the re-confirmed value. Mutation guards run with resource kind cpq.order_line_cost.',
    requestBody: { schema: cpqOrderLineCostReconfirmSchema },
    responses: [{ status: 200, description: 'The re-confirmed order line cost and (cpq.costs.view only) the order margin', schema: writeResponse }],
    errors: [cpqErrorDoc(400, 'Validation error'), cpqErrorDoc(403, 'Missing permission'),
      cpqErrorDoc(404, 'Order or order line cost not found, also returned while the tenant toggle cpq.cost_plus is off'),
      cpqErrorDoc(409, 'ORDER_ACTIVATED (the order is active or fulfilled, nothing written) or ORDER_CANCELLED'),
      cpqErrorDoc(422, 'CURRENCY_NO_RATE (no rate for a foreign currency; carries from / to), NOTE_REQUIRED (changed value without a new supplierQuoteRef or note), VALIDITY_EVIDENCE_REQUIRED, LINE_NOT_ELIGIBLE or a mutation-guard rejection')],
  },
} }
