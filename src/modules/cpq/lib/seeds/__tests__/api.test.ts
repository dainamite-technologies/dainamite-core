import {
  registerCpqUseCase,
  listCpqUseCases,
  getCpqUseCase,
  clearCpqUseCases,
  type CpqUseCase,
} from '../api'

const buildUseCase = (id: string, overrides: Partial<CpqUseCase> = {}): CpqUseCase => ({
  id,
  tenant: {
    slug: id,
    tenantName: `${id} Tenant`,
    adminEmail: `admin@${id}.com`,
    adminPassword: 'secret',
  },
  seedDefaults: jest.fn(async () => undefined),
  ...overrides,
})

describe('cpq seed registry', () => {
  beforeEach(() => clearCpqUseCases())

  it('registers and lists a use case', () => {
    const uc = buildUseCase('gix')
    registerCpqUseCase(uc)
    expect(listCpqUseCases()).toEqual([uc])
    expect(getCpqUseCase('gix')).toBe(uc)
  })

  it('preserves registration order across multiple use cases', () => {
    const a = buildUseCase('alpha')
    const b = buildUseCase('beta')
    const c = buildUseCase('gamma')
    registerCpqUseCase(a)
    registerCpqUseCase(b)
    registerCpqUseCase(c)
    expect(listCpqUseCases().map((u) => u.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('returns undefined for unknown ids', () => {
    expect(getCpqUseCase('does-not-exist')).toBeUndefined()
  })

  it('overwrites and warns on duplicate id (HMR-friendly)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = buildUseCase('gix')
    const second = buildUseCase('gix')
    registerCpqUseCase(first)
    registerCpqUseCase(second)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gix"'))
    expect(listCpqUseCases()).toEqual([second])
    expect(getCpqUseCase('gix')).toBe(second)
    warn.mockRestore()
  })

  it('rejects use cases with no id', () => {
    expect(() => registerCpqUseCase(buildUseCase('') as CpqUseCase)).toThrow(/id is required/)
  })

  it('rejects use cases without an admin email', () => {
    const broken: CpqUseCase = {
      id: 'gix',
      // @ts-expect-error — exercising the runtime guard
      tenant: { slug: 'gix', tenantName: 'GIX', adminPassword: 'secret' },
      seedDefaults: jest.fn(),
    }
    expect(() => registerCpqUseCase(broken)).toThrow(/adminEmail/)
  })

  it('rejects use cases without seedDefaults', () => {
    const broken = {
      id: 'gix',
      tenant: { slug: 'gix', tenantName: 'GIX', adminEmail: 'admin@gix.com', adminPassword: 'secret' },
    } as unknown as CpqUseCase
    expect(() => registerCpqUseCase(broken)).toThrow(/seedDefaults/)
  })

  it('clearCpqUseCases empties the registry', () => {
    registerCpqUseCase(buildUseCase('gix'))
    registerCpqUseCase(buildUseCase('puffin'))
    expect(listCpqUseCases()).toHaveLength(2)
    clearCpqUseCases()
    expect(listCpqUseCases()).toHaveLength(0)
  })
})
