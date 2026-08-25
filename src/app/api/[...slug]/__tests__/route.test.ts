/**
 * Regression tests for the HTTP parameter pollution hardening (upstream #2665)
 * in the API catch-all dispatcher.
 *
 * The bug: a request can carry `tenantId` more than once — repeated
 * `?tenantId=` query params, or the query string *and* the body. The old gate
 * authorized only `searchParams.getAll().last`, while handlers commonly read
 * `searchParams.get()` (first). So `?tenantId=<foreign>&tenantId=<own>` was
 * authorized against the *own* tenant and then handed the *foreign* one to the
 * handler. The gate must therefore validate EVERY distinct candidate.
 *
 * `extractTenantCandidates` and `checkAuthorization` are exported specifically
 * so this can be asserted rather than reasoned about.
 */

// The module registers manifests and boots the container at import time, and
// pulls in most of the framework. Stub everything that is not under test.
jest.mock('@/bootstrap', () => ({ bootstrap: jest.fn(), isBootstrapped: () => true }))
jest.mock('@/.mercato/generated/api-routes.generated', () => ({ apiRoutes: [] }))
// Mutable so individual tests can stand up a route to dispatch against. Jest
// only lets factory closures reach out-of-scope names prefixed with `mock`.
const mockRouteMatch: { value: unknown } = { value: undefined }
jest.mock('@open-mercato/shared/modules/registry', () => ({
  registerApiRouteManifests: jest.fn(),
  getApiRouteManifests: () => [],
  findApiRouteManifestMatch: () => mockRouteMatch.value,
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/cache', () => ({ runWithCacheTenant: (_t: unknown, fn: () => unknown) => fn() }))
// Mutable so the rate-limit branch can be exercised; null in every other test
// keeps that branch out of the way.
const mockRateLimiter: { value: unknown } = { value: null }
jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: () => mockRateLimiter.value,
}))

// Real constants, captured calls — the point is to assert WHICH key the limiter
// is bucketed under when the client IP cannot be resolved.
const mockCheckRateLimit = jest.fn(
  async (..._args: unknown[]): Promise<Response | null> => null,
)
const mockClientIp: { value: string | null } = { value: null }
jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests. Please try again later.',
  RATE_LIMIT_FALLBACK_KEY: 'global',
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: () => mockClientIp.value,
}))
// Capture lifecycle events so the transient-auth path can be asserted on the
// event it emits, not just the status code.
const mockEmitted: Array<{ id: string; payload: Record<string, unknown> }> = []
jest.mock('@open-mercato/shared/modules/events', () => ({
  getGlobalEventBus: () => ({
    emitEvent: async (id: string, payload: Record<string, unknown>) => {
      mockEmitted.push({ id, payload })
    },
  }),
}))
// Captured so the per-route tracking opt-out can be asserted as an actual
// bypass, not just "the handler still ran".
const mockWithModuleResourceUsage = jest.fn(
  async (..._args: unknown[]): Promise<unknown> => {
    const fn = _args[_args.length - 1] as () => unknown
    return fn()
  },
)
jest.mock('@open-mercato/shared/lib/modules/resource-usage', () => ({
  withModuleResourceUsage: (...args: unknown[]) => mockWithModuleResourceUsage(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ resolveAuthFromRequestDetailed: jest.fn() }))
jest.mock('@open-mercato/core/modules/auth/services/rbacService', () => ({ RbacService: class {} }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  // Shape matters: the dispatcher reads `scope.tenantId` and `scope.selectedId`
  // when building the feature check and its forbidden-path logging.
  resolveFeatureCheckContext: async () => ({
    organizationId: 'org-1',
    scope: { tenantId: null, selectedId: null },
  }),
}))

// The primary authorization mechanism. Mutable so a test can grant or deny.
// Declare the rest parameter explicitly — a jest.fn() with no declared args is
// typed as taking none, and spreading into it fails typecheck while the tests
// still pass, because jest strips types.
const mockUserHasAllFeatures = jest.fn(async (..._args: unknown[]): Promise<boolean> => true)

const enforceTenantSelection = jest.fn()
jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  enforceTenantSelection: (...args: unknown[]) => enforceTenantSelection(...args),
  normalizeTenantId: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null),
}))

const createRequestContainer = jest.fn(async () => ({
  resolve: (name: string) =>
    name === 'rbacService'
      ? {
          userHasAllFeatures: (...args: unknown[]) => mockUserHasAllFeatures(...args),
          loadAcl: async () => ({ features: [], isSuperAdmin: false, organizations: [] }),
        }
      : undefined,
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => createRequestContainer(),
}))

import { NextRequest } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveAuthFromRequestDetailed } from '@open-mercato/shared/lib/auth/server'
import { checkAuthorization, extractTenantCandidates, GET } from '../route'

