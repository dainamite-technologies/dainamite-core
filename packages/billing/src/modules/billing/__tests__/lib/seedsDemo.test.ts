import { seedBillingDemo, resetBillingDemo } from '../../lib/seeds/demo'

/**
 * In-memory mock EM that mirrors the find-or-create contract the seed relies
 * on: `findOne` matches accounts by `name` and items/usage by `sourceRef`,
 * `create` mints an id, `persist` stores, `nativeDelete` records calls.
 */
function makeMockEm() {
  const store: Array<Record<string, unknown>> = []
  let idSeq = 0
  const nativeDeleteCalls: unknown[] = []

  const em = {
    store,
    nativeDeleteCalls,
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      return (
        store.find((row) => {
          if (typeof where.name === 'string') return row.name === where.name
          if (typeof where.sourceRef === 'string') return row.sourceRef === where.sourceRef
          return false
        }) ?? null
      )
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      return { id: `id-${++idSeq}`, ...data }
    }),
    persist: jest.fn((entity: Record<string, unknown>) => {
      store.push(entity)
      return entity
    }),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async (_entity: unknown, where: unknown) => {
      nativeDeleteCalls.push(where)
      return 0
    }),
  }
  return em as never as Parameters<typeof seedBillingDemo>[0] & {
    store: Array<Record<string, unknown>>
    nativeDeleteCalls: unknown[]
  }
}

const SCOPE = { tenantId: 'tnt-1', organizationId: 'org-1' }
const NOW = new Date('2026-06-08T12:00:00Z')

describe('seedBillingDemo', () => {
  it('creates the demo accounts, items and usage on a fresh tenant', async () => {
    const em = makeMockEm()
    const res = await seedBillingDemo(em, SCOPE, { now: NOW })

    expect(res).toEqual({ accountsCreated: 2, itemsCreated: 3, usageCreated: 1 })
  })

  it('is idempotent — a second run creates nothing', async () => {
    const em = makeMockEm()
    await seedBillingDemo(em, SCOPE, { now: NOW })
    const second = await seedBillingDemo(em, SCOPE, { now: NOW })

    expect(second).toEqual({ accountsCreated: 0, itemsCreated: 0, usageCreated: 0 })
  })

  it('dates the primary account so the previous month is billable', async () => {
    const em = makeMockEm()
    await seedBillingDemo(em, SCOPE, { now: NOW })

    const account = em.store.find((r) => r.name === 'Demo — Northwind Telecom') as
      | { nextBillDate: Date }
      | undefined
    const usage = em.store.find((r) => r.sourceRef === 'demo-billing-nw-usage') as
      | { periodStart: Date; periodEnd: Date }
      | undefined

    // next_bill = 1st of the current (UTC) month → due for any later as-of date.
    expect(account?.nextBillDate.toISOString().slice(0, 10)).toBe('2026-06-01')
    // usage sits in the previous month, the period that run will cover.
    expect(usage?.periodStart.toISOString().slice(0, 10)).toBe('2026-05-01')
    expect(usage?.periodEnd.toISOString().slice(0, 10)).toBe('2026-05-31')
  })

  it('reset issues a delete for usage, items and accounts', async () => {
    const em = makeMockEm()
    await resetBillingDemo(em, SCOPE)
    expect(em.nativeDelete).toHaveBeenCalledTimes(3)
  })
})
