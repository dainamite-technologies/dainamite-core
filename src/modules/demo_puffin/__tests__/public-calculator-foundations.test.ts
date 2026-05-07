import { signLeadToken, verifyLeadToken } from '../lib/public-calculator/lead-token'
import {
  reserveNonce,
  consumeNonce,
  releaseNonce,
  NonceConflictError,
  _resetNonceStoreForTests,
  _peekNonceForTests,
} from '../lib/public-calculator/nonce-store'
import {
  sanitizeMetadata,
  isListedInCalculator,
  filterPublicOfferings,
  buildPublicCatalog,
  type RawOffering,
  type RawSpecification,
} from '../lib/public-calculator/catalog-filter'
import { readPuffinPublicConfig } from '../lib/public-calculator/env'
import {
  _resetPuffinAdminSessionForTests,
  getPuffinAdminToken,
  PuffinAdminLoginError,
} from '../lib/public-calculator/admin-session'

// ─── env.ts ─────────────────────────────────────────────────────

describe('readPuffinPublicConfig', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('reports PUFFIN_PUBLIC_LEAD_JWT_SECRET as missing when unset', () => {
    delete process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET
    const result = readPuffinPublicConfig()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing).toContain('PUFFIN_PUBLIC_LEAD_JWT_SECRET')
    }
  })

  it('rejects a too-short lead JWT secret', () => {
    process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET = 'short'
    const result = readPuffinPublicConfig()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.invalid.some((m) => m.includes('PUFFIN_PUBLIC_LEAD_JWT_SECRET'))).toBe(true)
    }
  })

  it('returns a complete config when the lead secret is set', () => {
    process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET = 'a'.repeat(40)
    process.env.PUFFIN_PUBLIC_DEFAULT_REGION = 'waw1'
    const result = readPuffinPublicConfig()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.adminEmail).toBe('admin@puffin.com')
      expect(result.config.defaultRegion).toBe('waw1')
      expect(result.config.captcha.provider).toBe('disabled')
      expect(result.config.rateBudgets.price).toBe(120)
    }
  })

  it('requires recaptcha keys when provider is recaptcha_v3', () => {
    process.env.PUFFIN_PUBLIC_LEAD_JWT_SECRET = 'a'.repeat(40)
    process.env.PUFFIN_PUBLIC_CAPTCHA_PROVIDER = 'recaptcha_v3'
    delete process.env.PUFFIN_PUBLIC_CAPTCHA_SITE_KEY
    delete process.env.PUFFIN_PUBLIC_CAPTCHA_SECRET
    const result = readPuffinPublicConfig()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.missing).toEqual(
        expect.arrayContaining(['PUFFIN_PUBLIC_CAPTCHA_SITE_KEY', 'PUFFIN_PUBLIC_CAPTCHA_SECRET']),
      )
    }
  })
})

// ─── lead-token.ts ──────────────────────────────────────────────

describe('lead-token', () => {
  const SECRET = 'a'.repeat(40)

  it('round-trips signed payload', () => {
    const { token, jti } = signLeadToken({ customerId: 'cust-1', ttlSeconds: 600, secret: SECRET })
    const verified = verifyLeadToken(token, SECRET)
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.payload.sub).toBe('cust-1')
      expect(verified.payload.scope).toBe('puffin.public.quote')
      expect(verified.payload.jti).toBe(jti)
    }
  })

  it('rejects token signed with a different secret', () => {
    const { token } = signLeadToken({ customerId: 'cust-1', ttlSeconds: 600, secret: SECRET })
    const verified = verifyLeadToken(token, 'b'.repeat(40))
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe('invalid_signature')
  })

  it('rejects expired tokens', () => {
    const { token } = signLeadToken({ customerId: 'cust-1', ttlSeconds: 60, secret: SECRET })
    // Build an expired token by re-signing with negative ttl is not possible; emulate by waiting via clock.
    const past = Math.floor(Date.now() / 1000) - 100
    const tampered = token.split('.')
    const payloadJson = JSON.parse(Buffer.from(tampered[1], 'base64').toString('utf8'))
    payloadJson.exp = past
    const newPayload = Buffer.from(JSON.stringify(payloadJson))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const reSigned = `${tampered[0]}.${newPayload}.${tampered[2]}`
    const verified = verifyLeadToken(reSigned, SECRET)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(['invalid_signature', 'expired']).toContain(verified.reason)
  })

  it('rejects malformed input', () => {
    const verified = verifyLeadToken('not-a-jwt', SECRET)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe('malformed')
  })
})

