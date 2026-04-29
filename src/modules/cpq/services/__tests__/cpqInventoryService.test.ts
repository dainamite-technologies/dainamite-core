import { DefaultCpqInventoryService } from '../cpqInventoryService'
import type { TenantScope } from '../types'

interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
  findAndCount: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<[unknown[], number]>
  >
  count: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<number>>
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  persist: jest.MockedFunction<(entity: unknown) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

function makeService() {
  const em = createMockEm()
  const service = new DefaultCpqInventoryService(em as unknown as never)
  return { em, service }
}

describe('DefaultCpqInventoryService.transitionSubscriptionStatus', () => {
  it('rejects an illegal transition (pending → suspended)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', status: 'pending' })

    await expect(service.transitionSubscriptionStatus('s1', 'suspended', SCOPE)).rejects.toMatchObject({
      status: 409,
      error: "Cannot transition from 'pending' to 'suspended'",
    })
  })

  it('rejects transitions from terminal states', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', status: 'terminated' })

    await expect(service.transitionSubscriptionStatus('s1', 'active', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 404 when subscription does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(service.transitionSubscriptionStatus('missing', 'active', SCOPE)).rejects.toMatchObject({
      status: 404,
      error: 'Subscription not found',
    })
  })

  it('pending → active sets activatedAt and propagates status to items', async () => {
    const { em, service } = makeService()
    const sub = { id: 's1', status: 'pending', activatedAt: null, suspendedAt: null, terminatedAt: null }
    em.findOne.mockResolvedValueOnce(sub)
    const item1 = { id: 'i1', status: 'pending' }
    const item2 = { id: 'i2', status: 'pending' }
    em.find.mockResolvedValueOnce([item1, item2]) // items
    em.find.mockResolvedValueOnce([]) // assets

    await service.transitionSubscriptionStatus('s1', 'active', SCOPE)

    expect(sub.status).toBe('active')
    expect(sub.activatedAt).toBeInstanceOf(Date)
    expect(item1.status).toBe('active')
    expect(item2.status).toBe('active')
  })

  it('active → suspended sets suspendedAt and does NOT cascade to assets', async () => {
    const { em, service } = makeService()
    const sub = { id: 's1', status: 'active', activatedAt: new Date('2026-01-01'), suspendedAt: null, terminatedAt: null }
    em.findOne.mockResolvedValueOnce(sub)
    const item = { id: 'i1', status: 'active' }
    em.find.mockResolvedValueOnce([item]) // items only — no assets fetched for "suspended"

    await service.transitionSubscriptionStatus('s1', 'suspended', SCOPE)

    expect(sub.status).toBe('suspended')
    expect(sub.suspendedAt).toBeInstanceOf(Date)
    expect(item.status).toBe('suspended')
    // No assets query for suspended target
    expect(em.find).toHaveBeenCalledTimes(1)
  })

  it('suspended → active clears suspendedAt and re-activates non-returned assets', async () => {
    const { em, service } = makeService()
    const sub = {
      id: 's1',
      status: 'suspended',
      activatedAt: new Date('2026-01-01'),
      suspendedAt: new Date('2026-02-01'),
      terminatedAt: null,
    }
    em.findOne.mockResolvedValueOnce(sub)
    em.find.mockResolvedValueOnce([{ id: 'i1', status: 'suspended' }])
    const asset = { id: 'a1', status: 'delivered' }
    em.find.mockResolvedValueOnce([asset])

    await service.transitionSubscriptionStatus('s1', 'active', SCOPE)

    expect(sub.status).toBe('active')
    expect(sub.suspendedAt).toBeNull()
    expect(asset.status).toBe('active')

    // Verify the asset find excluded only "returned" status
    const [, assetWhere] = em.find.mock.calls[1]
    expect(assetWhere).toMatchObject({ status: { $nin: ['returned'] } })
  })

  it('active → terminated sets terminatedAt and cancels all non-returned/cancelled assets', async () => {
    const { em, service } = makeService()
    const sub = {
      id: 's1',
      status: 'active',
      activatedAt: new Date(),
      suspendedAt: null,
      terminatedAt: null,
    }
    em.findOne.mockResolvedValueOnce(sub)
    em.find.mockResolvedValueOnce([{ id: 'i1', status: 'active' }])
    const asset = { id: 'a1', status: 'active' }
    em.find.mockResolvedValueOnce([asset])

    await service.transitionSubscriptionStatus('s1', 'terminated', SCOPE)

    expect(sub.status).toBe('terminated')
    expect(sub.terminatedAt).toBeInstanceOf(Date)
    expect(asset.status).toBe('cancelled')

    const [, assetWhere] = em.find.mock.calls[1]
    expect(assetWhere).toMatchObject({ status: { $nin: ['returned', 'cancelled'] } })
  })

  it('skips already-terminated/expired items in the cascade query', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', status: 'pending', activatedAt: null })
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([])

    await service.transitionSubscriptionStatus('s1', 'active', SCOPE)

    const [, itemWhere] = em.find.mock.calls[0]
    expect(itemWhere).toMatchObject({
      subscriptionId: 's1',
      status: { $nin: ['terminated', 'expired'] },
    })
  })
})

