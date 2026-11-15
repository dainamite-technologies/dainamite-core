import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  organizationScopeRequiredResponse,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

/**
 * Shared handler for billing's custom POST action routes (Spec C payments,
 * Spec D memos): authenticates, resolves the organization, validates the
 * body, runs the shared mutation guards (record locks etc.) as `update` on
 * the target resource, executes the command and maps `CrudHttpError`s.
 *
 * `requireFeatures` stays on each route's exported `metadata` (enforced by
 * the API dispatcher).
 */

export type CommandRouteOptions<TBody> = {
  commandId: string
  /** Body schema WITHOUT tenant / organization (they come from auth). */
  bodySchema: ZodType<TBody>
  resourceKind: string
  resourceId: (body: TBody) => string | null
  /** Optional input mapping (default: body + scope). */
  toInput?: (body: TBody, scope: { tenantId: string; organizationId: string }) => Record<string, unknown>
  logLabel: string
}

function userFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  return Array.isArray(features) ? features.filter((value): value is string => typeof value === 'string') : []
}

export async function readRequestBody(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export async function runCommandRoute<TBody>(
  req: Request,
  options: CommandRouteOptions<TBody>,
  rawBody?: unknown,
): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const parsed = options.bodySchema.safeParse(rawBody === undefined ? await readRequestBody(req) : rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'billing.request.invalid', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const scope = { tenantId: auth.tenantId, organizationId }
    const guardInput = {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: options.resourceKind,
      resourceId: options.resourceId(parsed.data),
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const legacyGuard = bridgeLegacyGuard(container)
    const guard = legacyGuard
      ? await runMutationGuards([legacyGuard], guardInput, { userFeatures: userFeatures(auth) })
      : { ok: true as const, afterSuccessCallbacks: [] }
    if (!guard.ok) {
      return NextResponse.json(guard.errorBody ?? { error: 'Operation blocked by guard' }, { status: guard.errorStatus ?? 422 })
    }
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const input = options.toInput
      ? options.toInput(parsed.data, scope)
      : { ...(parsed.data as Record<string, unknown>), ...scope }
    const response = await commandBus.execute(options.commandId, { input, ctx })
    for (const callback of guard.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, resourceId: guardInput.resourceId ?? '', metadata: callback.metadata ?? null })
      } catch (err) {
        console.error(`[${options.logLabel}] guard afterSuccess failed`, err)
      }
    }
    return NextResponse.json((response as { result?: unknown }).result ?? { ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    console.error(`[${options.logLabel}]`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