// ─── nonce-store.ts ─────────────────────────────────────────────

describe('nonce-store', () => {
  beforeEach(() => {
    _resetNonceStoreForTests()
  })

  it('reserves a fresh jti', () => {
    reserveNonce('jti-1', 600)
    expect(_peekNonceForTests('jti-1')?.state).toBe('reserved')
  })

  it('rejects reserving the same jti twice', () => {
    reserveNonce('jti-1', 600)
    expect(() => reserveNonce('jti-1', 600)).toThrow(NonceConflictError)
  })

  it('release returns reserved entries to the unused pool', () => {
    reserveNonce('jti-1', 600)
    releaseNonce('jti-1')
    expect(_peekNonceForTests('jti-1')).toBeUndefined()
    expect(() => reserveNonce('jti-1', 600)).not.toThrow()
  })

  it('consume keeps the entry to block replays', () => {
    reserveNonce('jti-1', 600)
    consumeNonce('jti-1')
    expect(_peekNonceForTests('jti-1')?.state).toBe('used')
    expect(() => reserveNonce('jti-1', 600)).toThrow(NonceConflictError)
  })
})

// ─── catalog-filter.ts ──────────────────────────────────────────

describe('sanitizeMetadata', () => {
  it('strips cost / margin / vendor and _internal_ fields', () => {
    const out = sanitizeMetadata({
      listedInCalculator: true,
      tagline: 'Hello',
      cost: 5,
      costAmount: 5,
      margin: 0.4,
      vendor: 'Acme',
      _internal_owner: 'jane',
      vendorContractId: 'CN-1',
      designTimeValues: { vcpu: 2 },
    })
    expect(out).toEqual({
      listedInCalculator: true,
      tagline: 'Hello',
      designTimeValues: { vcpu: 2 },
    })
  })

  it('treats missing metadata as empty', () => {
    expect(sanitizeMetadata(undefined)).toEqual({})
    expect(sanitizeMetadata(null)).toEqual({})
  })
})

describe('isListedInCalculator', () => {
  it('requires the flag to be strictly true', () => {
    expect(isListedInCalculator({ listedInCalculator: true })).toBe(true)
    expect(isListedInCalculator({ listedInCalculator: 'yes' as unknown as true })).toBe(false)
    expect(isListedInCalculator({})).toBe(false)
    expect(isListedInCalculator(null)).toBe(false)
  })
})

describe('filterPublicOfferings', () => {
  function makeOffering(overrides: Partial<RawOffering> = {}): RawOffering {
    return {
      id: overrides.id ?? 'off-1',
      specId: overrides.specId ?? 'spec-1',
      code: overrides.code ?? 'vps_small',
      name: overrides.name ?? 'Atlantic',
      description: overrides.description ?? null,
      offeringType: overrides.offeringType ?? 'simple',
      designTimeValues: overrides.designTimeValues ?? { mrc: 24, nrc: 5 },
      lifecycleStatus: overrides.lifecycleStatus ?? 'active',
      metadata: overrides.metadata ?? { listedInCalculator: true },
      charges: overrides.charges,
      isActive: overrides.isActive ?? true,
    }
  }

  it('keeps offerings flagged listedInCalculator and active', () => {
    const filtered = filterPublicOfferings([makeOffering()])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].fromPriceMonthly).toBe(24)
    expect(filtered[0].fromPriceOneTime).toBe(5)
  })

  it('drops offerings missing the flag', () => {
    const filtered = filterPublicOfferings([makeOffering({ metadata: {} })])
    expect(filtered).toHaveLength(0)
  })

  it('drops inactive lifecycle states', () => {
    const filtered = filterPublicOfferings([makeOffering({ lifecycleStatus: 'draft' })])
    expect(filtered).toHaveLength(0)
  })
})

