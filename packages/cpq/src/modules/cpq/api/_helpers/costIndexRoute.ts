import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CpqRouteContext } from '../context'
import type { CpqCostIndexService } from '../../services/costs/costIndexService'
import { costPlusEnabled, costToggleOff } from './costCommandRoute'
import { runCpqMutationGuards } from './quoteMutationGuard'

/** The request-scoped index service, or null while the tenant toggle `cpq.cost_plus` is off (every route then answers 404). */
export async function enabledIndexService(ctx: CpqRouteContext): Promise<CpqCostIndexService | null> {
  if (!(await costPlusEnabled(ctx))) return null
  return ctx.container.resolve<CpqCostIndexService>('cpqCostIndexService')
}

export const indexScope = (ctx: CpqRouteContext) => ({ organizationId: ctx.organizationId, tenantId: ctx.tenantId })
export { costToggleOff as indexToggleOff }

type Options<T extends object, R> = {
  commandId: string
  resourceKind: string
  resourceId?: string
  operation: 'create' | 'update' | 'delete'
  body: T
  schema: z.ZodType<T>
  /** Path identifiers the route owns: a guard may not replace them. */
  ownedKeys?: string[]
  buildInput: (effective: T) => Record<string, unknown>
  respond: (result: R) => unknown
  status: number
}

/**
 * Shared shape of the index write routes: toggle -> mutation guards -> command bus -> after-success hook -> response.
 * The caller has already authenticated; the dispatcher enforced `requireFeatures` (never `requireRoles`).
 */
export async function costIndexCommandRoute<T extends object, R>(req: Request, ctx: CpqRouteContext, options: Options<T, R>): Promise<NextResponse | Response> {
  if (!(await costPlusEnabled(ctx))) return costToggleOff()
  const guard = await runCpqMutationGuards(ctx, req, {
    resourceKind: options.resourceKind, resourceId: options.resourceId, operation: options.operation, mutationPayload: options.body as Record<string, unknown>,
  })
  if (!guard.ok) return guard.response
  const owned = options.ownedKeys ?? []
  const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => !owned.includes(key)))
  const effective = options.schema.parse({ ...options.body, ...modified })
  const commandCtx: CommandRuntimeContext = {
    container: ctx.container, auth: ctx.auth, organizationScope: ctx.organizationScope,
    selectedOrganizationId: ctx.organizationId, organizationIds: [ctx.organizationId], request: req,
  }
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  const { result } = await bus.execute<Record<string, unknown>, R>(options.commandId, { input: options.buildInput(effective), ctx: commandCtx })
  if (!result) throw new Error('Cost index command did not return a result')
  await guard.runAfterSuccess()
  return NextResponse.json(options.respond(result), { status: options.status })
}
