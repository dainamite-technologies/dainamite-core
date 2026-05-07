/**
 * In-memory single-use nonce store for the visitor lead JWT (`jti` claim).
 *
 * The token-bound `/quotes` route reserves the `jti` before chaining the CPQ
 * calls, then either consumes it on full success or releases it on rollback
 * so the visitor can retry until the JWT expires. After consumption a replay
 * attempt returns 409.
 *
 * In-memory is sufficient for a single-instance demo deployment. For
 * multi-instance prod, swap this implementation for Redis or Postgres without
 * touching callers — the interface is intentionally tiny.
 */

export type NonceState = 'reserved' | 'used'

type Entry = {
  state: NonceState
  expiresAt: number
}

const store = new Map<string, Entry>()
let evictTimer: NodeJS.Timeout | null = null

const EVICT_INTERVAL_MS = 60_000

function ensureEvictTimer(): void {
  if (evictTimer) return
  evictTimer = setInterval(() => {
    const now = Date.now()
    for (const [jti, entry] of store) {
      if (entry.expiresAt <= now) store.delete(jti)
    }
  }, EVICT_INTERVAL_MS)
  if (typeof evictTimer.unref === 'function') evictTimer.unref()
}

export class NonceConflictError extends Error {
  readonly code = 'jwt_replay_or_in_use'
  readonly status = 409

  constructor() {
    super('Lead token has already been used or is currently reserved')
    this.name = 'NonceConflictError'
  }
}

export function reserveNonce(jti: string, expirySeconds: number): void {
  ensureEvictTimer()
  const now = Date.now()
  const existing = store.get(jti)
  if (existing && existing.expiresAt > now) {
    throw new NonceConflictError()
  }
  store.set(jti, {
    state: 'reserved',
    expiresAt: now + Math.max(60_000, expirySeconds * 1000),
  })
}

export function consumeNonce(jti: string): void {
  const existing = store.get(jti)
  if (!existing) return
  store.set(jti, { state: 'used', expiresAt: existing.expiresAt })
}

export function releaseNonce(jti: string): void {
  const existing = store.get(jti)
  if (!existing) return
  if (existing.state === 'reserved') store.delete(jti)
}

export function _resetNonceStoreForTests(): void {
  store.clear()
  if (evictTimer) {
    clearInterval(evictTimer)
    evictTimer = null
  }
}

export function _peekNonceForTests(jti: string): Entry | undefined {
  return store.get(jti)
}
