/**
 * Unit tests for `billing.items.bulk_create`.
 *
 * Focus: the batching contract — one account query, one idempotency
 * query, one flush — plus the dedup paths (existing source_ref,
 * in-batch repeated source_ref) and the missing-account 404.
 */

import { bulkCreateItemsCommand } from '../../commands/items'
import { BillingAccount, BillingItem } from '../../data/entities'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_A = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_B = '44444444-4444-4444-8444-444444444444'

type FakeItem = {
  id: string
  billAccountId: string
  sourceRef: string | null
}

type Env = {
  ctx: { container: { resolve: jest.MockedFunction<(name: string) => unknown> }; auth: null }
  em: {
    find: jest.MockedFunction<(entity: unknown, where: unknown) => Promise<unknown[]>>
    create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
    persist: jest.MockedFunction<(entity: unknown) => unknown>
    flush: jest.MockedFunction<() => Promise<void>>
    fork: jest.MockedFunction<() => Env['em']>
  }
  flushCount: () => number
  persistedCount: () => number
}

let createSeq = 0

function createEnv(
  options: {
    existingAccountIds?: string[]
    existingItems?: FakeItem[]
  } = {},
): Env {
  const existingAccountIds = options.existingAccountIds ?? [ACCOUNT_A, ACCOUNT_B]
  const existingItems = options.existingItems ?? []
  let flushes = 0
  let persists = 0

  const em: Env['em'] = {
    find: jest.fn(async (entity: unknown, where: unknown) => {
      const ctor = (entity as { name?: string }).name ?? ''
      if (ctor === 'BillingAccount') {
        const ids = (where as { id?: { $in?: string[] } }).id?.$in ?? []
        return ids
          .filter((id) => existingAccountIds.includes(id))
          .map((id) => ({ id, tenantId: TENANT, organizationId: ORG }))
      }
      if (ctor === 'BillingItem') {
        const refs = (where as { sourceRef?: { $in?: string[] } }).sourceRef?.$in ?? []
        const accountIds = (where as { billAccountId?: { $in?: string[] } }).billAccountId?.$in ?? []
        return existingItems.filter(
          (it) =>
            it.sourceRef != null &&
            refs.includes(it.sourceRef) &&
            accountIds.includes(it.billAccountId),
        )
      }
      return []
    }) as never,
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      createSeq += 1
      return { ...data, id: `new-item-${createSeq}` }
    }) as never,
    persist: jest.fn(() => {
      persists += 1
    }) as never,
    flush: jest.fn(async () => {
      flushes += 1
    }) as never,
    fork: jest.fn() as never,
  }
  em.fork = jest.fn(() => em) as never

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return { markOrmEntityChange: jest.fn() }
      return null
    }) as never,
  }

  return {
    ctx: { container, auth: null },
    em,
    flushCount: () => flushes,
    persistedCount: () => persists,
  }
}

beforeEach(() => {
  createSeq = 0
})

function recurringEntry(billAccountId: string, sourceRef?: string) {
  // `billStartDate` is a Date here because `BillingItemBulkCreateInput`
  // is the *parsed* schema type (`z.coerce.date()` output). The route
  // layer hands the command already-coerced values.
  return {
    billAccountId,
    type: 'recurring' as const,
    billStartDate: new Date('2026-05-01T00:00:00.000Z'),
    description: 'MRC',
    rateJson: { unit_price: 49.99 } as unknown,
    ...(sourceRef ? { sourceRef } : {}),
  }
}

