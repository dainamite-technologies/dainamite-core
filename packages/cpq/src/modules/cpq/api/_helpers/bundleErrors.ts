import { NextResponse } from 'next/server'

/**
 * Lookup misses thrown by `cpqBundleService` as plain `Error`s. They are the
 * caller's fault (an id that does not exist in this tenant), so they answer
 * 404 instead of falling through to a 500 (#122).
 */
const BUNDLE_NOT_FOUND_MESSAGES = new Set([
  'Offering not found',
  'Slot not found',
  'Child offering not found',
  'Specification not found',
])

/** Postgres `unique_violation`, as surfaced by MikroORM's driver exceptions. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const candidate = err as { code?: unknown; name?: unknown }
  return candidate.code === '23505' || candidate.name === 'UniqueConstraintViolationException'
}

/**
 * Maps a bundle-service error to its HTTP response, or returns null when the
 * error is unexpected and the caller should log it and answer 500.
 *
 * - `V-*` rule violations → 400
 * - lookup misses → 404
 * - a unique-index race on components (two concurrent adds of the same child)
 *   → 409 with the V-COMP-5 code the pre-check would have returned
 */
export function bundleErrorResponse(err: unknown): NextResponse | null {
  if (isUniqueViolation(err)) {
    return NextResponse.json(
      { error: 'V-COMP-5: This child offering is already a component of this bundle' },
      { status: 409 },
    )
  }
  if (!(err instanceof Error)) return null
  if (err.message.startsWith('V-')) return NextResponse.json({ error: err.message }, { status: 400 })
  if (BUNDLE_NOT_FOUND_MESSAGES.has(err.message)) {
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  return null
}
