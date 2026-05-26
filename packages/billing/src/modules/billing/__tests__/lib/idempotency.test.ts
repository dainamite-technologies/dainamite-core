import { findBySourceRef } from '../../lib/idempotency'

class FakeEntity {
  id = 'fake-id'
  sourceRef?: string | null
}

type MockEm = {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
}

function createMockEm(): MockEm {
  return { findOne: jest.fn() }
}

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa'
const ACCOUNT_ID = '00000000-0000-0000-0000-0000000000bb'

describe('findBySourceRef', () => {
  it('queries with the full idempotency scope (tenant, account, sourceRef, not deleted)', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    await findBySourceRef(em as never, FakeEntity, {
      tenantId: TENANT_ID,
      billAccountId: ACCOUNT_ID,
      sourceRef: 'cpq-sub-1-mrc',
    })

    expect(em.findOne).toHaveBeenCalledTimes(1)
    const [entity, where] = em.findOne.mock.calls[0]
    expect(entity).toBe(FakeEntity)
    expect(where).toEqual({
      tenantId: TENANT_ID,
      billAccountId: ACCOUNT_ID,
      sourceRef: 'cpq-sub-1-mrc',
      deletedAt: null,
    })
  })

  it('returns the existing row when one matches', async () => {
    const em = createMockEm()
    const existing = Object.assign(new FakeEntity(), { id: 'existing-uuid' })
    em.findOne.mockResolvedValueOnce(existing)

    const result = await findBySourceRef(em as never, FakeEntity, {
      tenantId: TENANT_ID,
      billAccountId: ACCOUNT_ID,
      sourceRef: 'cpq-sub-1-mrc',
    })

    expect(result).toBe(existing)
  })

  it('returns null when no row matches (caller proceeds with insert)', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    const result = await findBySourceRef(em as never, FakeEntity, {
      tenantId: TENANT_ID,
      billAccountId: ACCOUNT_ID,
      sourceRef: 'never-seen',
    })

    expect(result).toBeNull()
  })

  it('excludes soft-deleted rows (deletedAt IS NULL)', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null)

    await findBySourceRef(em as never, FakeEntity, {
      tenantId: TENANT_ID,
      billAccountId: ACCOUNT_ID,
      sourceRef: 'src',
    })

    const [, where] = em.findOne.mock.calls[0]
    expect((where as { deletedAt: unknown }).deletedAt).toBeNull()
  })
})
