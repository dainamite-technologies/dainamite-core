import { DefaultCpqWizardService } from '../cpqWizardService'
import { CpqWizardDefinition } from '../../data/entities'
import type { TenantScope } from '../types'

interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
  findAndCount: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<[unknown[], number]>
  >
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  assign: jest.MockedFunction<(entity: unknown, updates: Record<string, unknown>) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    assign: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

const NOW = new Date('2026-01-15T12:00:00Z')

function makeWizardEntity(overrides: Partial<CpqWizardDefinition> = {}): CpqWizardDefinition {
  return {
    id: 'wiz-1',
    code: 'access-port-wizard',
    name: 'Access Port Wizard',
    description: null,
    version: 1,
    steps: [],
    applicability: null,
    paramsSchema: null,
    surface: 'backend',
    isActive: true,
    metadata: null,
    organizationId: SCOPE.organizationId,
    tenantId: SCOPE.tenantId,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as CpqWizardDefinition
}

describe('DefaultCpqWizardService.listDefinitions', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('paginates results with the default page size', async () => {
    em.findAndCount.mockResolvedValueOnce([[makeWizardEntity()], 1])

    const result = await service.listDefinitions({}, SCOPE)

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
    expect(result.total).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(result.items).toHaveLength(1)

    const [, where, options] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      deletedAt: null,
    })
    expect(options).toMatchObject({ limit: 50, offset: 0 })
  })

  it('respects an explicit page and pageSize', async () => {
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listDefinitions({}, SCOPE, 3, 20)
    const [, , options] = em.findAndCount.mock.calls[0]
    expect(options).toMatchObject({ limit: 20, offset: 40 })
  })

  it('filters by surface when provided (and ignores "any")', async () => {
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listDefinitions({ surface: 'portal' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ surface: 'portal' })

    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listDefinitions({ surface: 'any' }, SCOPE)
    const [, whereAny] = em.findAndCount.mock.calls[1]
    expect(whereAny).not.toHaveProperty('surface')
  })

  it('filters by isActive when provided', async () => {
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listDefinitions({ isActive: false }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ isActive: false })
  })

  it('computes totalPages correctly', async () => {
    em.findAndCount.mockResolvedValueOnce([[], 47])
    const result = await service.listDefinitions({}, SCOPE, 1, 10)
    expect(result.totalPages).toBe(5)
  })
})

describe('DefaultCpqWizardService.getDefinition', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('looks up by id when given a UUID', async () => {
    em.findOne.mockResolvedValueOnce(makeWizardEntity())

    const result = await service.getDefinition('11111111-1111-4111-8111-111111111111', SCOPE)

    expect(result).not.toBeNull()
    const [, where] = em.findOne.mock.calls[0]
    expect(where).toMatchObject({ id: '11111111-1111-4111-8111-111111111111' })
    expect(where).not.toHaveProperty('code')
  })

  it('looks up by code when given a non-UUID string', async () => {
    em.findOne.mockResolvedValueOnce(makeWizardEntity())

    await service.getDefinition('access-port-wizard', SCOPE)

    const [, where] = em.findOne.mock.calls[0]
    expect(where).toMatchObject({ code: 'access-port-wizard' })
    expect(where).not.toHaveProperty('id')
  })

  it('returns null when no entity is found', async () => {
    em.findOne.mockResolvedValueOnce(null)
    const result = await service.getDefinition('missing', SCOPE)
    expect(result).toBeNull()
  })
})

describe('DefaultCpqWizardService.createDefinition', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('creates and flushes a new definition with tenant scope injected', async () => {
    const created = makeWizardEntity({ code: 'new-wiz', name: 'New Wiz' })
    em.create.mockReturnValueOnce(created)

    const result = await service.createDefinition(
      { code: 'new-wiz', name: 'New Wiz', steps: [{ stepId: 's1' }] },
      SCOPE,
    )

    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)

    const [, data] = em.create.mock.calls[0]
    expect(data).toMatchObject({
      code: 'new-wiz',
      name: 'New Wiz',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })
    expect(result.code).toBe('new-wiz')
  })
})

