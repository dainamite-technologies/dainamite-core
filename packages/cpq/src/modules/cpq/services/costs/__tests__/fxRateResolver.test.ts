import { CpqFxRateResolver, type FxExchangeRateService } from '../fxRateResolver'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const NOW = new Date('2026-11-15T18:30:00Z')
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
type Rows = Array<{ rate: string; source: string }>
type Pair = { rates: Rows; actualDate: Date | null }
const empty: Pair = { rates: [], actualDate: null }

/** Mock service keyed by "FROM>TO". */
function service(pairs: Record<string, Pair | Error>) {
  const getRate = jest.fn(async (params: { fromCurrencyCode: string; toCurrencyCode: string }) => {
    const hit = pairs[`${params.fromCurrencyCode}>${params.toCurrencyCode}`] ?? empty
    if (hit instanceof Error) throw hit
    return hit
  })
  return { getRate } satisfies FxExchangeRateService
}
const toggles = (days: unknown = 7, priority: unknown = []) => ({
  getNumberConfig: jest.fn(async () => ({ ok: true, value: days }) as never),
  getJsonConfig: jest.fn(async () => ({ ok: true, value: priority }) as never),
})
const make = (pairs: Record<string, Pair | Error>, over: { days?: unknown; priority?: unknown } = {}) => {
  const svc = service(pairs)
  const resolver = new CpqFxRateResolver({ exchangeRateService: svc, featureTogglesService: toggles(over.days, over.priority), now: () => NOW })
  return { svc, resolver }
}
const usdEur = (rates: Rows, actual = '2026-11-15'): Record<string, Pair> => ({ 'USD>EUR': { rates, actualDate: day(actual) } })
const input = { from: 'USD', to: 'EUR', scope: SCOPE }

