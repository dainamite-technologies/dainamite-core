import { NextResponse } from 'next/server'
import { z } from 'zod'
import { OptimisticLockError } from '@mikro-orm/core'
import { QuotingError } from '../../services/cpqQuotingService'

/**
 * Shared error → JSON-response converter for ARC routes (XD-250).
 *
 * Handles three families:
 *   1. Zod validation errors → 400 with `details` array.
 *   2. Service-layer `QuotingError` (matched both via `instanceof` AND via
 *      duck-typing on `name === 'QuotingError'`) → propagates `err.status`.
 *      The duck-typing fallback exists because Turbopack hot-reload can
 *      produce two distinct class instances for the same source file
 *      across module boundaries, breaking `instanceof` checks at runtime.
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

  if (err instanceof QuotingError) {
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

  // Duck-typed QuotingError (Turbopack instanceof drift) and inventory-service
  // plain throw shape `{ status, error }`. Both surface a numeric `status`.
  // Also propagates `details` (object) into response body — preserves the
  // structured payload (e.g. `existingQuoteId`) that the typed branch above
  // would have surfaced if instanceof had matched.
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