const mockResolveAuth = resolveAuthFromRequestDetailed as jest.MockedFunction<
  typeof resolveAuthFromRequestDetailed
>

const OWN = '11111111-1111-4111-8111-111111111111'
const FOREIGN = '22222222-2222-4222-8222-222222222222'
const OTHER_FOREIGN = '33333333-3333-4333-8333-333333333333'

const auth = { sub: 'user-1', tenantId: OWN, orgId: 'org-1', roles: [] } as never

function jsonRequest(url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : JSON.stringify({}),
  })
}

beforeEach(() => {
  enforceTenantSelection.mockReset()
  createRequestContainer.mockClear()
  // Default: the actor may not select any tenant other than its own.
  enforceTenantSelection.mockImplementation(async (_ctx: unknown, candidate: unknown) => {
    if (candidate !== OWN) throw new CrudHttpError(403, { error: 'Not authorized to target this tenant.' })
  })
})

describe('extractTenantCandidates', () => {
  it('returns every repeated query param, not just the last one', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${FOREIGN}&tenantId=${OWN}`)
    await expect(extractTenantCandidates(req)).resolves.toEqual([FOREIGN, OWN])
  })

  it('returns the single query candidate', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${FOREIGN}`)
    await expect(extractTenantCandidates(req)).resolves.toEqual([FOREIGN])
  })

  it('picks the tenantId up from a JSON body', async () => {
    const req = jsonRequest('https://x.test/api/thing', { tenantId: FOREIGN })
    await expect(extractTenantCandidates(req)).resolves.toEqual([FOREIGN])
  })

  it('collects query and body candidates together', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${OWN}`, { tenantId: FOREIGN })
    await expect(extractTenantCandidates(req)).resolves.toEqual([OWN, FOREIGN])
  })

  it('ignores a body tenantId sent as a file upload rather than trusting its filename', async () => {
    const form = new FormData()
    form.set('tenantId', new File(['x'], `${FOREIGN}.txt`, { type: 'text/plain' }))
    const req = new NextRequest('https://x.test/api/thing', { method: 'POST', body: form })
    await expect(extractTenantCandidates(req)).resolves.toEqual([])
  })

  it('returns nothing for a GET, whose body is never read', async () => {
    const req = new NextRequest('https://x.test/api/thing', { method: 'GET' })
    await expect(extractTenantCandidates(req)).resolves.toEqual([])
  })
})

describe('checkAuthorization — tenant enforcement', () => {
  const metadata = { requireAuth: true } as never

  it('allows the actor to target its own tenant', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${OWN}`)
    await expect(checkAuthorization(metadata, auth, req)).resolves.toBeNull()
    // Own tenant short-circuits before the guard is consulted.
    expect(enforceTenantSelection).not.toHaveBeenCalled()
  })

  it('rejects a single foreign tenantId with 403', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${FOREIGN}`)
    const res = await checkAuthorization(metadata, auth, req)
    expect(res?.status).toBe(403)
  })

  it('rejects own-first, foreign-second', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${OWN}&tenantId=${FOREIGN}`)
    const res = await checkAuthorization(metadata, auth, req)
    expect(res?.status).toBe(403)
  })

  // The regression that motivated #2665: the old gate read the LAST candidate
  // (own → no enforcement) while a handler reading the FIRST got the foreign one.
  it('rejects foreign-first, own-second — the ordering the old gate waved through', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${FOREIGN}&tenantId=${OWN}`)
    const res = await checkAuthorization(metadata, auth, req)
    expect(res?.status).toBe(403)
    expect(enforceTenantSelection).toHaveBeenCalledWith(expect.anything(), FOREIGN)
  })

  it('rejects a foreign tenantId smuggled in the body while the query looks legitimate', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${OWN}`, { tenantId: FOREIGN })
    const res = await checkAuthorization(metadata, auth, req)
    expect(res?.status).toBe(403)
  })

  it('enforces each distinct foreign candidate once, not repeatedly', async () => {
    const req = jsonRequest(
      `https://x.test/api/thing?tenantId=${FOREIGN}&tenantId=${FOREIGN}&tenantId=${OTHER_FOREIGN}`,
    )
    // Allow the first foreign tenant so the loop continues to the second.
    enforceTenantSelection.mockImplementation(async (_ctx: unknown, candidate: unknown) => {
      if (candidate === OTHER_FOREIGN) throw new CrudHttpError(403, { error: 'Not authorized to target this tenant.' })
    })
    const res = await checkAuthorization(metadata, auth, req)
    expect(res?.status).toBe(403)
    expect(enforceTenantSelection).toHaveBeenCalledTimes(2)
  })

  it('does not consult the tenant guard when the route opts out of auth', async () => {
    const req = jsonRequest(`https://x.test/api/thing?tenantId=${FOREIGN}`)
    await expect(checkAuthorization({ requireAuth: false } as never, null as never, req)).resolves.toBeNull()
    expect(enforceTenantSelection).not.toHaveBeenCalled()
  })
})