describe('CpqFxRateResolver', () => {
  let warn: jest.SpyInstance
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterEach(() => warn.mockRestore())

  it('calls getRate with autoFetch false, the tenant look-back, the UTC-today midnight date and the scope', async () => {
    const { svc, resolver } = make(usdEur([{ rate: '0.92', source: 'manual' }]), { days: 3 })
    await resolver.resolve(input)
    expect(svc.getRate).toHaveBeenCalledTimes(1)
    expect(svc.getRate).toHaveBeenCalledWith({
      fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', date: day('2026-11-15'), scope: SCOPE, options: { autoFetch: false, maxDaysBack: 3 },
    })
  })

  it('a direct rate: 8 dp string, the actual (look-back) date, source and derivation direct; no inverse call', async () => {
    const { svc, resolver } = make(usdEur([{ rate: '0.92', source: 'manual' }], '2026-11-12'))
    expect(await resolver.resolve(input)).toEqual({ ok: true, rate: '0.92000000', rateDate: '2026-11-12', source: 'manual', derivation: 'direct' })
    expect(svc.getRate).toHaveBeenCalledTimes(1)
  })

  it('clamps an out-of-range look-back setting before calling the service', async () => {
    const { svc, resolver } = make(usdEur([{ rate: '0.92', source: 'manual' }]), { days: 500 })
    await resolver.resolve(input)
    expect(svc.getRate.mock.calls[0][0].options).toEqual({ autoFetch: false, maxDaysBack: 30 })
  })

  describe('source rule (Q2)', () => {
    const rows: Rows = [{ rate: '0.90', source: 'nbp' }, { rate: '0.91', source: 'ecb' }, { rate: '0.92', source: 'manual' }]
    it('a priority list picks the first listed source that has a rate', async () => {
      const { resolver } = make(usdEur(rows), { priority: ['bloomberg', 'manual', 'ecb'] })
      expect(await resolver.resolve(input)).toMatchObject({ ok: true, source: 'manual', rate: '0.92000000' })
    })
    it('a single rate is used as-is, even when it is not listed', async () => {
      const { resolver } = make(usdEur([{ rate: '0.9123', source: 'nbp' }]), { priority: ['ecb'] })
      expect(await resolver.resolve(input)).toMatchObject({ ok: true, source: 'nbp', rate: '0.91230000' })
    })
    it('several unlisted rates tie-break by source ascending', async () => {
      const { resolver } = make(usdEur(rows))
      expect(await resolver.resolve(input)).toMatchObject({ ok: true, source: 'ecb', rate: '0.91000000' })
    })
    it('when no listed source has a rate the unlisted tie-break applies', async () => {
      const { resolver } = make(usdEur(rows), { priority: ['bloomberg'] })
      expect(await resolver.resolve(input)).toMatchObject({ ok: true, source: 'ecb' })
    })
  })

  describe('direct first, inverse only when no source has a direct rate (Q3)', () => {
    it('a direct rate from source A beats an inverse rate from source B', async () => {
      const { svc, resolver } = make({
        'USD>EUR': { rates: [{ rate: '0.90', source: 'zeta' }], actualDate: day('2026-11-15') },
        'EUR>USD': { rates: [{ rate: '1.0', source: 'alpha' }], actualDate: day('2026-11-15') },
      }, { priority: ['alpha'] })
      expect(await resolver.resolve(input)).toMatchObject({ ok: true, source: 'zeta', rate: '0.90000000', derivation: 'direct' })
      expect(svc.getRate).toHaveBeenCalledTimes(1)
    })

    it('inverts the opposite pair rounded to 8 dp, derivation inverse, with its own date and source', async () => {
      const { svc, resolver } = make({ 'EUR>USD': { rates: [{ rate: '1.08700000', source: 'manual' }], actualDate: day('2026-11-14') } })
      expect(await resolver.resolve(input)).toEqual({ ok: true, rate: '0.91996320', rateDate: '2026-11-14', source: 'manual', derivation: 'inverse' })
      expect(svc.getRate).toHaveBeenCalledTimes(2)
      expect(svc.getRate.mock.calls[1][0]).toMatchObject({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', options: { autoFetch: false, maxDaysBack: 7 } })
    })

    it('the source rule applies within the inverse direction', async () => {
      const { resolver } = make({ 'EUR>USD': { rates: [{ rate: '2', source: 'b' }, { rate: '4', source: 'a' }], actualDate: day('2026-11-15') } }, { priority: ['b'] })
      expect(await resolver.resolve(input)).toMatchObject({ rate: '0.50000000', source: 'b', derivation: 'inverse' })
    })

    it('no rate in either direction is not_found; a row with no actual date or a non-positive rate is unusable', async () => {
      expect(await make({}).resolver.resolve(input)).toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'not_found' })
      const zero = make({ ...usdEur([{ rate: '0', source: 'x' }]), 'EUR>USD': { rates: [{ rate: '-1', source: 'x' }], actualDate: day('2026-11-15') } })
      expect(await zero.resolver.resolve(input)).toMatchObject({ ok: false, reason: 'not_found' })
      const noDate = make({ 'USD>EUR': { rates: [{ rate: '0.9', source: 'x' }], actualDate: null } })
      expect(await noDate.resolver.resolve(input)).toMatchObject({ ok: false, reason: 'not_found' })
    })

    it('an inverse that rounds to zero at 8 dp is not usable', async () => {
      const { resolver } = make({ 'EUR>USD': { rates: [{ rate: '1000000000', source: 'x' }], actualDate: day('2026-11-15') } })
      expect(await resolver.resolve(input)).toMatchObject({ ok: false, reason: 'not_found' })
    })
  })

  describe('errors and availability', () => {
    it('a throwing service (direct or inverse) maps to CURRENCY_NO_RATE / error and never rethrows', async () => {
      const direct = make({ 'USD>EUR': new Error('db down') })
      expect(await direct.resolver.resolve(input)).toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'error' })
      const inverse = make({ 'EUR>USD': new Error('boom') })
      expect(await inverse.resolver.resolve(input)).toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'error' })
      expect(warn).toHaveBeenCalled()
    })

    it('a throwing toggle service falls back to the defaults, not an error', async () => {
      const svc = service(usdEur([{ rate: '0.92', source: 'manual' }]))
      const broken = { getNumberConfig: jest.fn().mockRejectedValue(new Error('x')), getJsonConfig: jest.fn().mockRejectedValue(new Error('x')) }
      const resolver = new CpqFxRateResolver({ exchangeRateService: svc, featureTogglesService: broken as never, now: () => NOW })
      expect(await resolver.resolve(input)).toMatchObject({ ok: true })
      expect(svc.getRate.mock.calls[0][0].options).toEqual({ autoFetch: false, maxDaysBack: 7 })
    })

    it('without a currencies service it is unavailable and resolves to CURRENCY_NO_RATE / unavailable', async () => {
      for (const resolver of [new CpqFxRateResolver(), new CpqFxRateResolver({ exchangeRateService: null })]) {
        expect(resolver.available()).toBe(false)
        expect(await resolver.resolve(input)).toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'unavailable' })
      }
      expect(make({}).resolver.available()).toBe(true)
    })

    it('the same currency never calls the service (any case)', async () => {
      const { svc, resolver } = make({})
      expect(await resolver.resolve({ ...input, from: 'EUR', to: 'eur' })).toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'same_currency' })
      expect(svc.getRate).not.toHaveBeenCalled()
    })
  })

  describe('memo (per resolver instance)', () => {
    it('repeats of the same pair and day call the service once, including concurrent ones and failures', async () => {
      const { svc, resolver } = make(usdEur([{ rate: '0.92', source: 'manual' }]))
      const [a, b] = await Promise.all([resolver.resolve(input), resolver.resolve({ ...input, from: 'usd' })])
      expect(a).toEqual(b)
      await resolver.resolve(input)
      expect(svc.getRate).toHaveBeenCalledTimes(1)
      const failing = make({ 'USD>EUR': new Error('x') })
      await failing.resolver.resolve(input)
      await failing.resolver.resolve(input)
      expect(failing.svc.getRate).toHaveBeenCalledTimes(1)
    })

    it('a different pair, day or tenant looks up again; a new instance does not share the memo', async () => {
      const { svc, resolver } = make({ ...usdEur([{ rate: '0.92', source: 'm' }]), 'GBP>EUR': { rates: [{ rate: '1.15', source: 'm' }], actualDate: day('2026-11-15') } })
      await resolver.resolve(input)
      await resolver.resolve({ ...input, from: 'GBP' })
      await resolver.resolve({ ...input, date: day('2026-11-10') })
      await resolver.resolve({ ...input, scope: { ...SCOPE, tenantId: 'other' } })
      expect(svc.getRate).toHaveBeenCalledTimes(4)
      expect(svc.getRate.mock.calls[2][0].date).toEqual(day('2026-11-10'))
      await new CpqFxRateResolver({ exchangeRateService: svc, now: () => NOW }).resolve(input)
      expect(svc.getRate).toHaveBeenCalledTimes(5)
    })

    it('reads the tenant settings once per tenant', async () => {
      const t = toggles()
      const svc = service({ ...usdEur([{ rate: '0.92', source: 'm' }]), 'GBP>EUR': { rates: [{ rate: '1.15', source: 'm' }], actualDate: day('2026-11-15') } })
      const resolver = new CpqFxRateResolver({ exchangeRateService: svc, featureTogglesService: t, now: () => NOW })
      await resolver.resolve(input)
      await resolver.resolve({ ...input, from: 'GBP' })
      expect(t.getNumberConfig).toHaveBeenCalledTimes(1)
      expect(t.getJsonConfig).toHaveBeenCalledTimes(1)
    })
  })
})
