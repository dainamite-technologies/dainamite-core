jest.mock('@dainamite/cpq/modules/cpq/lib/seeds/tenant-provisioning', () => ({
  ensureDemoTenant: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  ensureCustomRoleAcls: jest.fn(),
}))

import { ensureDemoTenant } from '@dainamite/cpq/modules/cpq/lib/seeds/tenant-provisioning'
import { ensureCustomRoleAcls } from '@open-mercato/core/modules/auth/lib/setup-app'
import { seedUseCase, seedUseCases } from '../runner'
import type { CpqUseCase } from '@dainamite/cpq/modules/cpq/lib/seeds/api'

const ensureMock = ensureDemoTenant as jest.MockedFunction<typeof ensureDemoTenant>
const ensureAclsMock = ensureCustomRoleAcls as jest.MockedFunction<typeof ensureCustomRoleAcls>

const fakeEm = {} as any
const fakeContainer = {} as any

const buildUseCase = (id: string): CpqUseCase => ({
  id,
  tenant: {
    slug: id,
    tenantName: `${id} Tenant`,
    adminEmail: `admin@${id}.com`,
    adminPassword: 'secret',
  },
  seedDefaults: jest.fn(async () => undefined),
  seedExamples: jest.fn(async () => undefined),
})

describe('demo_tenants runner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('seeds a single use case end-to-end with examples', async () => {
    ensureMock.mockResolvedValueOnce({
      tenantId: 't-gix',
      organizationId: 'o-gix',
      adminUserId: 'u-gix',
      created: true,
    })

    const otherModule = {
      id: 'other',
      setup: { seedDefaults: jest.fn(), seedExamples: jest.fn() },
    } as any
    const orchestrator = { id: 'demo_tenants', setup: { seedExamples: jest.fn() } } as any
    const useCase = buildUseCase('gix')
    const processedTenantIds = new Set<string>()

    const out = await seedUseCase(useCase, {
      em: fakeEm,
      container: fakeContainer,
      modules: [otherModule, orchestrator],
      withExamples: true,
      processedTenantIds,
    })

    expect(out).toMatchObject({
      useCaseId: 'gix',
      tenantId: 't-gix',
      organizationId: 'o-gix',
      created: true,
    })
    expect(processedTenantIds.has('t-gix')).toBe(true)
    expect(otherModule.setup.seedDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-gix', organizationId: 'o-gix' }),
    )
    expect(otherModule.setup.seedExamples).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-gix', organizationId: 'o-gix' }),
    )
    // Orchestrator is filtered out — recursion guard.
    expect(orchestrator.setup.seedExamples).not.toHaveBeenCalled()

    expect(useCase.seedDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-gix', organizationId: 'o-gix', withExamples: true }),
    )
    expect(useCase.seedExamples).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-gix', organizationId: 'o-gix', withExamples: true }),
    )
    expect(ensureAclsMock).toHaveBeenCalledWith(fakeEm, 't-gix', expect.any(Array))
  })

  it('skips example seeders when withExamples=false', async () => {
    ensureMock.mockResolvedValueOnce({
      tenantId: 't-puffin',
      organizationId: 'o-puffin',
      adminUserId: 'u-puffin',
      created: true,
    })

    const m = { id: 'a', setup: { seedDefaults: jest.fn(), seedExamples: jest.fn() } } as any
    const useCase = buildUseCase('puffin')

    await seedUseCase(useCase, {
      em: fakeEm,
      container: fakeContainer,
      modules: [m],
      withExamples: false,
      processedTenantIds: new Set(),
    })

    expect(m.setup.seedDefaults).toHaveBeenCalledTimes(1)
    expect(m.setup.seedExamples).not.toHaveBeenCalled()
    expect(useCase.seedDefaults).toHaveBeenCalledTimes(1)
    expect(useCase.seedExamples).not.toHaveBeenCalled()
  })

  it('reports created=false when ensureDemoTenant reused an existing tenant', async () => {
    ensureMock.mockResolvedValueOnce({
      tenantId: 't-x',
      organizationId: 'o-x',
      adminUserId: 'u-x',
      created: false,
    })

    const out = await seedUseCase(buildUseCase('gix'), {
      em: fakeEm,
      container: fakeContainer,
      modules: [],
      withExamples: false,
      processedTenantIds: new Set(),
    })

    expect(out.created).toBe(false)
  })

  it('seeds multiple use cases sequentially preserving order', async () => {
    ensureMock
      .mockResolvedValueOnce({
        tenantId: 't-gix',
        organizationId: 'o-gix',
        adminUserId: 'u-gix',
        created: true,
      })
      .mockResolvedValueOnce({
        tenantId: 't-puffin',
        organizationId: 'o-puffin',
        adminUserId: 'u-puffin',
        created: true,
      })

    const outcomes = await seedUseCases([buildUseCase('gix'), buildUseCase('puffin')], {
      em: fakeEm,
      container: fakeContainer,
      modules: [],
      withExamples: false,
      processedTenantIds: new Set(),
    })

    expect(outcomes.map((o) => o.useCaseId)).toEqual(['gix', 'puffin'])
    expect(outcomes.map((o) => o.tenantId)).toEqual(['t-gix', 't-puffin'])
  })

  it('skips the orchestrator module in seedDefaults loop too (recursion guard)', async () => {
    ensureMock.mockResolvedValueOnce({
      tenantId: 't-gix',
      organizationId: 'o-gix',
      adminUserId: 'u-gix',
      created: true,
    })

    const orchestrator = {
      id: 'demo_tenants',
      setup: { seedDefaults: jest.fn(), seedExamples: jest.fn() },
    } as any
    const real = { id: 'real', setup: { seedDefaults: jest.fn() } } as any

    await seedUseCase(buildUseCase('gix'), {
      em: fakeEm,
      container: fakeContainer,
      modules: [orchestrator, real],
      withExamples: false,
      processedTenantIds: new Set(),
    })

    expect(orchestrator.setup.seedDefaults).not.toHaveBeenCalled()
    expect(real.setup.seedDefaults).toHaveBeenCalledTimes(1)
  })

  it('records elapsed durationMs in the outcome', async () => {
    ensureMock.mockResolvedValueOnce({
      tenantId: 't-x',
      organizationId: 'o-x',
      adminUserId: 'u-x',
      created: true,
    })

    const out = await seedUseCase(buildUseCase('gix'), {
      em: fakeEm,
      container: fakeContainer,
      modules: [],
      withExamples: false,
      processedTenantIds: new Set(),
    })

    expect(typeof out.durationMs).toBe('number')
    expect(out.durationMs).toBeGreaterThanOrEqual(0)
  })
})
