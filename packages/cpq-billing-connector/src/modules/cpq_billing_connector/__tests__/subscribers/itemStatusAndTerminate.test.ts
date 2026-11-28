import { planStatusWrites, type ExistingStatusPeriod, type StatusTargetItem } from '../../lib/itemStatus'
import {
  applyStatusChange,
  metadata as statusMetadata,
  type StatusBillingPort,
  type StatusChangedPayload,
} from '../../subscribers/cpq-subscription-item-status-changed'
import {
  applyTermination,
  buildTerminatedItemUpdates,
  metadata as terminatedMetadata,
  type TerminatedPayload,
} from '../../subscribers/cpq-subscription-terminated'
import { buildCancelledItemUpdates } from '../../subscribers/cpq-subscription-cancelled'

/**
 * Spec L §4.3 / contract C3: CPQ item status → billing status periods, and
 * terminate → end dates like cancel. Both persistent and idempotent on replay.
 */

const scope = { tenantId: 't-1', organizationId: 'o-1' }
const recurring: StatusTargetItem = { id: 'bi-1', type: 'recurring', billEndDate: null }

const period = (overrides: Partial<ExistingStatusPeriod> = {}): ExistingStatusPeriod => ({
  id: 'sp-1',
  billingItemId: 'bi-1',
  status: 'paused',
  fromDate: '2027-01-10',
  toDate: null,
  ...overrides,
})

describe('planStatusWrites', () => {
  it('pause → one status period with the charge behaviour and reason', () => {
    expect(
      planStatusWrites([recurring], [], {
        status: 'paused',
        fromDate: '2027-01-10',
        toDate: null,
        chargeBehavior: 'no_charge',
        reason: 'Customer travelling',
      }),
    ).toEqual({
      writes: [
        {
          kind: 'create',
          billingItemId: 'bi-1',
          status: 'paused',
          fromDate: '2027-01-10',
          toDate: null,
          chargeBehavior: 'no_charge',
          reason: 'Customer travelling',
        },
      ],
      conflicts: [],
    })
  })

  it('replayed pause writes nothing (no second period, no overlap error)', () => {
    expect(planStatusWrites([recurring], [period()], { status: 'paused', fromDate: '2027-01-10' })).toEqual({
      writes: [],
      conflicts: [],
    })
  })

  it('resume sets toDate = fromDate − 1 on the open period', () => {
    expect(planStatusWrites([recurring], [period()], { status: 'active', fromDate: '2027-02-01' }).writes).toEqual([
      { kind: 'update', id: 'sp-1', billingItemId: 'bi-1', toDate: '2027-01-31' },
    ])
  })

  it('replayed resume writes nothing', () => {
    expect(planStatusWrites([recurring], [period({ toDate: '2027-01-31' })], { status: 'active', fromDate: '2027-02-01' }).writes).toEqual([])
  })

  it('resume shortens a scheduled pause that ends later', () => {
    expect(
      planStatusWrites([recurring], [period({ toDate: '2027-03-31' })], { status: 'active', fromDate: '2027-02-15' }).writes,
    ).toEqual([{ kind: 'update', id: 'sp-1', billingItemId: 'bi-1', toDate: '2027-02-14' }])
  })

  it('resume on or before a pause start removes the pause (it never took effect)', () => {
    expect(planStatusWrites([recurring], [period()], { status: 'active', fromDate: '2027-01-10' }).writes).toEqual([
      { kind: 'delete', id: 'sp-1', billingItemId: 'bi-1' },
    ])
  })

  it('F5: a late / replayed resume never deletes a pause that starts after its fromDate', () => {
    // pause(01-10) → resume(02-01) → pause(03-01), then resume(02-01) replayed.
    const periods = [
      period({ id: 'sp-1', fromDate: '2027-01-10', toDate: '2027-01-31' }),
      period({ id: 'sp-2', fromDate: '2027-03-01', toDate: null }),
    ]
    expect(planStatusWrites([recurring], periods, { status: 'active', fromDate: '2027-02-01' })).toEqual({ writes: [], conflicts: [] })
  })

  it('F5: a late resume closes only the period covering its fromDate, never a later one', () => {
    // pause(01-10, open) and a scheduled suspension from 03-01; resume(02-01) arrives late.
    const periods = [
      period({ id: 'sp-1', fromDate: '2027-01-10', toDate: '2027-02-28' }),
      period({ id: 'sp-2', status: 'suspended', fromDate: '2027-03-01', toDate: null }),
    ]
    expect(planStatusWrites([recurring], periods, { status: 'active', fromDate: '2027-02-01' }).writes).toEqual([
      { kind: 'update', id: 'sp-1', billingItemId: 'bi-1', toDate: '2027-01-31' },
    ])
  })

  it('F5: a resume with no period covering its fromDate is a no-op', () => {
    expect(
      planStatusWrites([recurring], [period({ fromDate: '2027-03-01' })], { status: 'active', fromDate: '2027-02-01' }).writes,
    ).toEqual([])
  })

  it('grace → suspended closes the grace period the day before, then creates the suspension', () => {
    const plan = planStatusWrites([recurring], [period({ status: 'grace', fromDate: '2027-01-01' })], {
      status: 'suspended',
      fromDate: '2027-01-20',
    })
    expect(plan.writes).toEqual([
      { kind: 'update', id: 'sp-1', billingItemId: 'bi-1', toDate: '2027-01-19' },
      { kind: 'create', billingItemId: 'bi-1', status: 'suspended', fromDate: '2027-01-20', toDate: null, reason: null },
    ])
  })

  it('a different status already starting inside the new range is a conflict, not a write', () => {
    const plan = planStatusWrites([recurring], [period({ status: 'suspended', fromDate: '2027-01-15' })], {
      status: 'paused',
      fromDate: '2027-01-10',
      toDate: '2027-01-31',
    })
    expect(plan.writes).toEqual([])
    expect(plan.conflicts).toEqual([{ billingItemId: 'bi-1', periodId: 'sp-1', status: 'suspended', fromDate: '2027-01-15' }])
  })

  it('a later period after the new one ends is no conflict', () => {
    const plan = planStatusWrites([recurring], [period({ status: 'paused', fromDate: '2027-03-01' })], {
      status: 'suspended',
      fromDate: '2027-01-10',
      toDate: '2027-01-31',
    })
    expect(plan.conflicts).toEqual([])
    expect(plan.writes).toHaveLength(1)
  })

  it('skips one-time items and items that ended before fromDate; ignores deleted periods', () => {
    const items: StatusTargetItem[] = [
      { id: 'bi-ot', type: 'one_time' },
      { id: 'bi-ended', type: 'recurring', billEndDate: '2026-12-31' },
      recurring,
    ]
    const plan = planStatusWrites(items, [period({ deletedAt: new Date() })], { status: 'paused', fromDate: '2027-01-10' })
    expect(plan.writes.map((w) => w.billingItemId)).toEqual(['bi-1'])
  })

  it('accepts Date columns from the ORM', () => {
    const plan = planStatusWrites([recurring], [period({ fromDate: new Date('2027-01-10T00:00:00Z') })], {
      status: 'paused',
      fromDate: '2027-01-10',
    })
    expect(plan.writes).toEqual([])
  })
})

