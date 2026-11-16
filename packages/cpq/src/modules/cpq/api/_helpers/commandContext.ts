import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { NextResponse } from 'next/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CpqRouteContext } from '../context'

/**
 * Command runtime context for a CPQ route. Used both for CPQ's own commands
 * and for commands owned by other modules (sales, catalog), so writes to
 * their entities run their events, audit log, undo and side effects.
 */
export function buildCpqCommandContext(ctx: CpqRouteContext, req: Request): CommandRuntimeContext {
  return {
    container: ctx.container,
    auth: ctx.auth,
    organizationScope: ctx.organizationScope,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
    request: req,
  }
}

export function resolveCommandBus(ctx: CpqRouteContext): CommandBus {
  return ctx.container.resolve<CommandBus>('commandBus')
}

/**
 * Maps an HTTP error thrown by another module's command (403 scope, 404,
 * 409 duplicate, 400 validation) to a response. Returns null for anything
 * else so the route keeps its own fallback.
 */
export function commandErrorResponse(err: unknown): NextResponse | null {
  // A command interceptor rejection (e.g. CPQ's 409 for terminal quotes on
  // `sales.quotes.delete`) carries its own status and body.
  const rejection = getCommandInterceptorHttpRejection(err)
  if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
  if (!isCrudHttpError(err)) return null
  const body = err.body && typeof err.body === 'object' ? err.body : { error: err.message }
  return NextResponse.json(body, { status: err.status })
}