describe('bulkCreateItemsCommand', () => {
  it('creates every item in a clean batch with a single flush', async () => {
    const env = createEnv()
    const result = await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [
          recurringEntry(ACCOUNT_A, 'ref-1'),
          recurringEntry(ACCOUNT_A, 'ref-2'),
          recurringEntry(ACCOUNT_B, 'ref-3'),
        ],
      },
      env.ctx as never,
    )
    expect(result.created).toBe(3)
    expect(result.deduplicated).toBe(0)
    expect(result.items).toHaveLength(3)
    // The batching contract: ONE flush for the whole batch.
    expect(env.flushCount()).toBe(1)
    expect(env.persistedCount()).toBe(3)
  })

  it('uses a single batched idempotency query (not one per item)', async () => {
    const env = createEnv()
    await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [
          recurringEntry(ACCOUNT_A, 'ref-1'),
          recurringEntry(ACCOUNT_A, 'ref-2'),
          recurringEntry(ACCOUNT_A, 'ref-3'),
        ],
      },
      env.ctx as never,
    )
    // find calls: 1 for BillingAccount, 1 for BillingItem idempotency.
    const billingItemFinds = env.em.find.mock.calls.filter(
      (call) => (call[0] as { name?: string }).name === 'BillingItem',
    )
    expect(billingItemFinds).toHaveLength(1)
  })

  it('dedups against an existing source_ref (returns the existing id)', async () => {
    const env = createEnv({
      existingItems: [{ id: 'existing-99', billAccountId: ACCOUNT_A, sourceRef: 'ref-dup' }],
    })
    const result = await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [
          recurringEntry(ACCOUNT_A, 'ref-dup'),
          recurringEntry(ACCOUNT_A, 'ref-new'),
        ],
      },
      env.ctx as never,
    )
    expect(result.created).toBe(1)
    expect(result.deduplicated).toBe(1)
    const dup = result.items.find((i) => i.sourceRef === 'ref-dup')
    expect(dup).toMatchObject({ id: 'existing-99', deduplicated: true })
  })

  it('dedups a source_ref repeated within the same payload (first wins)', async () => {
    const env = createEnv()
    const result = await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [
          recurringEntry(ACCOUNT_A, 'ref-twice'),
          recurringEntry(ACCOUNT_A, 'ref-twice'),
        ],
      },
      env.ctx as never,
    )
    // Only ONE row actually persisted — the unique index would
    // otherwise reject the second on flush.
    expect(result.created).toBe(1)
    expect(result.deduplicated).toBe(1)
    expect(env.persistedCount()).toBe(1)
  })

  it('items without source_ref are always created (no dedup)', async () => {
    const env = createEnv()
    const result = await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [recurringEntry(ACCOUNT_A), recurringEntry(ACCOUNT_A)],
      },
      env.ctx as never,
    )
    expect(result.created).toBe(2)
    expect(result.deduplicated).toBe(0)
  })

  it('throws 404 when any referenced account is missing', async () => {
    const env = createEnv({ existingAccountIds: [ACCOUNT_A] })
    await expect(
      bulkCreateItemsCommand.execute(
        {
          tenantId: TENANT,
          organizationId: ORG,
          items: [recurringEntry(ACCOUNT_A), recurringEntry(ACCOUNT_B)],
        },
        env.ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 404,
      body: expect.objectContaining({ billAccountId: ACCOUNT_B }),
    })
  })

  it('queries the distinct account ids in one $in (not one per item)', async () => {
    const env = createEnv()
    await bulkCreateItemsCommand.execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        items: [
          recurringEntry(ACCOUNT_A),
          recurringEntry(ACCOUNT_A),
          recurringEntry(ACCOUNT_B),
        ],
      },
      env.ctx as never,
    )
    const accountFinds = env.em.find.mock.calls.filter(
      (call) => (call[0] as { name?: string }).name === 'BillingAccount',
    )
    expect(accountFinds).toHaveLength(1)
    const where = accountFinds[0][1] as { id?: { $in?: string[] } }
    // Distinct — A appears twice in the payload but once in the query.
    expect(new Set(where.id?.$in)).toEqual(new Set([ACCOUNT_A, ACCOUNT_B]))
  })
})

// Suppress unused-import warnings — the entity classes are referenced
// only through the mock's `.name` discriminator.
void BillingAccount
void BillingItem
