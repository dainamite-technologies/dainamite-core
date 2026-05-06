/**
 * Wrapper that wires the per-route public budgets onto the framework's shared
 * rate limiter service. We use a single keyPrefix per public route so a 1k
 * burst of `/price` calls cannot deplete the `/quotes` budget.
 *
 * Returns a `NextResponse` 429 when the budget is exceeded, or `null` to
 * allow the request through. Callers MUST short-circuit on a non-null result.
 */

import { NextResponse } from 'next/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

export type PublicCalculatorRoute = 'price' | 'attributes' | 'leads' | 'quotes' | 'config' | 'catalog'

const DEFAULT_BUDGETS: Record<PublicCalculatorRoute, number> = {
  price: 120,
  attributes: 60,
  leads: 5,
  quotes: 3,
  config: 60,
  catalog: 0, // edge-cached; rate limit is best-effort
}

export type PublicRateLimitOptions = {
  route: PublicCalculatorRoute
  /** Per-minute budget; falls back to DEFAULT_BUDGETS if not provided. */
  points?: number
}

/**
 * Apply the public-calculator rate limit for the given route. Returns null on
 * pass; returns a 429 NextResponse on rejection. If the framework has not
 * bootstrapped a rate limiter (early dev, tests), this is a no-op.
 */
export async function enforcePublicRateLimit(
  req: Request,
  { route, points }: PublicRateLimitOptions,
): Promise<NextResponse | null> {
  const budget = points ?? DEFAULT_BUDGETS[route]
  if (!budget || budget <= 0) return null

  const service = getCachedRateLimiterService()
  if (!service) return null

  const config: RateLimitConfig = {
    points: budget,
    duration: 60,
    blockDuration: 60,
    keyPrefix: `puffin_public_${route}`,
  }
  const ip = getClientIp(req, service.trustProxyDepth) ?? 'anon'
  return checkRateLimit(service, config, ip, 'Too many requests. Please try again later.')
}