describe('DefaultCpqInventoryService.transitionAssetStatus', () => {
  it('rejects an illegal transition (active → cancelled)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'a1', status: 'active' })

    await expect(service.transitionAssetStatus('a1', 'cancelled', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('allows pending → delivered', async () => {
    const { em, service } = makeService()
    const asset = { id: 'a1', status: 'pending' }
    em.findOne.mockResolvedValueOnce(asset)

    const result = await service.transitionAssetStatus('a1', 'delivered', SCOPE)

    expect(asset.status).toBe('delivered')
    expect(result).toBe(asset)
    expect(em.flush).toHaveBeenCalled()
  })

  it('allows delivered → returned', async () => {
    const { em, service } = makeService()
    const asset = { id: 'a1', status: 'delivered' }
    em.findOne.mockResolvedValueOnce(asset)

    await service.transitionAssetStatus('a1', 'returned', SCOPE)
    expect(asset.status).toBe('returned')
  })

  it('rejects transitions from terminal returned/cancelled', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'a1', status: 'returned' })

    await expect(service.transitionAssetStatus('a1', 'active', SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('throws 404 when asset does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(service.transitionAssetStatus('missing', 'active', SCOPE)).rejects.toMatchObject({
      status: 404,
      error: 'Asset not found',
    })
  })
})

describe('DefaultCpqInventoryService.createSubscription', () => {
  it('aggregates MRC and NRC sums across items', async () => {
    const { em, service } = makeService()

    const result = await service.createSubscription(
      {
        customerId: 'cust',
        name: 'My Sub',
        currencyCode: 'USD',
        items: [
          { name: 'A', mrcAmount: 10, nrcAmount: 5 },
          { name: 'B', mrcAmount: 20, nrcAmount: 0 },
          { name: 'C', mrcAmount: 0, nrcAmount: 15 },
        ],
      },
      SCOPE,
    )

    expect((result as { mrcAmount: string }).mrcAmount).toBe('30')
    expect((result as { nrcAmount: string }).nrcAmount).toBe('20')
    expect(em.flush).toHaveBeenCalled()
  })

  it('uses the provided code or generates SUB-YYYY-NNNNN', async () => {
    const { em, service } = makeService()
    em.count.mockResolvedValueOnce(7)

    const sub = await service.createSubscription(
      {
        customerId: 'cust',
        name: 'NoCode',
        currencyCode: 'USD',
        items: [{ name: 'item' }],
      },
      SCOPE,
    )

    const expectedSeq = String(8).padStart(5, '0')
    const year = new Date().getFullYear()
    expect((sub as { code: string }).code).toBe(`SUB-${year}-${expectedSeq}`)
  })

  it('honors an explicit code', async () => {
    const { service } = makeService()
    const sub = await service.createSubscription(
      {
        customerId: 'cust',
        code: 'CUSTOM-001',
        name: 'WithCode',
        currencyCode: 'USD',
        items: [{ name: 'item' }],
      },
      SCOPE,
    )
    expect((sub as { code: string }).code).toBe('CUSTOM-001')
  })

  it('defaults billingCycle to monthly and autoRenew to true', async () => {
    const { service } = makeService()
    const sub = await service.createSubscription(
      {
        customerId: 'cust',
        name: 'X',
        currencyCode: 'USD',
        items: [{ name: 'item' }],
      },
      SCOPE,
    )
    expect((sub as { billingCycle: string }).billingCycle).toBe('monthly')
    expect((sub as { autoRenew: boolean }).autoRenew).toBe(true)
  })

  it('initializes new subscription status to "pending"', async () => {
    const { service } = makeService()
    const sub = await service.createSubscription(
      {
        customerId: 'cust',
        name: 'X',
        currencyCode: 'USD',
        items: [{ name: 'item' }],
      },
      SCOPE,
    )
    expect((sub as { status: string }).status).toBe('pending')
  })
})

describe('DefaultCpqInventoryService.addSubscriptionItem', () => {
  it('throws 404 when subscription does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(
      service.addSubscriptionItem('missing', { name: 'x' }, SCOPE),
    ).rejects.toMatchObject({ status: 404, error: 'Subscription not found' })
  })

  it('throws 404 when parentItemId does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', currencyCode: 'USD', customerId: 'c1' }) // sub
    em.findOne.mockResolvedValueOnce(null) // parent

    await expect(
      service.addSubscriptionItem('s1', { name: 'x', parentItemId: 'missing-parent' }, SCOPE),
    ).rejects.toMatchObject({ status: 404, error: 'Parent item not found' })
  })

  it('throws 409 when parent belongs to a different subscription', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', currencyCode: 'USD', customerId: 'c1' })
    em.findOne.mockResolvedValueOnce({ id: 'parent-1', subscriptionId: 'other-sub' })

    await expect(
      service.addSubscriptionItem('s1', { name: 'x', parentItemId: 'parent-1' }, SCOPE),
    ).rejects.toMatchObject({
      status: 409,
      error: 'Parent item does not belong to this subscription',
    })
  })

  it('inherits subscription currency and uses pending status, then recomputes aggregates', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({
      id: 's1',
      customerId: 'c1',
      currencyCode: 'EUR',
    })
    // recomputeSubscriptionAggregates flow:
    em.find.mockResolvedValueOnce([{ mrcAmount: '5', nrcAmount: '3' }])
    em.findOne.mockResolvedValueOnce({ id: 's1', mrcAmount: '0', nrcAmount: '0' })

    const item = await service.addSubscriptionItem(
      's1',
      { name: 'New Item', mrcAmount: 5, nrcAmount: 3 },
      SCOPE,
    )

    expect((item as { currencyCode: string }).currencyCode).toBe('EUR')
    expect((item as { status: string }).status).toBe('pending')
    expect(em.flush).toHaveBeenCalledTimes(2) // create + recompute
  })
})

