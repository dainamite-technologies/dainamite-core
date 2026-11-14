import { DefaultCpqInventoryService, type ArcLineChange } from '../cpqInventoryService'
import {
  CpqInventoryAsset,
  CpqInventoryCost,
  CpqInventorySubscription,
  CpqInventorySubscriptionItem,
  CpqProductSpecification,
  CpqSubscriptionChangeLog,
} from '../../data/entities'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'
import { createStatefulEm } from './_helpers/statefulEm'

// XD-250 ARC unit tests for cpqInventoryService.apply* primitives.
// Shared mock EM in `_helpers/mockEm.ts` is also consumed by
// cpqInventoryService.test.ts.

function makeService() {
  const em = createMockEm()
  const service = new DefaultCpqInventoryService(em as unknown as never)
  return { em, service }
}

function fakeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    organizationId: SCOPE.organizationId,
    tenantId: SCOPE.tenantId,
    customerId: 'cust-1',
    code: 'SUB-2026-00001',
    name: 'Test Subscription',
    status: 'active',
    billingCycle: 'monthly',
    currencyCode: 'USD',
    mrcAmount: '100',
    nrcAmount: '0',
    currentTermStart: new Date('2026-01-01'),
    currentTermEnd: new Date('2027-01-01'),
    termMonths: 12,
    autoRenew: true,
    activatedAt: new Date('2026-01-01'),
    suspendedAt: null,
    terminatedAt: null,
    mergedIntoSubscriptionId: null,
    lastChangeLogId: null,
    version: 1,
    sourceQuoteId: 'orig-q',
    sourceOrderId: 'orig-o',
    metadata: null,
    pricingSummary: null,
    description: null,
    startDate: null,
    ...overrides,
  }
}

function fakeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    subscriptionId: 'sub-1',
    customerId: 'cust-1',
    organizationId: SCOPE.organizationId,
    tenantId: SCOPE.tenantId,
    parentItemId: null,
    productId: null,
    offeringId: null,
    specId: null,
    name: 'Existing Item',
    status: 'active',
    configuration: {},
    charges: null,
    mrcAmount: '50',
    nrcAmount: '0',
    currencyCode: 'USD',
    quantity: 1,
    capacityTotal: null,
    capacityUsed: null,
    capacityUnit: null,
    sourceQuoteLineId: null,
    metadata: null,
    sortOrder: 0,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('DefaultCpqInventoryService.applyAmendment', () => {
  it('cancels an existing item and recomputes subscription MRC', async () => {
    const { em, service } = makeService()
    const sub = fakeSub({ mrcAmount: '100' })
    const item = fakeItem({ id: 'item-keep', mrcAmount: '50', status: 'active' })
    const cancelTarget = fakeItem({ id: 'item-cancel', mrcAmount: '50', status: 'active' })

    // findIdempotentChangeLog → no prior log
    em.findOne.mockResolvedValueOnce(null)
    // requireSubscription
    em.findOne.mockResolvedValueOnce(sub)
    // snapshotSubscription: items + assets BEFORE
    em.find.mockResolvedValueOnce([item, cancelTarget])
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([]) // inventory costs (one query per snapshot)
    // applyLineChanges 'cancel' lookup
    em.findOne.mockResolvedValueOnce(cancelTarget)
    // assets attached to cancelled item (none)
    em.find.mockResolvedValueOnce([])
    // recomputeSubscriptionAggregatesInPlace — fetch active items
    em.find.mockResolvedValueOnce([item])
    // snapshotSubscription AFTER: items + assets
    em.find.mockResolvedValueOnce([item, cancelTarget])
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([]) // inventory costs

    const lineChanges: ArcLineChange[] = [
      {
        action: 'cancel',
        sourceSubscriptionItemId: cancelTarget.id,
        quoteLineId: 'ql-cancel',
      },
    ]

    const result = await service.applyAmendment(
      {
        subscriptionId: sub.id,
        sourceQuoteId: 'q-arc',
        sourceOrderId: 'o-arc',
        performedByUserId: null,
        lineChanges,
      },
      SCOPE,
    )

    expect(cancelTarget.status).toBe('terminated')
    expect(sub.mrcAmount).toBe('50') // only item-keep remains
    expect(result.changeLog).toMatchObject({
      changeType: 'amend',
      sourceQuoteId: 'q-arc',
      sourceOrderId: 'o-arc',
    })
    expect(em.persist).toHaveBeenCalled() // ChangeLog row persisted
    expect(sub.lastChangeLogId).toBe(result.changeLog.id)
  })

  it('is idempotent on re-run with same (orderId, subId)', async () => {
    const { em, service } = makeService()
    const existingLog = {
      id: 'log-1',
      changeType: 'amend',
      sourceOrderId: 'o-arc',
      subscriptionId: 'sub-1',
      beforeSnapshot: null,
      afterSnapshot: null,
    }

    em.findOne.mockResolvedValueOnce(existingLog) // findIdempotentChangeLog returns existing
    const sub = fakeSub()
    em.findOne.mockResolvedValueOnce(sub) // requireSubscription

    const result = await service.applyAmendment(
      {
        subscriptionId: 'sub-1',
        sourceQuoteId: 'q-arc',
        sourceOrderId: 'o-arc',
        performedByUserId: null,
        lineChanges: [],
      },
      SCOPE,
    )

    expect(result.changeLog).toBe(existingLog)
    // No mutation: persist was not called for items/log
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('throws 400 when cancel line is missing sourceSubscriptionItemId', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)
    em.findOne.mockResolvedValueOnce(fakeSub())
    em.find.mockResolvedValueOnce([]) // snapshot items
    em.find.mockResolvedValueOnce([]) // snapshot assets

    await expect(
      service.applyAmendment(
        {
          subscriptionId: 'sub-1',
          sourceQuoteId: 'q-arc',
          sourceOrderId: 'o-arc',
          performedByUserId: null,
          lineChanges: [{ action: 'cancel' }],
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining('sourceSubscriptionItemId'),
    })
  })

  it('throws 400 when add line is missing itemInput', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)
    em.findOne.mockResolvedValueOnce(fakeSub())
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([])

    await expect(
      service.applyAmendment(
        {
          subscriptionId: 'sub-1',
          sourceQuoteId: 'q-arc',
          sourceOrderId: 'o-arc',
          performedByUserId: null,
          lineChanges: [{ action: 'add' }],
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining('itemInput'),
    })
  })
})

