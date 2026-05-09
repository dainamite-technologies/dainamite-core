import { DefaultCpqInventoryService, type ArcLineChange } from '../cpqInventoryService'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'

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
    // applyLineChanges 'cancel' lookup
    em.findOne.mockResolvedValueOnce(cancelTarget)
    // assets attached to cancelled item (none)
    em.find.mockResolvedValueOnce([])
    // recomputeSubscriptionAggregatesInPlace — fetch active items
    em.find.mockResolvedValueOnce([item])
    // snapshotSubscription AFTER: items + assets
    em.find.mockResolvedValueOnce([item, cancelTarget])
    em.find.mockResolvedValueOnce([])

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