describe('DefaultCpqInventoryService.listSubscriptions', () => {
  it('clamps pageSize to [1, 100]', async () => {
    const { em, service } = makeService()
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listSubscriptions({ pageSize: 500 }, SCOPE)
    const [, , options] = em.findAndCount.mock.calls[0]
    expect(options).toMatchObject({ limit: 100 })
  })

  it('translates a status array into a $in filter', async () => {
    const { em, service } = makeService()
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listSubscriptions({ status: ['active', 'suspended'] }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ status: { $in: ['active', 'suspended'] } })
  })

  it('passes a single status as a scalar', async () => {
    const { em, service } = makeService()
    em.findAndCount.mockResolvedValueOnce([[], 0])
    await service.listSubscriptions({ status: 'active' }, SCOPE)
    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({ status: 'active' })
  })

  it('returns empty results when no subscriptions reference the given productId', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([]) // no items match productId

    const result = await service.listSubscriptions({ productId: 'p1' }, SCOPE)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(em.findAndCount).not.toHaveBeenCalled()
  })

  it('narrows the subscription query to ids referencing the given productId', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([
      { subscriptionId: 's1' },
      { subscriptionId: 's2' },
      { subscriptionId: 's1' }, // duplicate filtered out
    ])
    em.findAndCount.mockResolvedValueOnce([
      [{ id: 's1' }, { id: 's2' }],
      2,
    ])

    await service.listSubscriptions({ productId: 'p1' }, SCOPE)

    const [, where] = em.findAndCount.mock.calls[0]
    expect(where.id).toEqual({ $in: ['s1', 's2'] })
  })
})