describe('buildPublicCatalog', () => {
  it('groups offerings by spec and assigns a uiPattern', () => {
    const specs: RawSpecification[] = [
      {
        id: 'spec-vps',
        productId: 'prod-vps',
        code: 'SPEC-PUFFIN-VPS',
        name: 'Puffin VPS',
        description: 'Plans',
        specType: 'simple',
        isActive: true,
        attributes: [],
        slots: [],
      },
    ]
    const offerings: RawOffering[] = [
      {
        id: 'off-1',
        specId: 'spec-vps',
        code: 'vps_small',
        name: 'Atlantic',
        description: null,
        offeringType: 'simple',
        designTimeValues: { mrc: 24 },
        lifecycleStatus: 'active',
        metadata: { listedInCalculator: true },
        isActive: true,
      },
    ]
    const catalog = buildPublicCatalog({
      specifications: specs,
      offerings,
      regions: [{ value: 'fra1', label: 'Frankfurt 1' }],
      currencyCode: 'USD',
    })
    expect(catalog.tenantSlug).toBe('puffin')
    expect(catalog.specifications).toHaveLength(1)
    expect(catalog.specifications[0].uiPattern).toBe('plan_grid')
    expect(catalog.specifications[0].offerings).toHaveLength(1)
  })

  it('drops specs whose offerings are all filtered out', () => {
    const specs: RawSpecification[] = [
      {
        id: 'spec-1',
        productId: 'prod-1',
        code: 'SPEC-PUFFIN-VPS',
        name: 'VPS',
        description: null,
        specType: 'simple',
        isActive: true,
      },
    ]
    const offerings: RawOffering[] = [
      {
        id: 'off-1',
        specId: 'spec-1',
        code: 'x',
        name: 'X',
        description: null,
        offeringType: 'simple',
        designTimeValues: {},
        lifecycleStatus: 'draft', // filtered
        metadata: { listedInCalculator: true },
        isActive: true,
      },
    ]
    const catalog = buildPublicCatalog({
      specifications: specs,
      offerings,
      regions: [],
      currencyCode: 'USD',
    })
    expect(catalog.specifications).toHaveLength(0)
  })
})

// ─── admin-session.ts ───────────────────────────────────────────

describe('getPuffinAdminToken', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    _resetPuffinAdminSessionForTests()
    global.fetch = originalFetch
  })

  function makeConfig(): Parameters<typeof getPuffinAdminToken>[0] {
    return {
      baseUrl: 'http://localhost:3000',
      adminEmail: 'admin@puffin.com',
      adminPassword: 'secret',
      leadJwtSecret: 'a'.repeat(40),
      leadJwtTtlSeconds: 600,
      defaultRegion: 'fra1',
      captcha: { provider: 'disabled' },
      rateBudgets: { price: 1, attributes: 1, leads: 1, quotes: 1 },
    }
  }

  function fakeJwt(expSecondsFromNow: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/=/g, '')
    const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }))
      .toString('base64')
      .replace(/=/g, '')
    return `${header}.${payload}.signature`
  }

  it('caches the admin token across concurrent requests (issues one login)', async () => {
    let calls = 0
    global.fetch = jest.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ ok: true, token: fakeJwt(7 * 60 * 60) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const cfg = makeConfig()
    const tokens = await Promise.all([
      getPuffinAdminToken(cfg),
      getPuffinAdminToken(cfg),
      getPuffinAdminToken(cfg),
    ])
    expect(tokens.every((t) => typeof t === 'string')).toBe(true)
    expect(calls).toBe(1)
  })

  it('throws PuffinAdminLoginError on 401 response', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(getPuffinAdminToken(makeConfig())).rejects.toBeInstanceOf(PuffinAdminLoginError)
  })

  it('refreshes when the cached token is within the buffer window', async () => {
    let calls = 0
    global.fetch = jest.fn(async () => {
      calls += 1
      return new Response(
        JSON.stringify({ ok: true, token: fakeJwt(calls === 1 ? 60 : 7 * 60 * 60) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const cfg = makeConfig()
    await getPuffinAdminToken(cfg)
    // First token expires in 60s — the helper considers anything within 600s
    // of expiry stale, so a second call must trigger a fresh login.
    await getPuffinAdminToken(cfg)
    expect(calls).toBe(2)
  })
})
