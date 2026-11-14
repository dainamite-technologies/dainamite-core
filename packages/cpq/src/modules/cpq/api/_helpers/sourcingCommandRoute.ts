import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CpqRouteContext } from '../context'
import { costPlusEnabled, costToggleOff } from './costCommandRoute'
import { runCpqMutationGuards } from './quoteMutationGuard'

type Options<T extends object, R extends object> = {
  quoteId: string
  commandId: string
  resourceKind: string
  resourceId?: string
  /** The route's action, passed to the mutation guards as `mutationPayload.action` (operation `custom`). */
  action: string
  body: T
  schema: z.ZodType<T>
  /** Path identifiers the route owns: a guard may not replace them. */
  ownedKeys: string[]
  buildInput: (effective: T) => Record<string, unknown>
  /** The whitelisted response body: the route picks the fields, a command result is never echoed whole. */
  respond: (result: R) => Record<string, unknown>
  /** `404` while `cpq.cost_plus` is off (answer / decline answer `409 COST_PLUS_DISABLED` instead). */
  toggleOff?: 'not_found' | 'skip'
}

/**
 * Shared shape of the custom sourcing write routes: toggle -> mutation guards (`custom`, `mutationPayload.action`)
 * -> command bus -> after-success hook -> whitelisted response. Responses of the request / cancel routes carry ids
 * and statuses only, so they are identical for callers with and without `cpq.costs.view`.
 */
export async function sourcingCommandRoute<T extends object, R extends object>(req: Request, ctx: CpqRouteContext, options: Options<T, R>): Promise<NextResponse | Response> {
  if (options.toggleOff !== 'skip' && !(await costPlusEnabled(ctx))) return costToggleOff()
  const guard = await runCpqMutationGuards(ctx, req, {
    resourceKind: options.resourceKind, resourceId: options.resourceId, operation: 'custom',
    mutationPayload: { quoteId: options.quoteId, action: options.action, ...options.body },
  })
  if (!guard.ok) return guard.response
  const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {}).filter(([key]) => key !== 'quoteId' && key !== 'action' && !options.ownedKeys.includes(key)))
  const effective = options.schema.parse({ ...options.body, ...modified })
  const commandCtx: CommandRuntimeContext = {
    container: ctx.container, auth: ctx.auth, organizationScope: ctx.organizationScope,
    selectedOrganizationId: ctx.organizationId, organizationIds: [ctx.organizationId], request: req,
  }
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  const { result } = await bus.execute<Record<string, unknown>, R>(options.commandId, { input: options.buildInput(effective), ctx: commandCtx })
  if (!result) throw new Error('Sourcing command did not return a result')
  await guard.runAfterSuccess()
  return NextResponse.json(options.respond(result), { status: 200 })
}