describe('DefaultCpqInventoryService.getSubscription', () => {
  it('throws 404 when subscription is missing', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(service.getSubscription('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('builds an items tree from the flat list (parents → children)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({
      id: 's1',
      customerId: 'c',
      currencyCode: 'USD',
    })
    em.find.mockResolvedValueOnce([
      {
        id: 'parent',
        subscriptionId: 's1',
        parentItemId: null,
        name: 'Parent',
        status: 'active',
        configuration: {},
        charges: null,
        mrcAmount: '0',
        nrcAmount: '0',
        currencyCode: 'USD',
        quantity: 1,
        capacityTotal: null,
        capacityUsed: null,
        capacityUnit: null,
        metadata: null,
        sortOrder: 1,
      },
      {
        id: 'child-1',
        subscriptionId: 's1',
        parentItemId: 'parent',
        name: 'Child 1',
        status: 'active',
        configuration: {},
        charges: null,
        mrcAmount: '0',
        nrcAmount: '0',
        currencyCode: 'USD',
        quantity: 1,
        capacityTotal: null,
        capacityUsed: null,
        capacityUnit: null,
        metadata: null,
        sortOrder: 2,
      },
      {
        id: 'child-2',
        subscriptionId: 's1',
        parentItemId: 'parent',
        name: 'Child 2',
        status: 'active',
        configuration: {},
        charges: null,
        mrcAmount: '0',
        nrcAmount: '0',
        currencyCode: 'USD',
        quantity: 1,
        capacityTotal: null,
        capacityUsed: null,
        capacityUnit: null,
        metadata: null,
        sortOrder: 3,
      },
    ])

    const result = await service.getSubscription('s1', SCOPE)
    const items = (result as { items: Array<{ id: string; children: Array<{ id: string }> }> }).items

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('parent')
    expect(items[0].children).toHaveLength(2)
    expect(items[0].children.map((c) => c.id)).toEqual(['child-1', 'child-2'])
  })

  it('treats orphans (parentItemId pointing nowhere) as roots', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', customerId: 'c', currencyCode: 'USD' })
    em.find.mockResolvedValueOnce([
      {
        id: 'orphan',
        subscriptionId: 's1',
        parentItemId: 'never-existed',
        name: 'Orphan',
        status: 'active',
        configuration: {},
        charges: null,
        mrcAmount: '0',
        nrcAmount: '0',
        currencyCode: 'USD',
        quantity: 1,
        capacityTotal: null,
        capacityUsed: null,
        capacityUnit: null,
        metadata: null,
        sortOrder: 1,
      },
    ])

    const result = await service.getSubscription('s1', SCOPE)
    const items = (result as { items: Array<{ id: string }> }).items
    expect(items.map((i) => i.id)).toEqual(['orphan'])
  })
})

describe('DefaultCpqInventoryService.getCustomerInventory', () => {
  it('excludes terminal statuses by default', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValue([])

    await service.getCustomerInventory('cust-1', {}, SCOPE)

    const [, subWhere] = em.find.mock.calls[0]
    const [, itemWhere] = em.find.mock.calls[1]
    const [, assetWhere] = em.find.mock.calls[2]

    expect(subWhere).toMatchObject({ status: { $nin: ['terminated', 'expired'] } })
    expect(itemWhere).toMatchObject({ status: { $nin: ['terminated', 'expired'] } })
    expect(assetWhere).toMatchObject({ status: { $nin: ['returned'] } })
  })

  it('includes everything when includeTerminated=true', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValue([])

    await service.getCustomerInventory('cust-1', { includeTerminated: true }, SCOPE)

    const [, subWhere] = em.find.mock.calls[0]
    expect(subWhere).not.toHaveProperty('status')
  })

  it('explicit status filter overrides the default exclusion', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValue([])

    await service.getCustomerInventory('cust-1', { status: 'active' }, SCOPE)

    const [, subWhere] = em.find.mock.calls[0]
    expect(subWhere).toMatchObject({ status: { $in: ['active'] } })
  })

  it('summary counts active subscriptions, sums their MRC, counts active assets and pending items', async () => {
    const { em, service } = makeService()
    em.find
      .mockResolvedValueOnce([
        { status: 'active', mrcAmount: '100', currencyCode: 'USD' },
        { status: 'active', mrcAmount: '50', currencyCode: 'USD' },
        { status: 'suspended', mrcAmount: '999', currencyCode: 'USD' }, // not counted
      ])
      .mockResolvedValueOnce([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'active' },
      ])
      .mockResolvedValueOnce([
        { status: 'active', currencyCode: 'USD' },
        { status: 'active', currencyCode: 'USD' },
        { status: 'pending', currencyCode: 'USD' },
      ])

    const result = await service.getCustomerInventory('cust', {}, SCOPE)

    expect(result.summary).toMatchObject({
      activeSubscriptions: 2,
      totalMrc: 150,
      activeAssets: 2,
      pendingItems: 2,
      currencyCode: 'USD',
    })
  })
})

