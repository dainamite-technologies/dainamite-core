import {
  _resetOfferingAllowlistForTests,
  getListedOfferingIds,
  isOfferingListed,
} from '../lib/public-calculator/offering-allowlist'
import {
  _setCatalogDataLoaderForTests,
  type CatalogDataLoader,
  type CatalogRawData,
} from '../lib/public-calculator/catalog-cache'
import { _resetPuffinAdminSessionForTests } from '../lib/public-calculator/admin-session'
import type { RawOffering, RawSpecification } from '../lib/public-calculator/catalog-filter'

function makeConfig() {
  return {
    baseUrl: 'http://localhost:3000',
    adminEmail: 'admin@puffin.com',
    adminPassword: 'secret',
    leadJwtSecret: 'a'.repeat(40),
    leadJwtTtlSeconds: 600,
    defaultRegion: 'fra1',
    captcha: { provider: 'disabled' as const },
    rateBudgets: { price: 120, attributes: 60, leads: 5, quotes: 3 },
  }
}

function makeOffering(overrides: Partial<RawOffering> & { id: string }): RawOffering {
  return {
    id: overrides.id,
    specId: overrides.specId ?? 'spec-1',
    code: overrides.code ?? `code-${overrides.id}`,
    name: overrides.name ?? `Offering ${overrides.id}`,
    description: overrides.description ?? null,
    offeringType: overrides.offeringType ?? 'simple',
    designTimeValues: overrides.designTimeValues ?? null,
    lifecycleStatus: overrides.lifecycleStatus ?? 'active',
    metadata: overrides.metadata ?? { listedInCalculator: true },
    charges: overrides.charges ?? [],
    components: overrides.components ?? null,
    isActive: overrides.isActive ?? true,
  }
}

function makeLoader(offerings: RawOffering[], specifications: RawSpecification[] = []): CatalogDataLoader & { calls: number } {
  const fn = (jest.fn(async () => ({ offerings, specifications } as CatalogRawData)) as unknown) as CatalogDataLoader & { calls: number }
  Object.defineProperty(fn, 'calls', {
    get(): number {
      return (fn as unknown as jest.Mock).mock.calls.length
    },
  })
  return fn
}

describe('getListedOfferingIds', () => {
  afterEach(() => {
    _resetOfferingAllowlistForTests()
    _resetPuffinAdminSessionForTests()
    _setCatalogDataLoaderForTests(null)
  })

  it('returns only offerings flagged listedInCalculator and active', async () => {
    const offerings = [
      makeOffering({ id: 'a', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true }),
      makeOffering({ id: 'b', metadata: {}, lifecycleStatus: 'active', isActive: true }),
      makeOffering({ id: 'c', metadata: { listedInCalculator: true }, lifecycleStatus: 'draft', isActive: true }),
      makeOffering({ id: 'd', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: false }),
    ]
    _setCatalogDataLoaderForTests(makeLoader(offerings))

    const ids = await getListedOfferingIds(makeConfig())
    expect(Array.from(ids)).toEqual(['a'])
  })

  it('caches results across concurrent calls (loader runs once)', async () => {
    const offerings = [
      makeOffering({ id: 'a', metadata: { listedInCalculator: true }, lifecycleStatus: 'active', isActive: true }),
    ]
    const loader = makeLoader(offerings)
    _setCatalogDataLoaderForTests(loader)

    const cfg = makeConfig()
    const [a, b, c] = await Promise.all([
      getListedOfferingIds(cfg),
      getListedOfferingIds(cfg),
      isOfferingListed(cfg, 'a'),
    ])
    expect(a.has('a')).toBe(true)
    expect(b.has('a')).toBe(true)
    expect(c).toBe(true)
    expect(loader.calls).toBe(1)
  })
})