describe('DefaultCpqInventoryService.applyCancel', () => {
  it('terminates the subscription and writes a cancel ChangeLog with ETF + reason', async () => {
    const { em, service } = makeService()
    const sub = fakeSub({ status: 'active' })

    em.findOne.mockResolvedValueOnce(null) // findIdempotentChangeLog
    em.findOne.mockResolvedValueOnce(sub) // requireSubscription
    em.find.mockResolvedValueOnce([]) // snapshot items
    em.find.mockResolvedValueOnce([]) // snapshot assets

    // transitionSubscriptionStatus internals: findOne (sub) + find (items) + find (assets)
    em.findOne.mockResolvedValueOnce(sub)
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([])

    // requireSubscription (reload after transition)
    em.findOne.mockResolvedValueOnce(sub)
    // snapshot AFTER
    em.find.mockResolvedValueOnce([])
    em.find.mockResolvedValueOnce([])

    const result = await service.applyCancel(
      {
        subscriptionId: sub.id,
        sourceQuoteId: 'q-cancel',
        sourceOrderId: 'o-cancel',
        performedByUserId: 'user-1',
        etfAmount: '500.00',
        etfCurrency: 'USD',
        reasonCode: 'non-payment',
        reasonText: 'Account 90+ days past due',
      },
      SCOPE,
    )

    expect(sub.status).toBe('terminated')
    expect(result.changeLog).toMatchObject({
      changeType: 'cancel',
      reasonCode: 'non-payment',
      reasonText: 'Account 90+ days past due',
      etfAmount: '500.00',
      etfCurrency: 'USD',
    })
  })

  it('refuses to cancel a subscription that is already terminated', async () => {
    const { em, service } = makeService()
    const sub = fakeSub({ status: 'terminated' })

    em.findOne.mockResolvedValueOnce(null)
    em.findOne.mockResolvedValueOnce(sub)
    em.find.mockResolvedValueOnce([]) // snapshot items
    em.find.mockResolvedValueOnce([]) // snapshot assets

    await expect(
      service.applyCancel(
        {
          subscriptionId: sub.id,
          sourceQuoteId: 'q-cancel',
          sourceOrderId: 'o-cancel',
          performedByUserId: null,
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      status: 409,
      error: expect.stringContaining('terminated'),
    })
  })

  it('is idempotent on re-run with same (orderId, subId)', async () => {
    const { em, service } = makeService()
    const existingLog = {
      id: 'log-cancel',
      changeType: 'cancel',
      sourceOrderId: 'o-cancel',
      subscriptionId: 'sub-1',
    }
    em.findOne.mockResolvedValueOnce(existingLog)
    em.findOne.mockResolvedValueOnce(fakeSub())

    const result = await service.applyCancel(
      {
        subscriptionId: 'sub-1',
        sourceQuoteId: 'q-cancel',
        sourceOrderId: 'o-cancel',
        performedByUserId: null,
      },
      SCOPE,
    )

    expect(result.changeLog).toBe(existingLog)
  })
})

describe('DefaultCpqInventoryService.applyMergeRenewal', () => {
  it('refuses fewer than two source subscriptions', async () => {
    const { service } = makeService()
    await expect(
      service.applyMergeRenewal(
        {
          sourceIds: ['only-one'],
          term: { newTermStart: new Date(), newTermEnd: new Date() },
          mergeMeta: {},
          lineChanges: [],
          sourceQuoteId: 'q',
          sourceOrderId: 'o',
          performedByUserId: null,
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining('at least two'),
    })
  })

  it('refuses sources with mismatched customer / currency / billingCycle', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null) // existingSourceLogs probe — find call below
    em.find.mockResolvedValueOnce([]) // existingSourceLogs (none)
    em.find.mockResolvedValueOnce([
      fakeSub({ id: 's1', currencyCode: 'USD' }),
      fakeSub({ id: 's2', currencyCode: 'EUR' }),
    ])

    await expect(
      service.applyMergeRenewal(
        {
          sourceIds: ['s1', 's2'],
          term: { newTermStart: new Date(), newTermEnd: new Date() },
          mergeMeta: {},
          lineChanges: [],
          sourceQuoteId: 'q',
          sourceOrderId: 'o',
          performedByUserId: null,
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining('share customer'),
    })
  })
})

// ─── Snapshot shapes per change type (characterization) ─────────────────
//
// Freezes today's `before_snapshot` / `after_snapshot` shapes. Uncosted
// snapshots must stay byte-identical after the cost-plus carry-through
// (steps 6 and 13 only ADD `costs` keys on costed rows).

describe('change-log snapshot shapes per change type (characterization)', () => {
  let uuidCounter = 0
  beforeEach(() => {
    uuidCounter = 0
    jest.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
    )
  })
  afterEach(() => jest.restoreAllMocks())

  const T = { organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId, deletedAt: null }
  const itemRow = (over: Record<string, unknown> = {}) => ({ ...fakeItem(over) })
  const logsOf = (em: ReturnType<typeof createStatefulEm>) => em.rows(CpqSubscriptionChangeLog)

  const SUB_KEYS = [
    'id', 'code', 'name', 'status', 'billingCycle', 'currencyCode', 'mrcAmount', 'nrcAmount', 'currentTermStart',
    'currentTermEnd', 'termMonths', 'version', 'items', 'assets',
  ]
  const ITEM_KEYS = [
    'id', 'productId', 'offeringId', 'specId', 'name', 'status', 'configuration', 'mrcAmount', 'nrcAmount',
    'currencyCode', 'quantity', 'sourceQuoteLineId',
  ]
  const ASSET_KEYS = ['id', 'code', 'name', 'status', 'subscriptionItemId', 'productId']
  const keysOf = (value: unknown) => Object.keys(value as object).sort()

  it('created: no before snapshot; the after snapshot lists the new items and an empty assets array (assets are created afterwards)', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)

    const sub = await service.createSubscription(
      {
        customerId: 'cust-1',
        name: 'New sale',
        code: 'SUB-NEW',
        currencyCode: 'USD',
        sourceQuoteId: 'q-1',
        sourceOrderId: 'o-1',
        items: [{ name: 'Server', specId: 'spec-asset', mrcAmount: 10, nrcAmount: 5, sourceQuoteLineId: 'ql-1' }],
      },
      SCOPE,
    )

    const [log] = logsOf(em)
    expect(logsOf(em)).toHaveLength(1)
    expect(log.changeType).toBe('created')
    expect(log.beforeSnapshot).toBeNull()
    const after = log.afterSnapshot as Record<string, unknown>
    expect(keysOf(after)).toEqual([...SUB_KEYS].sort())
    expect(after).toMatchObject({ code: 'SUB-NEW', status: 'pending', mrcAmount: '10', nrcAmount: '5', assets: [] })
    const items = after.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(keysOf(items[0])).toEqual([...ITEM_KEYS].sort())
    expect(items[0]).toMatchObject({ name: 'Server', status: 'pending', sourceQuoteLineId: 'ql-1' })
    expect(log.lineChanges).toEqual([
      { action: 'add', itemId: items[0].id, sourceQuoteLineId: 'ql-1', mrcAmount: 10, nrcAmount: 5, quantity: 1 },
    ])
    expect(sub.lastChangeLogId).toBe(log.id)

    // The asset of an assetizable line is created AFTER the created snapshot, by a separate call.
    await service.createAsset(
      { customerId: 'cust-1', subscriptionId: sub.id, subscriptionItemId: items[0].id as string, name: 'Server', assetType: 'one_time', currencyCode: 'USD', specId: 'spec-asset' } as never,
      SCOPE,
    )
    expect((logsOf(em)[0].afterSnapshot as { assets: unknown[] }).assets).toEqual([])
    expect(logsOf(em)).toHaveLength(1)
  })

  it('amend: before and after snapshots with add (assetizable), modify and cancel line changes', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    em.seed(CpqInventorySubscription, [fakeSub()])
    em.seed(CpqInventorySubscriptionItem, [
      itemRow({ id: 'item-modify', mrcAmount: '50', sortOrder: 0 }),
      itemRow({ id: 'item-cancel', mrcAmount: '50', sortOrder: 1 }),
    ])
    em.seed(CpqProductSpecification, [{ ...T, id: 'spec-asset', isAssetizable: true }])
    em.seed(CpqInventoryAsset, [
      { ...T, id: 'asset-old', code: 'AST-OLD', name: 'Old asset', status: 'active', subscriptionId: 'sub-1', subscriptionItemId: 'item-cancel', productId: null },
    ])

    const result = await service.applyAmendment(
      {
        subscriptionId: 'sub-1',
        sourceQuoteId: 'q-arc',
        sourceOrderId: 'o-arc',
        performedByUserId: null,
        lineChanges: [
          { action: 'modify', quoteLineId: 'ql-m', sourceSubscriptionItemId: 'item-modify', modifyPatch: { mrcAmount: 80 } },
          { action: 'cancel', quoteLineId: 'ql-c', sourceSubscriptionItemId: 'item-cancel' },
          { action: 'add', quoteLineId: 'ql-a', itemInput: { name: 'New server', specId: 'spec-asset', mrcAmount: 20, nrcAmount: 0 } },
        ],
      },
      SCOPE,
    )

    expect(result.changeLog.changeType).toBe('amend')
    const before = result.changeLog.beforeSnapshot as Record<string, unknown>
    const after = result.changeLog.afterSnapshot as Record<string, unknown>
    expect(keysOf(before)).toEqual([...SUB_KEYS].sort())
    expect(keysOf(after)).toEqual([...SUB_KEYS].sort())
    const beforeItems = before.items as Array<Record<string, unknown>>
    const afterItems = after.items as Array<Record<string, unknown>>
    expect(beforeItems.map((i) => [i.id, i.status, i.mrcAmount])).toEqual([['item-modify', 'active', '50'], ['item-cancel', 'active', '50']])
    expect(afterItems.map((i) => [i.id, i.status, i.mrcAmount])).toEqual([
      ['item-modify', 'active', '80'], ['item-cancel', 'terminated', '50'], ['00000000-0000-4000-8000-000000000001', 'active', '20'],
    ])
    for (const item of [...beforeItems, ...afterItems]) expect(keysOf(item)).toEqual([...ITEM_KEYS].sort())
    // assets: the cancelled item's asset flips to cancelled; the add line materializes a pending asset
    expect(before.assets).toEqual([
      { id: 'asset-old', code: 'AST-OLD', name: 'Old asset', status: 'active', subscriptionItemId: 'item-cancel', productId: null },
    ])
    const afterAssets = after.assets as Array<Record<string, unknown>>
    expect(afterAssets.map((a) => [a.id, a.status, a.subscriptionItemId])).toEqual([
      ['asset-old', 'cancelled', 'item-cancel'], ['gen-1', 'pending', '00000000-0000-4000-8000-000000000001'],
    ])
    for (const asset of afterAssets) expect(keysOf(asset)).toEqual([...ASSET_KEYS].sort())
    expect(result.changeLog.lineChanges).toEqual([
      { action: 'modify', itemId: 'item-modify', quoteLineId: 'ql-m', mrcDelta: 30 },
      { action: 'cancel', itemId: 'item-cancel', quoteLineId: 'ql-c', mrcDelta: -50 },
      { action: 'add', itemId: '00000000-0000-4000-8000-000000000001', quoteLineId: 'ql-a', mrcAmount: 20, nrcAmount: 0, quantity: 1 },
    ])
    expect(after).toMatchObject({ mrcAmount: '100' })
  })

  it('renew: snapshots carry the old and the new term; the log carries a termChange', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    em.seed(CpqInventorySubscription, [fakeSub()])
    em.seed(CpqInventorySubscriptionItem, [itemRow({ id: 'item-1', mrcAmount: '50' })])

    const result = await service.applyRenewal(
      {
        subscriptionId: 'sub-1',
        sourceQuoteId: 'q-arc',
        sourceOrderId: 'o-arc',
        performedByUserId: null,
        term: { newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 },
        lineChanges: [{ action: 'modify', quoteLineId: 'ql-m', sourceSubscriptionItemId: 'item-1', modifyPatch: { mrcAmount: 60 } }],
      },
      SCOPE,
    )

    const before = result.changeLog.beforeSnapshot as Record<string, unknown>
    const after = result.changeLog.afterSnapshot as Record<string, unknown>
    expect(result.changeLog.changeType).toBe('renew')
    expect(before).toMatchObject({ currentTermStart: '2026-01-01T00:00:00.000Z', currentTermEnd: '2027-01-01T00:00:00.000Z', mrcAmount: '100' })
    expect(after).toMatchObject({ currentTermStart: '2027-01-01T00:00:00.000Z', currentTermEnd: '2028-01-01T00:00:00.000Z', mrcAmount: '60' })
    expect(keysOf(after)).toEqual([...SUB_KEYS].sort())
    expect(result.changeLog.termChange).toEqual({
      oldTermStart: '2026-01-01T00:00:00.000Z', newTermStart: '2027-01-01T00:00:00.000Z',
      oldTermEnd: '2027-01-01T00:00:00.000Z', newTermEnd: '2028-01-01T00:00:00.000Z', oldTermMonths: 12, newTermMonths: 12,
    })
  })

  it('cancel: the after snapshot shows the terminated subscription with terminated items and cancelled assets', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    em.seed(CpqInventorySubscription, [fakeSub()])
    em.seed(CpqInventorySubscriptionItem, [itemRow({ id: 'item-1' })])
    em.seed(CpqInventoryAsset, [
      { ...T, id: 'asset-1', code: 'AST-1', name: 'Asset', status: 'active', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', productId: null },
    ])

    const result = await service.applyCancel(
      { subscriptionId: 'sub-1', sourceQuoteId: 'q-arc', sourceOrderId: 'o-arc', performedByUserId: null, reasonCode: 'churn' } as never,
      SCOPE,
    )

    const before = result.changeLog.beforeSnapshot as { status: string; items: Array<{ status: string }>; assets: Array<{ status: string }> }
    const after = result.changeLog.afterSnapshot as typeof before
    expect(result.changeLog.changeType).toBe('cancel')
    expect([before.status, before.items[0].status, before.assets[0].status]).toEqual(['active', 'active', 'active'])
    expect([after.status, after.items[0].status, after.assets[0].status]).toEqual(['terminated', 'terminated', 'cancelled'])
    expect(result.changeLog.lineChanges).toBeNull()
    expect(keysOf(after)).toEqual([...SUB_KEYS].sort())
  })

  it('merge: source logs carry a before snapshot only; the merge-result log carries the after snapshot of M with cloned items', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    em.seed(CpqInventorySubscription, [fakeSub({ id: 'sub-a', code: 'SUB-A' }), fakeSub({ id: 'sub-b', code: 'SUB-B' })].map((s) => ({ ...s, ...T })))
    em.seed(CpqInventorySubscriptionItem, [
      itemRow({ id: 'item-a', subscriptionId: 'sub-a', name: 'A item' }),
      itemRow({ id: 'item-b', subscriptionId: 'sub-b', name: 'B item' }),
    ])
    em.seed(CpqInventoryAsset, [
      { ...T, id: 'asset-a', code: 'AST-A', name: 'Asset A', status: 'active', subscriptionId: 'sub-a', subscriptionItemId: 'item-a', productId: null },
    ])

    const merge = await service.applyMergeRenewal(
      {
        sourceIds: ['sub-a', 'sub-b'],
        sourceQuoteId: 'q-arc',
        sourceOrderId: 'o-arc',
        performedByUserId: null,
        term: { newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 },
        mergeMeta: { newSubCode: 'SUB-M', newSubName: 'Merged' },
        lineChanges: [],
      },
      SCOPE,
    )

    const result = merge.mergeResultChangeLog
    expect(result.changeType).toBe('merge-result')
    expect(result.beforeSnapshot).toBeNull()
    const after = result.afterSnapshot as { id: string; code: string; items: Array<Record<string, unknown>>; assets: Array<Record<string, unknown>> }
    expect(after.code).toBe('SUB-M')
    expect(after.items.map((i) => i.name)).toEqual(['A item', 'B item'])
    for (const item of after.items) {
      expect(keysOf(item)).toEqual([...ITEM_KEYS].sort())
      expect(item.sourceQuoteLineId).toBeNull() // carry-over marker
    }
    expect(after.items.map((i) => i.id)).not.toContain('item-a')
    expect(after.assets).toHaveLength(1)
    expect(after.assets[0].subscriptionItemId).toBe(after.items[0].id) // asset re-pointed to the cloned item
    expect(merge.sourceChangeLogs.map((l) => [l.changeType, l.afterSnapshot, l.mergedIntoSubscriptionId])).toEqual([
      ['merge-source', null, after.id], ['merge-source', null, after.id],
    ])
    for (const log of merge.sourceChangeLogs) {
      expect(keysOf(log.beforeSnapshot)).toEqual([...SUB_KEYS].sort())
    }
    expect(result.mergedFromSubscriptionIds).toEqual(['sub-a', 'sub-b'])
  })
})

