import type { CpqUseCaseTenantSpec } from '../api'

jest.mock('@open-mercato/core/modules/auth/lib/setup-app', () => ({
  setupInitialTenant: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  User: class FakeUser {},
  Role: class FakeRole {},
  UserRole: class FakeUserRole {},
}))

jest.mock('@open-mercato/core/modules/auth/lib/emailHash', () => ({
  computeEmailHash: (email: string) => `hash:${email}`,
}))

jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: class {},
}))

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: () => ({}),
}))

jest.mock('bcryptjs', () => ({
  hash: async (value: string) => `bcrypt:${value}`,
}))

import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureDemoTenant, findDemoTenant } from '../tenant-provisioning'

const setupMock = setupInitialTenant as jest.MockedFunction<typeof setupInitialTenant>
const findMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const baseSpec: CpqUseCaseTenantSpec = {
  slug: 'gix',
  tenantName: 'GIX Tenant',
  organizationName: 'GIX',
  adminEmail: 'admin@gix.com',
  adminPassword: 'secret',
}

const fakeEm = {} as any
const fakeContainer = {} as any

describe('ensureDemoTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a new tenant and returns created=true', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-1',
      organizationId: 'o-1',
      reusedExistingUser: false,
      users: [
        { user: { id: 'u-1', email: 'admin@gix.com' } as any, roles: ['admin'], created: true },
      ],
    })

    const result = await ensureDemoTenant(fakeEm, fakeContainer, baseSpec)

    expect(result).toEqual({
      tenantId: 't-1',
      organizationId: 'o-1',
      adminUserId: 'u-1',
      created: true,
    })
    expect(setupMock).toHaveBeenCalledWith(
      fakeEm,
      expect.objectContaining({
        orgName: 'GIX',
        roleNames: ['admin', 'employee'],
        primaryUserRoles: ['admin'],
        includeSuperadminRole: false,
        includeDerivedUsers: false,
        primaryUser: expect.objectContaining({
          email: 'admin@gix.com',
          password: 'secret',
          confirm: true,
        }),
      }),
    )
  })

  it('reuses an existing tenant idempotently and returns created=false', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-1',
      organizationId: 'o-1',
      reusedExistingUser: true,
      users: [
        { user: { id: 'u-1', email: 'admin@gix.com' } as any, roles: ['admin'], created: false },
      ],
    })

    const result = await ensureDemoTenant(fakeEm, fakeContainer, baseSpec)

    expect(result.created).toBe(false)
    expect(result.tenantId).toBe('t-1')
    expect(result.adminUserId).toBe('u-1')
  })

  it('falls back to findOneWithDecryption when admin not in user snapshots', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-2',
      organizationId: 'o-2',
      reusedExistingUser: false,
      users: [],
    })
    findMock.mockResolvedValueOnce({ id: 'u-2', email: 'admin@gix.com' } as any)

    const result = await ensureDemoTenant(fakeEm, fakeContainer, baseSpec)

    expect(result.adminUserId).toBe('u-2')
    expect(findMock).toHaveBeenCalledWith(
      fakeEm,
      expect.anything(),
      { email: 'admin@gix.com' },
      expect.anything(),
      { tenantId: 't-2', organizationId: 'o-2' },
    )
  })

  it('throws if admin user cannot be resolved', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-3',
      organizationId: 'o-3',
      reusedExistingUser: false,
      users: [],
    })
    findMock.mockResolvedValueOnce(null)

    await expect(ensureDemoTenant(fakeEm, fakeContainer, baseSpec)).rejects.toThrow(
      /failed to resolve admin user id/,
    )
  })

  it('honours role overrides on the spec', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-4',
      organizationId: 'o-4',
      reusedExistingUser: false,
      users: [
        { user: { id: 'u-4', email: 'admin@puffin.com' } as any, roles: ['admin'], created: true },
      ],
    })

    await ensureDemoTenant(fakeEm, fakeContainer, {
      ...baseSpec,
      slug: 'puffin',
      adminEmail: 'admin@puffin.com',
      tenantName: 'Puffin Tenant',
      organizationName: 'Puffin Cloud',
      roleNames: ['admin', 'employee', 'sales'],
      primaryUserRoles: ['admin', 'sales'],
      includeDerivedUsers: true,
    })

    expect(setupMock).toHaveBeenCalledWith(
      fakeEm,
      expect.objectContaining({
        orgName: 'Puffin Cloud',
        roleNames: ['admin', 'employee', 'sales'],
        primaryUserRoles: ['admin', 'sales'],
        includeDerivedUsers: true,
      }),
    )
  })

  it('forwards the modules list to setupInitialTenant so role ACLs are merged', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-mods',
      organizationId: 'o-mods',
      reusedExistingUser: false,
      users: [
        { user: { id: 'u-mods', email: 'admin@gix.com' } as any, roles: ['admin'], created: true },
      ],
    })
    const fakeModules = [{ id: 'dashboards' }, { id: 'cpq' }] as any

    await ensureDemoTenant(fakeEm, fakeContainer, baseSpec, { modules: fakeModules })

    expect(setupMock).toHaveBeenCalledWith(
      fakeEm,
      expect.objectContaining({ modules: fakeModules }),
    )
  })

  it('provisions additionalUsers with their roles after the admin tenant exists', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-add',
      organizationId: 'o-add',
      reusedExistingUser: false,
      users: [
        { user: { id: 'u-admin', email: 'admin@gix.com' } as any, roles: ['admin'], created: true },
      ],
    })
    // 1) lookup existing additional user (none) → create path
    findMock.mockResolvedValueOnce(null)
    // 2) lookup employee role → exists
    findMock.mockResolvedValueOnce({ id: 'r-emp', name: 'employee', tenantId: 't-add' } as any)
    // 3) lookup existing UserRole link → none → create
    findMock.mockResolvedValueOnce(null)

    const persisted: any[] = []
    const created: any[] = []
    const trackingEm: any = {
      persist: (entity: any) => persisted.push(entity),
      flush: jest.fn().mockResolvedValue(undefined),
      create: (Class: any, data: any) => {
        const instance = Object.assign(new Class(), data)
        created.push(instance)
        return instance
      },
    }

    await ensureDemoTenant(trackingEm, fakeContainer, {
      ...baseSpec,
      additionalUsers: [
        { email: 'employee@gix.com', password: 'secret', displayName: 'GIX Employee' },
      ],
    })

    const userRecord = created.find((c) => c.email === 'employee@gix.com')
    expect(userRecord).toBeDefined()
    expect(userRecord.tenantId).toBe('t-add')
    expect(userRecord.organizationId).toBe('o-add')
    expect(userRecord.passwordHash).toBe('bcrypt:secret')
    expect(userRecord.emailHash).toBe('hash:employee@gix.com')
    expect(userRecord.isConfirmed).toBe(true)
    expect(persisted).toContain(userRecord)
    // UserRole link was also persisted
    expect(persisted.length).toBeGreaterThanOrEqual(2)
  })

  it('skips re-creating an additionalUser that already exists but still ensures role link', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-exist',
      organizationId: 'o-exist',
      reusedExistingUser: true,
      users: [
        { user: { id: 'u-admin', email: 'admin@gix.com' } as any, roles: ['admin'], created: false },
      ],
    })
    const existingEmployee = {
      id: 'u-emp',
      email: 'employee@gix.com',
      tenantId: 't-exist',
      organizationId: 'o-exist',
      isConfirmed: true,
    }
    findMock.mockResolvedValueOnce(existingEmployee as any) // user lookup
    findMock.mockResolvedValueOnce({ id: 'r-emp', name: 'employee', tenantId: 't-exist' } as any) // role lookup
    findMock.mockResolvedValueOnce({ id: 'ur-1' } as any) // existing UserRole link

    const persisted: any[] = []
    const created: any[] = []
    const trackingEm: any = {
      persist: (entity: any) => persisted.push(entity),
      flush: jest.fn().mockResolvedValue(undefined),
      create: (Class: any, data: any) => {
        const instance = Object.assign(new Class(), data)
        created.push(instance)
        return instance
      },
    }

    await ensureDemoTenant(trackingEm, fakeContainer, {
      ...baseSpec,
      additionalUsers: [{ email: 'employee@gix.com', password: 'secret' }],
    })

    // No new User row was created
    expect(created.find((c) => c.email === 'employee@gix.com')).toBeUndefined()
    // No new UserRole row was persisted (link already existed)
    expect(created.length).toBe(0)
  })

  it('defaults orgName to tenantName when organizationName is omitted', async () => {
    setupMock.mockResolvedValueOnce({
      tenantId: 't-5',
      organizationId: 'o-5',
      reusedExistingUser: false,
      users: [
        { user: { id: 'u-5', email: 'admin@gix.com' } as any, roles: ['admin'], created: true },
      ],
    })

    await ensureDemoTenant(fakeEm, fakeContainer, {
      slug: 'gix',
      tenantName: 'Acme Demo',
      adminEmail: 'admin@gix.com',
      adminPassword: 'secret',
    })

    expect(setupMock).toHaveBeenCalledWith(
      fakeEm,
      expect.objectContaining({ orgName: 'Acme Demo' }),
    )
  })
})

describe('findDemoTenant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the resolved tenant when admin user exists', async () => {
    findMock.mockResolvedValueOnce({
      id: 'u-7',
      tenantId: 't-7',
      organizationId: 'o-7',
    } as any)

    const result = await findDemoTenant(fakeEm, baseSpec)

    expect(result).toEqual({
      tenantId: 't-7',
      organizationId: 'o-7',
      adminUserId: 'u-7',
      created: false,
    })
  })

  it('returns null when admin user is missing', async () => {
    findMock.mockResolvedValueOnce(null)
    const result = await findDemoTenant(fakeEm, baseSpec)
    expect(result).toBeNull()
  })

  it('returns null when admin user has no tenant scope', async () => {
    findMock.mockResolvedValueOnce({
      id: 'u-9',
      tenantId: null,
      organizationId: null,
    } as any)
    const result = await findDemoTenant(fakeEm, baseSpec)
    expect(result).toBeNull()
  })
})