describe('DefaultCpqInventoryService.getCustomerParentItems', () => {
  it('queries only active items with parentItemId=null for the customer', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([])

    await service.getCustomerParentItems('cust-1', {}, SCOPE)

    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({
      customerId: 'cust-1',
      parentItemId: null,
      status: 'active',
    })
  })

  it('applies productId and offeringId filters', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([])

    await service.getCustomerParentItems('cust', { productId: 'p', offeringId: 'o' }, SCOPE)

    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({ productId: 'p', offeringId: 'o' })
  })
})

describe('DefaultCpqInventoryService — soft delete + 404s for missing resources', () => {
  it('deleteSubscription throws 404 when subscription is missing', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(service.deleteSubscription('missing', SCOPE)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('deleteSubscription soft-deletes when found', async () => {
    const { em, service } = makeService()
    const sub = { id: 's1', deletedAt: null }
    em.findOne.mockResolvedValueOnce(sub)

    const result = await service.deleteSubscription('s1', SCOPE)

    expect(sub.deletedAt).toBeInstanceOf(Date)
    expect(result).toEqual({ success: true })
    expect(em.flush).toHaveBeenCalled()
  })

  it('deleteAsset throws 404 when missing', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(service.deleteAsset('missing', SCOPE)).rejects.toMatchObject({ status: 404 })
  })

  it('deleteAsset soft-deletes when found', async () => {
    const { em, service } = makeService()
    const asset = { id: 'a1', deletedAt: null }
    em.findOne.mockResolvedValueOnce(asset)

    await service.deleteAsset('a1', SCOPE)
    expect(asset.deletedAt).toBeInstanceOf(Date)
  })
})

describe('DefaultCpqInventoryService.createAsset', () => {
  it('throws 404 when subscriptionId is provided but does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null) // subscription lookup

    await expect(
      service.createAsset(
        { customerId: 'c', subscriptionId: 'missing', name: 'A', currencyCode: 'USD' },
        SCOPE,
      ),
    ).rejects.toMatchObject({ status: 404, error: 'Subscription not found' })
  })

  it('throws 404 when subscriptionItemId is provided but does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'sub-1' }) // subscription
    em.findOne.mockResolvedValueOnce(null) // subscription item

    await expect(
      service.createAsset(
        {
          customerId: 'c',
          subscriptionId: 'sub-1',
          subscriptionItemId: 'missing-item',
          name: 'A',
          currencyCode: 'USD',
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({ status: 404, error: 'Subscription item not found' })
  })

  it('defaults assetType to "one_time" and status to "pending"', async () => {
    const { service } = makeService()

    const asset = await service.createAsset(
      { customerId: 'c', name: 'A', currencyCode: 'USD' },
      SCOPE,
    )

    expect((asset as { assetType: string }).assetType).toBe('one_time')
    expect((asset as { status: string }).status).toBe('pending')
  })

  it('generates AST-YYYY-NNNNN code when not provided', async () => {
    const { em, service } = makeService()
    em.count.mockResolvedValueOnce(2)

    const asset = await service.createAsset(
      { customerId: 'c', name: 'A', currencyCode: 'USD' },
      SCOPE,
    )

    const expectedSeq = String(3).padStart(5, '0')
    const year = new Date().getFullYear()
    expect((asset as { code: string }).code).toBe(`AST-${year}-${expectedSeq}`)
  })
})

describe('DefaultCpqInventoryService.listAssets', () => {
  it('applies multiple filters: customerId, status (array), assetType, productId, subscription scope', async () => {
    const { em, service } = makeService()
    em.findAndCount.mockResolvedValueOnce([[], 0])

    await service.listAssets(
      {
        customerId: 'c',
        status: ['active', 'delivered'],
        assetType: 'license',
        productId: 'p',
        subscriptionId: 's',
        subscriptionItemId: 'si',
      },
      SCOPE,
    )

    const [, where] = em.findAndCount.mock.calls[0]
    expect(where).toMatchObject({
      customerId: 'c',
      status: { $in: ['active', 'delivered'] },
      assetType: 'license',
      productId: 'p',
      subscriptionId: 's',
      subscriptionItemId: 'si',
    })
  })
})
