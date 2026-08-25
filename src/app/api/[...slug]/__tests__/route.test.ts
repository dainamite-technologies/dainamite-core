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
jest.mock('@open-mercato/shared/modules/registry', () => ({
  registerApiRouteManifests: jest.fn(),
  getApiRouteManifests: () => [],
  findApiRouteManifestMatch: () => undefined,
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/cache', () => ({ runWithCacheTenant: (_t: unknown, fn: () => unknown) => fn() }))
jest.mock('@open-mercato/core/bootstrap', () => ({ getCachedRateLimiterService: () => null }))
jest.mock('@open-mercato/shared/modules/events', () => ({ getGlobalEventBus: () => null }))
jest.mock('@open-mercato/shared/lib/modules/resource-usage', () => ({
  withModuleResourceUsage: async (_m: unknown, fn: () => unknown) => fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ resolveAuthFromRequestDetailed: jest.fn() }))
jest.mock('@open-mercato/core/modules/auth/services/rbacService', () => ({ RbacService: class {} }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: async () => ({ organizationId: null }),
}))

const enforceTenantSelection = jest.fn()
jest.mock('@open-mercato/core/modules/auth/lib/tenantAccess', () => ({
  enforceTenantSelection: (...args: unknown[]) => enforceTenantSelection(...args),
  normalizeTenantId: (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null),
}))

const createRequestContainer = jest.fn(async () => ({ resolve: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => createRequestContainer(),
}))

import { NextRequest } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { checkAuthorization, extractTenantCandidates } from '../route'

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
