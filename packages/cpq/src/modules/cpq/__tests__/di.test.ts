import { asValue, createContainer, InjectionMode } from 'awilix'
import { register } from '../di'
import { CpqFxRateResolver } from '../services/costs/fxRateResolver'
import { CpqCostService } from '../services/costs/costService'

const featureTogglesService = {
  getBoolConfig: jest.fn(async () => ({ ok: true, value: true })),
  getNumberConfig: jest.fn(async () => ({ ok: true, value: 3 })),
  getJsonConfig: jest.fn(async () => ({ ok: true, value: [] })),
}

function setup(options: { currencies: boolean }) {
  const exchangeRateService = { getRate: jest.fn(async () => ({ rates: [{ rate: '0.92', source: 'manual' }], actualDate: new Date('2026-11-15T00:00:00Z') })) }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue({ fork: () => ({}) }), featureTogglesService: asValue(featureTogglesService) })
  if (options.currencies) container.register({ exchangeRateService: asValue(exchangeRateService) })
  register(container as never)
  return { container, exchangeRateService }
}

describe('cpqFxRateResolver DI registration', () => {
  it('resolves an available resolver that uses exchangeRateService when the currencies module is registered', async () => {
    const { container, exchangeRateService } = setup({ currencies: true })
    const resolver = container.resolve<CpqFxRateResolver>('cpqFxRateResolver')
    expect(resolver).toBeInstanceOf(CpqFxRateResolver)
    expect(resolver.available()).toBe(true)
    const result = await resolver.resolve({ from: 'USD', to: 'EUR', scope: { organizationId: 'org', tenantId: 'tenant' } })
    expect(result).toMatchObject({ ok: true, rate: '0.92000000', source: 'manual', derivation: 'direct' })
    expect(exchangeRateService.getRate).toHaveBeenCalledWith(expect.objectContaining({ options: { autoFetch: false, maxDaysBack: 3 } }))
  })

  it('resolves an unavailable resolver (no throw) when the currencies module is not installed', async () => {
    const { container } = setup({ currencies: false })
    expect(container.hasRegistration('exchangeRateService')).toBe(false)
    const resolver = container.resolve<CpqFxRateResolver>('cpqFxRateResolver')
    expect(resolver.available()).toBe(false)
    expect(await resolver.resolve({ from: 'USD', to: 'EUR', scope: { organizationId: 'org', tenantId: 'tenant' } }))
      .toEqual({ ok: false, code: 'CURRENCY_NO_RATE', reason: 'unavailable' })
  })

  it('is scoped: one instance per scope, a fresh memo per scope', () => {
    const { container } = setup({ currencies: true })
    const a = container.createScope()
    const b = container.createScope()
    expect(a.resolve('cpqFxRateResolver')).toBe(a.resolve('cpqFxRateResolver'))
    expect(a.resolve('cpqFxRateResolver')).not.toBe(b.resolve('cpqFxRateResolver'))
  })

  it('is injected into the cost service (and stays optional for it)', () => {
    const { container } = setup({ currencies: false })
    const costService = container.resolve<CpqCostService>('cpqCostService')
    expect(costService.fxRateResolver).toBe(container.resolve('cpqFxRateResolver'))
    expect(new CpqCostService({ em: {} as never, featureTogglesService: featureTogglesService as never }).fxRateResolver).toBeUndefined()
  })
})
