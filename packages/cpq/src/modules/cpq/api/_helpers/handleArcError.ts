import { NextResponse } from 'next/server'
import { z } from 'zod'
import { OptimisticLockError } from '@mikro-orm/core'
import { isQuotingError } from '../../services/cpqQuotingService'

/**
 * Shared error → JSON-response converter for ARC routes (XD-250).
 *
 * Handles three families:
 *   1. Zod validation errors → 400 with `details` array.
 *   2. Service-layer `QuotingError` (matched via its cross-realm brand,
 *      `isQuotingError`, with a duck-typed fallback below) → propagates
 *      `err.status`. `instanceof` is unreliable here: Next bundles this
 *      package once per server layer, so the route and the DI-resolved
 *      service can hold two distinct copies of the class — in production
 *      too, not only under hot-reload.
 *   3. cpqInventoryService throws plain `{ status, error }` objects →
 *      propagate the embedded status.
 *   4. Anything else → 500 + console.error with the route context.
 *
 * Returning the response keeps route handlers terse:
 *   `} catch (err) { return handleArcError(err, 'cpq/quotes/from-subscription.POST') }`
 */
export function handleArcError(err: unknown, ctx: string): NextResponse {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Validation error', details: err.issues },
      { status: 400 },
    )
  }

  if (isQuotingError(err)) {
    const body: Record<string, unknown> = { error: err.message }
    if (err.cpqStatus) body.cpqStatus = err.cpqStatus
    if (err.details) Object.assign(body, err.details)
    return NextResponse.json(body, { status: err.status })
  }

  // MikroORM optimistic-lock collision on subscription.version (XD-250 spec
  // § Risks "Order activation racing with another mutation"). Both
  // `instanceof OptimisticLockError` AND constructor-name fallback to
  // survive Turbopack class drift.
  if (
    err instanceof OptimisticLockError ||
    (err &&
      typeof err === 'object' &&
      typeof (err as { constructor?: { name?: string } }).constructor?.name === 'string' &&
      (err as { constructor: { name: string } }).constructor.name === 'OptimisticLockError')
  ) {
    return NextResponse.json(
      { error: 'Concurrent modification detected', details: (err as Error).message },
      { status: 409 },
    )
  }

  // cpqInventoryService's plain throw shape `{ status, error }` (QuotingError
  // from any bundle copy is already handled by `isQuotingError` above).
  // Propagates `details` (object) into the response body so structured
  // payloads survive here too.
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    const e = err as {
      status: number
      message?: string
      error?: string
      name?: string
      details?: Record<string, unknown>
    }
    const message = e.message ?? e.error ?? 'Conflict'
    const body: Record<string, unknown> = { error: message }
    if (e.details && typeof e.details === 'object') Object.assign(body, e.details)
    return NextResponse.json(body, { status: e.status })
  }

  console.error(`[${ctx}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
