import {
  registerCpqUseCase,
  clearCpqUseCases,
  type CpqUseCase,
} from '../../cpq/lib/seeds/api'
import { getEnabledUseCases, shouldSkipExamples } from '../manifest'

const buildUseCase = (id: string): CpqUseCase => ({
  id,
  tenant: {
    slug: id,
    tenantName: `${id} Tenant`,
    adminEmail: `admin@${id}.com`,
    adminPassword: 'secret',
  },
  seedDefaults: jest.fn(),
})

const ENV_KEYS = ['CPQ_DEMO_USE_CASES', 'CPQ_DEMO_SKIP_EXAMPLES', 'OM_INIT_NO_EXAMPLES'] as const

describe('demo_tenants manifest', () => {
  let original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>

  beforeEach(() => {
    original = {}
    for (const key of ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
    clearCpqUseCases()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    clearCpqUseCases()
  })

  describe('getEnabledUseCases', () => {
    it('returns gix and puffin by default when both are registered', () => {
      registerCpqUseCase(buildUseCase('gix'))
      registerCpqUseCase(buildUseCase('puffin'))
      registerCpqUseCase(buildUseCase('extra'))
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix', 'puffin'])
    })

    it('returns nothing when no use cases are registered', () => {
      expect(getEnabledUseCases()).toEqual([])
    })

    it('returns empty when env is set to empty string', () => {
      process.env.CPQ_DEMO_USE_CASES = ''
      registerCpqUseCase(buildUseCase('gix'))
      expect(getEnabledUseCases()).toEqual([])
    })

    it('returns all when env is *', () => {
      process.env.CPQ_DEMO_USE_CASES = '*'
      registerCpqUseCase(buildUseCase('gix'))
      registerCpqUseCase(buildUseCase('puffin'))
      registerCpqUseCase(buildUseCase('telco'))
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix', 'puffin', 'telco'])
    })

    it('returns all when env is "all" (case-insensitive)', () => {
      process.env.CPQ_DEMO_USE_CASES = 'ALL'
      registerCpqUseCase(buildUseCase('gix'))
      registerCpqUseCase(buildUseCase('puffin'))
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix', 'puffin'])
    })

    it('returns explicit comma-separated list', () => {
      process.env.CPQ_DEMO_USE_CASES = 'gix , telco'
      registerCpqUseCase(buildUseCase('gix'))
      registerCpqUseCase(buildUseCase('puffin'))
      registerCpqUseCase(buildUseCase('telco'))
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix', 'telco'])
    })

    it('warns and skips unknown ids without throwing', () => {
      process.env.CPQ_DEMO_USE_CASES = 'gix,does-not-exist,puffin'
      registerCpqUseCase(buildUseCase('gix'))
      registerCpqUseCase(buildUseCase('puffin'))
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix', 'puffin'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'))
      warn.mockRestore()
    })

    it('only returns gix when puffin is missing from registry (default)', () => {
      registerCpqUseCase(buildUseCase('gix'))
      expect(getEnabledUseCases().map((u) => u.id)).toEqual(['gix'])
    })
  })

  describe('shouldSkipExamples', () => {
    it('returns false when no env is set', () => {
      expect(shouldSkipExamples()).toBe(false)
    })

    it('returns true when CPQ_DEMO_SKIP_EXAMPLES is truthy', () => {
      process.env.CPQ_DEMO_SKIP_EXAMPLES = '1'
      expect(shouldSkipExamples()).toBe(true)
      process.env.CPQ_DEMO_SKIP_EXAMPLES = 'true'
      expect(shouldSkipExamples()).toBe(true)
    })

    it('returns true when OM_INIT_NO_EXAMPLES is truthy', () => {
      process.env.OM_INIT_NO_EXAMPLES = 'yes'
      expect(shouldSkipExamples()).toBe(true)
    })

    it('returns false when env is set to falsy', () => {
      process.env.CPQ_DEMO_SKIP_EXAMPLES = '0'
      process.env.OM_INIT_NO_EXAMPLES = 'false'
      expect(shouldSkipExamples()).toBe(false)
    })
  })
})