/**
 * Transient-auth handling (upstream #4176). When auth cannot be *evaluated* —
 * DB down, pool exhausted, timeout — the dispatcher must not return 401 and
 * must not clear session cookies, or a shared infrastructure blip force-logs-out
 * every active user at once. It returns a retryable 503 instead.
 */
describe('dispatch — transient auth failure', () => {
  const handler = jest.fn(async () => new Response('ok'))

  beforeEach(() => {
    mockEmitted.length = 0
    handler.mockClear()
    mockRouteMatch.value = {
      route: {
        // `moduleId` is non-nullable on ApiRouteManifestEntry and is what
        // withModuleResourceUsage attributes telemetry to — the mock has to
        // carry it or it stops resembling a real manifest entry.
        moduleId: 'test_module',
        kind: 'route-file',
        path: '/api/thing',
        methods: ['GET'],
        load: async () => ({ GET: handler, metadata: { GET: { requireAuth: true } } }),
      },
      params: {},
    }
  })

  afterEach(() => {
    mockRouteMatch.value = undefined
  })

  function dispatch() {
    const req = new NextRequest('https://x.test/api/thing', { method: 'GET' })
    return GET(req, { params: Promise.resolve({ slug: ['thing'] }) })
  }

  it('returns a retryable 503 instead of 401 when auth could not be evaluated', async () => {
    mockResolveAuth.mockResolvedValue({ status: 'error', auth: null } as never)
    const res = await dispatch()
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('2')
    // The session must survive the blip.
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('reports the 503 as requestFailed, not as an authorization denial', async () => {
    mockResolveAuth.mockResolvedValue({ status: 'error', auth: null } as never)
    await dispatch()
    const ids = mockEmitted.map((e) => e.id)
    expect(ids).toContain('application.request.failed')
    expect(ids).not.toContain('application.request.authorization_denied')
  })

  it('still returns a cookie-clearing 401 when the session is genuinely invalid', async () => {
    mockResolveAuth.mockResolvedValue({ status: 'invalid', auth: null } as never)
    const res = await dispatch()
    expect(res.status).toBe(401)
    // The symmetric half of the 503 assertion above: a genuinely invalid
    // session MUST have its cookies cleared. Without this, a regression in
    // clearStaffAuthCookies would still produce the right status and events
    // while leaving a stale session cookie in place.
    expect(res.headers.get('set-cookie')).not.toBeNull()
    const ids = mockEmitted.map((e) => e.id)
    expect(ids).toContain('application.request.authorization_denied')
    expect(handler).not.toHaveBeenCalled()
  })
})

/**
 * Rate limiting buckets on the client IP. When it cannot be resolved the
 * limiter must still run, against a shared fallback key — skipping it would let
 * anyone bypass the limit by stripping or forging the forwarded-for chain.
 */
describe('dispatch — rate limiting with an unresolvable client IP', () => {
  const handler = jest.fn(async () => new Response('ok'))

  beforeEach(() => {
    mockEmitted.length = 0
    handler.mockClear()
    mockCheckRateLimit.mockClear()
    mockCheckRateLimit.mockResolvedValue(null)
    mockRateLimiter.value = { trustProxyDepth: 0 }
    mockResolveAuth.mockResolvedValue({ status: 'anonymous', auth: null } as never)
    mockRouteMatch.value = {
      route: {
        moduleId: 'test_module',
        kind: 'route-file',
        path: '/api/thing',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          metadata: { GET: { requireAuth: false, rateLimit: { points: 5, duration: 60 } } },
        }),
      },
      params: {},
    }
  })

  afterEach(() => {
    mockRateLimiter.value = null
    mockRouteMatch.value = undefined
    mockClientIp.value = null
  })

  function dispatch() {
    const req = new NextRequest('https://x.test/api/thing', { method: 'GET' })
    return GET(req, { params: Promise.resolve({ slug: ['thing'] }) })
  }

  it('falls back to the shared key instead of skipping the limit', async () => {
    mockClientIp.value = null
    await dispatch()
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
    expect(mockCheckRateLimit.mock.calls[0][2]).toBe('global')
  })

  it('buckets on the client IP when one is resolvable', async () => {
    mockClientIp.value = '203.0.113.7'
    await dispatch()
    expect(mockCheckRateLimit.mock.calls[0][2]).toBe('203.0.113.7')
  })

  it('returns the limiter response and never reaches the handler when throttled', async () => {
    mockClientIp.value = null
    mockCheckRateLimit.mockResolvedValue(
      Response.json({ error: 'Too many requests' }, { status: 429 }),
    )
    const res = await dispatch()
    expect(res.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
    expect(mockEmitted.map((e) => e.id)).toContain('application.request.rate_limited')
  })
})

/**
 * The two authorization invariants the dispatcher now rests on.
 *
 * `requireFeatures` is the only mechanism that actually authorizes.
 * `requireRoles` deliberately does not — role names are tenant-mutable, so a
 * tenant admin could rename a role to satisfy the guard. The fail-open half is
 * asserted here on purpose: it is a security-relevant decision, and pinning it
 * means re-enabling the check has to be a deliberate act that breaks a named
 * test rather than a quiet change nobody notices.
 */
describe('dispatch — authorization invariants', () => {
  const handler = jest.fn(async () => new Response('ok'))
  const validAuth = { sub: 'user-1', tenantId: OWN, orgId: 'org-1', roles: ['viewer'] }

  function standUpRoute(metadata: Record<string, unknown>) {
    mockRouteMatch.value = {
      route: {
        moduleId: 'test_module',
        kind: 'route-file',
        path: '/api/thing',
        methods: ['GET'],
        load: async () => ({ GET: handler, metadata: { GET: metadata } }),
      },
      params: {},
    }
  }

  function dispatch() {
    const req = new NextRequest('https://x.test/api/thing', { method: 'GET' })
    return GET(req, { params: Promise.resolve({ slug: ['thing'] }) })
  }

  beforeEach(() => {
    mockEmitted.length = 0
    handler.mockClear()
    mockUserHasAllFeatures.mockClear()
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockResolveAuth.mockResolvedValue({ status: 'valid', auth: validAuth } as never)
  })

  afterEach(() => {
    mockRouteMatch.value = undefined
  })

  it('lets a requireRoles-only route through even for a user without the role — it is unguarded', async () => {
    standUpRoute({ requireAuth: true, requireRoles: ['admin'] })
    const res = await dispatch()
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalled()
    // Nothing consulted RBAC, because nothing asked it to.
    expect(mockUserHasAllFeatures).not.toHaveBeenCalled()
  })

  it('denies with 403 when requireFeatures is not satisfied', async () => {
    standUpRoute({ requireAuth: true, requireFeatures: ['cpq.view'] })
    mockUserHasAllFeatures.mockResolvedValue(false)
    const res = await dispatch()
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs the handler when requireFeatures is satisfied', async () => {
    standUpRoute({ requireAuth: true, requireFeatures: ['cpq.view'] })
    mockUserHasAllFeatures.mockResolvedValue(true)
    const res = await dispatch()
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('checks the features against the acting user and the resolved organization', async () => {
    standUpRoute({ requireAuth: true, requireFeatures: ['cpq.view', 'cpq.edit'] })
    await dispatch()
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'user-1',
      ['cpq.view', 'cpq.edit'],
      expect.objectContaining({ organizationId: 'org-1' }),
    )
  })

  it('still denies an unauthenticated caller on a requireFeatures route', async () => {
    standUpRoute({ requireAuth: true, requireFeatures: ['cpq.view'] })
    mockResolveAuth.mockResolvedValue({ status: 'anonymous', auth: null } as never)
    const res = await dispatch()
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('dispatch — module resource-usage tracking opt-out', () => {
  const handler = jest.fn(async () => new Response('ok'))

  function standUp(metadata: Record<string, unknown>) {
    mockRouteMatch.value = {
      route: {
        moduleId: 'test_module',
        kind: 'route-file',
        path: '/api/thing',
        methods: ['GET'],
        load: async () => ({ GET: handler, metadata: { GET: metadata } }),
      },
      params: {},
    }
  }

  function dispatch() {
    const req = new NextRequest('https://x.test/api/thing', { method: 'GET' })
    return GET(req, { params: Promise.resolve({ slug: ['thing'] }) })
  }

  beforeEach(() => {
    handler.mockClear()
    mockWithModuleResourceUsage.mockClear()
    mockResolveAuth.mockResolvedValue({ status: 'anonymous', auth: null } as never)
  })

  afterEach(() => {
    mockRouteMatch.value = undefined
  })

  it('tracks by default', async () => {
    standUp({ requireAuth: false })
    const res = await dispatch()
    expect(res.status).toBe(200)
    expect(mockWithModuleResourceUsage).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalled()
  })

  it('bypasses tracking when the route opts out, and still runs the handler', async () => {
    standUp({ requireAuth: false, skipModuleResourceUsageTracking: true })
    const res = await dispatch()
    expect(res.status).toBe(200)
    expect(mockWithModuleResourceUsage).not.toHaveBeenCalled()
    // The opt-out must skip the wrapper, not the work.
    expect(handler).toHaveBeenCalled()
  })
})
