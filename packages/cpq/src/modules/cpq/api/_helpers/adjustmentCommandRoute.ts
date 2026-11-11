import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CpqRouteContext } from '../context'
import { runCpqMutationGuards } from './quoteMutationGuard'
import type { AdjustmentWriteResult } from '../../services/priceAdjustments/adjustmentService'

export async function adjustmentCommandRoute<T extends object>(
  req: Request, ctx: CpqRouteContext, quoteId: string, body: T,
  schema: z.ZodType<T>, operation: 'create' | 'update' | 'delete', adjustmentId?: string,
): Promise<NextResponse | Response> {
  const guard = await runCpqMutationGuards(ctx, req, {
    resourceKind: 'cpq.quote_price_adjustment', resourceId: adjustmentId,
    operation, mutationPayload: { quoteId, ...body },
  })
  if (!guard.ok) return guard.response
  // Path identifiers belong to the server, even when a project guard returns
  // the full payload including the original quoteId metadata.
  const modified = Object.fromEntries(Object.entries(guard.modifiedPayload ?? {})
    .filter(([key]) => key !== 'quoteId' && key !== 'adjustmentId'))
  const effective = schema.parse({ ...body, ...modified })
  const input = operation === 'create' ? { quoteId, adjustment: effective }
    : operation === 'update' ? { quoteId, adjustmentId, patch: effective }
      : { quoteId, adjustmentId, ...effective }
  const commandCtx: CommandRuntimeContext = {
    container: ctx.container, auth: ctx.auth, organizationScope: ctx.organizationScope,
    selectedOrganizationId: ctx.organizationId, organizationIds: [ctx.organizationId], request: req,
  }
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  const commandId = `cpq.quote_price_adjustment.${operation}`
  const { result, logEntry } = await bus.execute<typeof input, AdjustmentWriteResult>(commandId, { input, ctx: commandCtx })
  if (!result) throw new Error('Adjustment command did not return a result')
  await guard.runAfterSuccess()
  const response = NextResponse.json(operation === 'delete' ? { quote: result.quote }
    : { adjustment: result.adjustment, quote: result.quote }, { status: operation === 'create' ? 201 : 200 })
  if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
    response.headers.set('x-om-operation', serializeOperationMetadata({ id: logEntry.id, undoToken: logEntry.undoToken,
      commandId: logEntry.commandId, actionLabel: logEntry.actionLabel ?? null,
      resourceKind: 'cpq.quote_price_adjustment', resourceId: result.adjustment.id,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString()
        : typeof logEntry.createdAt === 'string' ? logEntry.createdAt : new Date().toISOString() }))
  }
  return response
}