describe('DefaultCpqWizardService.updateDefinition', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('returns null when entity does not exist', async () => {
    em.findOne.mockResolvedValueOnce(null)
    const result = await service.updateDefinition('missing', { name: 'X' }, SCOPE)
    expect(result).toBeNull()
    expect(em.assign).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('applies updates and flushes when entity is found', async () => {
    const entity = makeWizardEntity({ version: 1 })
    em.findOne.mockResolvedValueOnce(entity)

    await service.updateDefinition('wiz-1', { name: 'Updated' }, SCOPE)

    expect(em.assign).toHaveBeenCalledWith(entity, { name: 'Updated' })
    expect(em.flush).toHaveBeenCalled()
  })

  it('does NOT bump version when only name/description change', async () => {
    const entity = makeWizardEntity({ version: 3 })
    em.findOne.mockResolvedValueOnce(entity)

    await service.updateDefinition('wiz-1', { name: 'New Name' }, SCOPE)

    const [, updates] = em.assign.mock.calls[0]
    expect(updates).not.toHaveProperty('version')
  })

  it('bumps version when steps change', async () => {
    const entity = makeWizardEntity({ version: 5 })
    em.findOne.mockResolvedValueOnce(entity)

    await service.updateDefinition('wiz-1', { steps: [{ stepId: 's-new' }] }, SCOPE)

    const [, updates] = em.assign.mock.calls[0]
    expect(updates).toMatchObject({ version: 6 })
  })

  it('bumps version when applicability changes', async () => {
    const entity = makeWizardEntity({ version: 2 })
    em.findOne.mockResolvedValueOnce(entity)

    await service.updateDefinition('wiz-1', { applicability: { surface: 'portal' } }, SCOPE)

    const [, updates] = em.assign.mock.calls[0]
    expect(updates).toMatchObject({ version: 3 })
  })
})

describe('DefaultCpqWizardService.deleteDefinition', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('returns false when entity does not exist', async () => {
    em.findOne.mockResolvedValueOnce(null)
    expect(await service.deleteDefinition('missing', SCOPE)).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('soft-deletes by setting deletedAt and flushes', async () => {
    const entity = makeWizardEntity({ deletedAt: null })
    em.findOne.mockResolvedValueOnce(entity)

    const result = await service.deleteDefinition('wiz-1', SCOPE)

    expect(result).toBe(true)
    expect(entity.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
  })
})

describe('DefaultCpqWizardService.resolveWizard', () => {
  let em: MockEm
  let service: DefaultCpqWizardService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqWizardService(em as unknown as never)
  })

  it('returns null when no active definitions exist', async () => {
    em.find.mockResolvedValueOnce([])
    const result = await service.resolveWizard({ surface: 'backend' }, SCOPE)
    expect(result).toBeNull()
  })

  it('queries by surface OR "any"', async () => {
    em.find.mockResolvedValueOnce([])
    await service.resolveWizard({ surface: 'portal' }, SCOPE)
    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({
      surface: { $in: ['portal', 'any'] },
      isActive: true,
      deletedAt: null,
    })
  })

  it('returns the only matching definition when one is found', async () => {
    em.find.mockResolvedValueOnce([makeWizardEntity({ code: 'only-one' })])
    const result = await service.resolveWizard({ surface: 'backend' }, SCOPE)
    expect(result?.code).toBe('only-one')
  })

  it('picks highest priority among multiple matches', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({ id: 'low', code: 'low', applicability: { priority: 1 } }),
      makeWizardEntity({ id: 'high', code: 'high', applicability: { priority: 100 } }),
      makeWizardEntity({ id: 'mid', code: 'mid', applicability: { priority: 10 } }),
    ])

    const result = await service.resolveWizard({ surface: 'backend' }, SCOPE)
    expect(result?.code).toBe('high')
  })

  it('treats no applicability as priority 0 (loses to anything positive)', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({ id: 'no-app', code: 'no-app', applicability: null }),
      makeWizardEntity({ id: 'with', code: 'with', applicability: { priority: 5 } }),
    ])

    const result = await service.resolveWizard({ surface: 'backend' }, SCOPE)
    expect(result?.code).toBe('with')
  })

  it('skips definitions whose applicability.surface does not match the context surface', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({ id: 'portal-only', code: 'p', applicability: { surface: 'portal', priority: 100 } }),
      makeWizardEntity({ id: 'backend', code: 'b', applicability: { surface: 'backend', priority: 1 } }),
    ])

    const result = await service.resolveWizard({ surface: 'backend' }, SCOPE)
    expect(result?.code).toBe('b')
  })

  it('skips definitions whose specCodes filter excludes the context spec', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({
        id: 'a',
        code: 'a',
        applicability: { specCodes: ['SPEC-A'], priority: 100 },
      }),
      makeWizardEntity({
        id: 'b',
        code: 'b',
        applicability: { priority: 1 },
      }),
    ])

    const result = await service.resolveWizard({ surface: 'backend', specCode: 'SPEC-B' }, SCOPE)
    expect(result?.code).toBe('b')
  })

  it('matches when context spec IS in applicability.specCodes', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({
        id: 'a',
        code: 'a',
        applicability: { specCodes: ['SPEC-A'], priority: 100 },
      }),
      makeWizardEntity({
        id: 'b',
        code: 'b',
        applicability: { priority: 1 },
      }),
    ])

    const result = await service.resolveWizard({ surface: 'backend', specCode: 'SPEC-A' }, SCOPE)
    expect(result?.code).toBe('a')
  })

  it('skips definitions whose customerSegments filter excludes the context segment', async () => {
    em.find.mockResolvedValueOnce([
      makeWizardEntity({
        id: 'enterprise',
        code: 'enterprise',
        applicability: { customerSegments: ['enterprise'], priority: 100 },
      }),
      makeWizardEntity({ id: 'general', code: 'general', applicability: { priority: 1 } }),
    ])

    const result = await service.resolveWizard(
      { surface: 'backend', customerSegment: 'smb' },
      SCOPE,
    )
    expect(result?.code).toBe('general')
  })
})