function fakeBilling(itemsByKey: Record<string, StatusTargetItem[]>, periods: ExistingStatusPeriod[] = []) {
  const store = periods.map((p) => ({ ...p }))
  const api = {
    findItemsBySubscriptionItem: jest.fn(async (_s: unknown, key: string) => itemsByKey[key] ?? []),
    findStatusPeriods: jest.fn(async (_s: unknown, ids: string[]) => store.filter((p) => ids.includes(p.billingItemId) && !p.deletedAt)),
    createStatusPeriod: jest.fn(async (_s: unknown, input: { billingItemId: string; status: string; fromDate: string; toDate?: string | null }) => {
      const id = `sp-${store.length + 1}`
      store.push({ id, billingItemId: input.billingItemId, status: input.status, fromDate: input.fromDate, toDate: input.toDate ?? null })
      return { id }
    }),
    updateStatusPeriod: jest.fn(async (_s: unknown, input: { id: string; toDate: string | null }) => {
      const row = store.find((p) => p.id === input.id)!
      row.toDate = input.toDate
      return { id: input.id }
    }),
    deleteStatusPeriod: jest.fn(async (_s: unknown, id: string) => {
      store.find((p) => p.id === id)!.deletedAt = new Date()
      return { id }
    }),
  }
  return { api: api as unknown as StatusBillingPort & typeof api, store }
}

