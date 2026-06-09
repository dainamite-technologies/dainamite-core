import { seedCpqDemo, resetCpqDemo } from '../demo'

/**
 * In-memory mock EM mirroring the seed's find-or-create contract:
 * `findOne` matches the catalog product by `sku` and every CPQ row by
 * `code`; `create` mints an id; `persist` stores; `nativeDelete` is counted.
 */
function makeMockEm() {
  const store: Array<Record<string, unknown>> = []
  let idSeq = 0
  const em = {
    store,
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      return (
        store.find((row) => {
          if (typeof where.sku === 'string') return row.sku === where.sku
          if (typeof where.code === 'string') return row.code === where.code
          return false
        }) ?? null
      )
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `id-${++idSeq}`,
      ...data,
    })),
    persist: jest.fn((entity: Record<string, unknown>) => {
      store.push(entity)
      return entity
    }),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async () => 0),
  }
  return em as never as Parameters<typeof seedCpqDemo>[0] & {
    store: Array<Record<string, unknown>>
    nativeDelete: jest.Mock
  }
}

const SCOPE = { tenantId: 'tnt-1', organizationId: 'org-1' }

describe('seedCpqDemo', () => {
  it('creates the product, spec, offering and charge on a fresh tenant', async () => {
    const em = makeMockEm()
    const res = await seedCpqDemo(em, SCOPE)
    expect(res).toEqual({
      productsCreated: 1,
      specsCreated: 1,
      offeringsCreated: 1,
      chargesCreated: 1,
    })
  })

  it('is idempotent — a second run creates nothing', async () => {
    const em = makeMockEm()
    await seedCpqDemo(em, SCOPE)
    const second = await seedCpqDemo(em, SCOPE)
    expect(second).toEqual({
      productsCreated: 0,
      specsCreated: 0,
      offeringsCreated: 0,
      chargesCreated: 0,
    })
  })

  it('links the charge to the seeded offering (per-offering uniqueness)', async () => {
    const em = makeMockEm()
    await seedCpqDemo(em, SCOPE)
    const offering = em.store.find((r) => r.code === 'DEMO-CPQ-CLOUD-OFFER') as { id: string }
    const charge = em.store.find((r) => r.code === 'DEMO-CPQ-CLOUD-MRC') as { offeringId: string }
    expect(charge?.offeringId).toBe(offering?.id)
  })

  it('reset issues a delete for charge, offering, spec and product', async () => {
    const em = makeMockEm()
    await resetCpqDemo(em, SCOPE)
    expect(em.nativeDelete).toHaveBeenCalledTimes(4)
  })
})