// ─── Costs in snapshots (step 6) ────────────────────────────────────────

describe('change-log snapshots carry inventory costs', () => {
  const seed = (costKey: string, over: Record<string, unknown> = {}) => ({
    orderLineCostId: `olc-${costKey}`, costKey, chargeCode: null, origin: 'catalog', costElementId: null,
    name: `Cost ${costKey}`, role: 'price_basis', costType: 'one_off', source: 'supplier', costModel: 'fixed',
    valueStatus: 'known', valueOrigin: null, unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000',
    currencyCode: 'EUR', fxRate: null, fxRateDate: null, indexSnapshot: null, supplierId: 'sup-1', supplierName: 'Acme',
    supplierQuoteRef: 'Q-9', validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null,
    ...over,
  })

  it('created row: costed items and assets carry costs (sorted by key); uncosted owners have no costs key; one cost query', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    await service.createSubscription(
      {
        customerId: 'cust-1', name: 'Costed', code: 'SUB-C', currencyCode: 'EUR',
        items: [
          { name: 'Line A', mrcAmount: 10, costs: [seed('tail'), seed('base', { totalAmount: null, unitAmount: null })] },
          { name: 'Line B', mrcAmount: 5 },
        ],
        assets: [{ name: 'Server', costs: [seed('licence')] }],
      } as never,
      SCOPE,
    )
    const after = em.rows(CpqSubscriptionChangeLog)[0].afterSnapshot as {
      items: Array<{ name: string; costs?: Array<Record<string, unknown>> }>
      assets: Array<{ costs?: Array<Record<string, unknown>> }>
    }
    const [a, b] = after.items
    expect(a.costs?.map((c) => c.costKey)).toEqual(['base', 'tail'])
    expect(a.costs?.[1]).toMatchObject({
      costKey: 'tail', unitAmount: '270.0000', totalAmount: '270.0000', status: 'active', currencyCode: 'EUR',
      supplierId: 'sup-1', supplierQuoteRef: 'Q-9', role: 'price_basis', endedAt: null,
    })
    expect(Object.keys(b)).not.toContain('costs')
    expect(after.assets[0].costs?.map((c) => c.costKey)).toEqual(['licence'])
    const costFinds = em.find.mock.calls.filter(([entity]) => (entity as { name?: string }).name === 'CpqInventoryCost')
    // One per snapshot: the cost write's own existing-rows reads (items, assets) plus the single snapshot query.
    expect(costFinds.length - 2).toBe(1)
  })

  it('ended costs stay in the snapshot with status ended', async () => {
    const em = createStatefulEm()
    const service = new DefaultCpqInventoryService(em as unknown as never)
    await service.createSubscription(
      { customerId: 'cust-1', name: 'S', code: 'SUB-E', currencyCode: 'EUR', items: [{ name: 'Line A', mrcAmount: 1, costs: [seed('tail')] }] } as never,
      SCOPE,
    )
    const row = em.rows(CpqInventoryCost)[0]
    row.status = 'ended'
    row.endedAt = '2026-11-14'
    const sub = em.rows(CpqInventorySubscription)[0]
    const snap = await (service as unknown as { snapshotSubscription: (s: unknown, sc: unknown) => Promise<{ items: Array<{ costs: unknown[] }> }> })
      .snapshotSubscription(sub, SCOPE)
    expect(snap.items[0].costs).toEqual([expect.objectContaining({ status: 'ended', endedAt: '2026-11-14' })])
  })
})
