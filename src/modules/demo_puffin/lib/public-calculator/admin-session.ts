/**
 * Cached admin JWT for the public Puffin calculator. The proxy authenticates
 * as `admin@puffin.com` (env-resolved) by POSTing form-encoded credentials to
 * the existing `/api/auth/login` route — same code path the authenticated UI
 * uses, so the public surface can never silently diverge.
 *
 * The token is cached process-locally with its expiry; refresh happens at
 * most once per ~7 hours. On a 401 from a downstream CPQ call the consumer
 * should `invalidatePuffinAdminToken()` and try one more login.
 */

import type { PuffinPublicConfig } from './env'

type CachedToken = {
  token: string
  expiresAt: number
}

let cached: CachedToken | null = null
let inFlight: Promise<string> | null = null
let consecutiveFailures = 0
let backoffUntil = 0
let lastFailureLogAt = 0

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const REFRESH_BUFFER_SECONDS = 600 // refresh if < 10 min from expiry
const FAILURE_LOG_INTERVAL_MS = 60_000

function decodeJwtExp(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8')
    const payload = JSON.parse(payloadJson) as { exp?: unknown }
    if (typeof payload.exp === 'number') return payload.exp
  } catch {
    return null
  }
  return null
}

function logFailure(message: string): void {
  const now = Date.now()
  if (now - lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return
  lastFailureLogAt = now
  console.warn('[puffin-public-calculator] admin login failed:', message)
}

function nextBackoffMs(): number {
  const exp = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, consecutiveFailures - 1))
  return exp
}

export class PuffinAdminLoginError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'PuffinAdminLoginError'
    this.code = options.code ?? 'public_calculator_admin_login_failed'
    this.status = options.status ?? 503
  }
}

async function loginAsAdmin(config: PuffinPublicConfig): Promise<string> {
  const url = `${config.baseUrl}/api/auth/login`
  const body = new URLSearchParams({
    email: config.adminEmail,
    password: config.adminPassword,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  }).catch((err: unknown) => {
    throw new PuffinAdminLoginError(
      `Network error contacting auth login endpoint at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { code: 'public_calculator_admin_login_failed', status: 503 },
    )
  })

  if (!res.ok) {
    const status = res.status
    let detail = `${status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) detail = `${status} ${body.error}`
    } catch {
      detail = `${status}`
    }
    throw new PuffinAdminLoginError(`Admin login HTTP ${detail}`, {
      code: 'public_calculator_admin_login_failed',
      status: 503,
    })
  }

  const json = (await res.json()) as { ok?: boolean; token?: unknown }
  if (!json.ok || typeof json.token !== 'string' || json.token.length === 0) {
    throw new PuffinAdminLoginError('Admin login response missing `token`', {
      code: 'public_calculator_admin_login_failed',
      status: 503,
    })
  }
  return json.token
}

export async function getPuffinAdminToken(config: PuffinPublicConfig): Promise<string> {
  const now = Date.now()
  if (cached && cached.expiresAt - now > REFRESH_BUFFER_SECONDS * 1000) {
    return cached.token
  }
  if (now < backoffUntil) {
    throw new PuffinAdminLoginError('Backing off after repeated admin login failures', {
      code: 'public_calculator_admin_login_failed',
      status: 503,
    })
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const token = await loginAsAdmin(config)
      const exp = decodeJwtExp(token)
      const computedExpiresAt = exp != null ? exp * 1000 : now + 7 * 60 * 60 * 1000
      cached = { token, expiresAt: computedExpiresAt }
      consecutiveFailures = 0
      backoffUntil = 0
      return token
    } catch (err) {
      consecutiveFailures += 1
      backoffUntil = Date.now() + nextBackoffMs()
      cached = null
      const message = err instanceof Error ? err.message : String(err)
      logFailure(message)
      throw err
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export function invalidatePuffinAdminToken(): void {
  cached = null
}

/** Test/internal: resets all state. */
export function _resetPuffinAdminSessionForTests(): void {
  cached = null
  inFlight = null
  consecutiveFailures = 0
  backoffUntil = 0
  lastFailureLogAt = 0
}