describe('cpq.subscription_item.status_changed subscriber', () => {
  it('is persistent', () => {
    expect(statusMetadata).toEqual(expect.objectContaining({ event: 'cpq.subscription_item.status_changed', persistent: true }))
  })

  const pause: StatusChangedPayload = {
    tenantId: 't-1',
    organizationId: 'o-1',
    subscriptionId: 'sub-1',
    subscriptionItemIds: ['si-1'],
    status: 'paused',
    fromDate: '2027-01-10',
    toDate: null,
    chargeBehavior: 'no_charge',
    reason: 'Holiday',
  }

  it('creates one period per recurring Billing Item (every period split, plus devices) and nothing on replay', async () => {
    const { api, store } = fakeBilling({
      'si-1': [
        { id: 'bi-m', type: 'recurring' },
        { id: 'bi-y', type: 'recurring' },
        { id: 'bi-ot', type: 'one_time' },
      ],
      'asset-1': [{ id: 'bi-dev', type: 'recurring' }],
    })
    await applyStatusChange(api, scope, pause, ['si-1', 'asset-1'])
    expect(store.map((p) => [p.billingItemId, p.status, p.fromDate])).toEqual([
      ['bi-m', 'paused', '2027-01-10'],
      ['bi-y', 'paused', '2027-01-10'],
      ['bi-dev', 'paused', '2027-01-10'],
    ])
    expect(api.createStatusPeriod).toHaveBeenCalledWith(scope, {
      billingItemId: 'bi-m',
      status: 'paused',
      fromDate: '2027-01-10',
      toDate: null,
      chargeBehavior: 'no_charge',
      reason: 'Holiday',
    })

    await applyStatusChange(api, scope, pause, ['si-1', 'asset-1'])
    expect(api.createStatusPeriod).toHaveBeenCalledTimes(3)
    expect(store).toHaveLength(3)
  })

  it('resume closes the open period once; a replay is a no-op', async () => {
    const { api, store } = fakeBilling({ 'si-1': [{ id: 'bi-1', type: 'recurring' }] }, [period()])
    const resume: StatusChangedPayload = { ...pause, status: 'active', fromDate: '2027-02-01', toDate: null, chargeBehavior: undefined }
    await applyStatusChange(api, scope, resume, ['si-1'])
    await applyStatusChange(api, scope, resume, ['si-1'])
    expect(api.updateStatusPeriod).toHaveBeenCalledTimes(1)
    expect(store[0].toDate).toBe('2027-01-31')
  })

  it('treats billing’s overlap answer on create as already applied, not a failure', async () => {
    const { api } = fakeBilling({ 'si-1': [{ id: 'bi-1', type: 'recurring' }] })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    api.createStatusPeriod.mockRejectedValueOnce(
      Object.assign(new Error('overlap'), { status: 422, body: { code: 'billing.item.status_period_overlap' } }),
    )
    await expect(applyStatusChange(api, scope, pause, ['si-1'])).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('other billing errors propagate so the persistent queue retries', async () => {
    const { api } = fakeBilling({ 'si-1': [{ id: 'bi-1', type: 'recurring' }] })
    api.createStatusPeriod.mockRejectedValueOnce(new Error('db down'))
    await expect(applyStatusChange(api, scope, pause, ['si-1'])).rejects.toThrow('db down')
  })
})

describe('cpq.subscription.terminated subscriber', () => {
  it('is persistent', () => {
    expect(terminatedMetadata).toEqual(expect.objectContaining({ event: 'cpq.subscription.terminated', persistent: true }))
  })

  const payload: TerminatedPayload = {
    tenantId: 't-1',
    organizationId: 'o-1',
    subscriptionId: 'sub-1',
    subscriptionItemIds: ['si-1'],
    effectiveDate: '2027-03-15',
  }

  const items = [
    { id: 'bi-running', billStartDate: '2026-12-01', billEndDate: null },
    { id: 'bi-future', billStartDate: '2027-06-01', billEndDate: null },
    { id: 'bi-ended', billStartDate: '2026-12-01', billEndDate: '2027-01-31' },
  ]

  it('uses exactly the cancel end-date rule and credit reason', () => {
    expect(buildTerminatedItemUpdates(items, payload)).toEqual(buildCancelledItemUpdates(items, payload))
    expect(buildTerminatedItemUpdates(items, payload)).toEqual([
      expect.objectContaining({ id: 'bi-running', billEndDate: '2027-03-14', creditReasonCode: 'subscription_cancelled' }),
      expect.objectContaining({ id: 'bi-future', billEndDate: '2027-05-31', creditReasonCode: 'subscription_cancelled' }),
    ])
  })

  it('whole subscription → every Billing Item of the subscription, like cancel', async () => {
    const billing = {
      findItemsBySubscription: jest.fn().mockResolvedValue(items),
      findItemsBySubscriptionItem: jest.fn(),
      updateItem: jest.fn().mockResolvedValue({ id: 'x' }),
    }
    await applyTermination(billing as never, scope, payload, { wholeSubscription: true, keys: [] })
    expect(billing.findItemsBySubscription).toHaveBeenCalledWith(scope, 'sub-1')
    expect(billing.findItemsBySubscriptionItem).not.toHaveBeenCalled()
    expect(billing.updateItem.mock.calls.map((c) => c[1].id)).toEqual(['bi-running', 'bi-future'])
  })

  it('item-level → only the listed items and their devices; a replay writes nothing', async () => {
    const rows: Record<string, Array<{ id: string; billStartDate: string; billEndDate: string | null }>> = {
      'si-1': [{ id: 'bi-1', billStartDate: '2026-12-01', billEndDate: null }],
      'asset-1': [{ id: 'bi-dev', billStartDate: '2026-12-01', billEndDate: null }],
    }
    const billing = {
      findItemsBySubscription: jest.fn(),
      findItemsBySubscriptionItem: jest.fn(async (_s: unknown, key: string) => rows[key] ?? []),
      updateItem: jest.fn(async (_s: unknown, update: { id: string; billEndDate: string }) => {
        for (const list of Object.values(rows)) for (const row of list) if (row.id === update.id) row.billEndDate = update.billEndDate
        return { id: update.id }
      }),
    }
    const target = { wholeSubscription: false, keys: ['si-1', 'asset-1'] }
    await applyTermination(billing as never, scope, payload, target)
    expect(billing.updateItem.mock.calls.map((c) => [c[1].id, c[1].billEndDate])).toEqual([
      ['bi-1', '2027-03-14'],
      ['bi-dev', '2027-03-14'],
    ])
    await applyTermination(billing as never, scope, payload, target)
    expect(billing.updateItem).toHaveBeenCalledTimes(2)
    expect(billing.findItemsBySubscription).not.toHaveBeenCalled()
  })
})
