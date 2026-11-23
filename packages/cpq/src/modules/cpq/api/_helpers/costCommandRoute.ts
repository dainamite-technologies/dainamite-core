import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CpqRouteContext } from '../context'
import type { CpqCostService } from '../../services/costs/costService'
import type { MarkupOverrideWriteResult, QuoteCostWriteResult } from '../../services/costs/quoteCostService'
import { canViewCosts } from './costAccess'
import { runCpqMutationGuards } from './quoteMutationGuard'

/** `404` while the tenant toggle `cpq.cost_plus` is off (feature spec Q8). */
export const costToggleOff = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function costPlusEnabled(ctx: CpqRouteContext): Promise<boolean> {
  return ctx.container.resolve<CpqCostService>('cpqCostService').enabled(ctx.tenantId)
}

type Options<T extends object> = {
  quoteId: string
  commandId: string
  resourceKind: string
  resourceId?: string
  operation: 'create' | 'update' | 'delete'
  body: T
  schema: z.ZodType<T>
  /** Path identifiers the route owns: a guard may not replace them. */
  ownedKeys: string[]
  buildInput: (effective: T) => Record<string, unknown>
  status: number
}

const REDACTED_COST_KEYS = ['id', 'costKey', 'name', 'role', 'valueStatus', 'expired', 'error'] as const

/**
 * Shared shape of the cost write routes: toggle -> mutation guards -> command
 * bus -> after-success hook -> response. The response carries amounts and
 * margin only for holders of `cpq.costs.view` (App Spec §1.4.10).
 */
export async function costCommandRoute<T extends object>(req: Request, ctx: CpqRouteContext, options: Options<T>): Promise<NextResponse | Response> {
  if (!(await costPlusEnabled(ctx))) return costToggleOff()
  const guard = await runCpqMutationGuards(ctx, req, {
    resourceKind: options.resourceKind, resourceId: options.resourceId, operation: options.operation,
    mutationPayload: { quoteId: options.quoteId, ...options.body },
  })
  if (!guard.ok) return guard.response
  const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => key !== 'quoteId' && !options.ownedKeys.includes(key)))
  const effective = options.schema.parse({ ...options.body, ...modified })
  const commandCtx: CommandRuntimeContext = {
    container: ctx.container, auth: ctx.auth, organizationScope: ctx.organizationScope,
    selectedOrganizationId: ctx.organizationId, organizationIds: [ctx.organizationId], request: req,
  }
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  const { result } = await bus.execute<Record<string, unknown>, QuoteCostWriteResult & MarkupOverrideWriteResult>(options.commandId, { input: options.buildInput(effective), ctx: commandCtx })
  if (!result) throw new Error('Cost command did not return a result')
  await guard.runAfterSuccess()
  const view = await canViewCosts(ctx)
  const payload: Record<string, unknown> = { pricingRevision: result.pricingRevision }
  if ('cost' in result) {
    payload.cost = view || !result.cost ? result.cost : Object.fromEntries(REDACTED_COST_KEYS.filter((key) => key in result.cost!).map((key) => [key, (result.cost as unknown as Record<string, unknown>)[key]]))
  }
  if ('override' in result) payload.override = view || !result.override ? result.override : { id: result.override.id, quoteLineId: result.override.quoteLineId, chargeCode: result.override.chargeCode }
  if (view) payload.margin = result.margin
  return NextResponse.json(payload, { status: options.status })
}
