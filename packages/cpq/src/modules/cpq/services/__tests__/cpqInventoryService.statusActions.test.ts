/**
 * D6 (spec 2026-11-26 line status) — subscription / item status actions:
 * state machine, dated stop periods, charge behaviour defaults, and the
 * contract C2 events emitted after the flush.
 */
jest.mock('../../events', () => ({ emitCpqEvent: jest.fn().mockResolvedValue(undefined) }))

import { emitCpqEvent } from '../../events'
import { DefaultCpqInventoryService, statusActionFor } from '../cpqInventoryService'
import { CpqInventoryAsset, CpqInventorySubscription, CpqInventorySubscriptionItem } from '../../data/entities'
import { createMockEm, TEST_SCOPE as SCOPE } from './_helpers/mockEm'

type Row = Record<string, unknown> & { id: string; status: string }

const emitted = jest.mocked(emitCpqEvent)

function setup(subStatus: string, items: Array<Partial<Row> & { id: string; status: string }>, assets: Row[] = []) {
  const em = createMockEm()
  const sub: Row = { id: 'sub-1', status: subStatus, mrcAmount: '0', nrcAmount: '0', suspendedAt: null, terminatedAt: null }
  const itemRows = items.map((item) => ({ subscriptionId: 'sub-1', mrcAmount: '10', nrcAmount: '0', ...item })) as Row[]
  const flushOrder: string[] = []
  em.flush.mockImplementation(async () => { flushOrder.push('flush') })
  emitted.mockImplementation(async () => { flushOrder.push('emit') })
  em.findOne.mockImplementation(async (entity, where) => {
    if (entity === CpqInventorySubscription) return where.id === sub.id ? sub : null
    if (entity === CpqInventorySubscriptionItem) return itemRows.find((item) => item.id === where.id) ?? null
    return null
  })
  em.find.mockImplementation(async (entity, where) => {
    if (entity === CpqInventorySubscriptionItem) {
      const excluded = ((where.status as { $nin?: string[] } | undefined)?.$nin) ?? []
      return itemRows.filter((item) => !excluded.includes(item.status))
    }
    if (entity === CpqInventoryAsset) {
      const ids = ((where.subscriptionItemId as { $in?: string[] } | undefined)?.$in)
      return assets.filter((asset) => !ids || ids.includes(String(asset.subscriptionItemId)))
    }
    return []
  })
  const service = new DefaultCpqInventoryService(em as unknown as never)
  return { em, sub, items: itemRows, service, flushOrder }
}

beforeEach(() => emitted.mockReset())

describe('applyStatusAction — whole subscription', () => {
  it('suspends every running item with the default charge behaviour and emits status_changed after the flush', async () => {
    const { sub, items, service, flushOrder } = setup('active', [
      { id: 'i1', status: 'active' },
      { id: 'i2', status: 'active' },
      { id: 'i3', status: 'terminated' },
    ])
    const result = await service.applyStatusAction(
      { subscriptionId: 'sub-1', action: 'suspend', fromDate: '2027-01-10', reason: 'Non-payment' },
      SCOPE,
    )
    expect(sub.status).toBe('suspended')
    expect(sub.suspendedAt).toBeInstanceOf(Date)
    expect(items.map((item) => item.status)).toEqual(['suspended', 'suspended', 'terminated'])
    expect(items[0]).toMatchObject({ statusFromDate: '2027-01-10', statusToDate: null, statusChargeBehavior: 'charge', statusReason: 'Non-payment' })
    expect(result.subscriptionItemIds).toEqual(['i1', 'i2'])
    expect(emitted).toHaveBeenCalledTimes(1)
    expect(emitted).toHaveBeenCalledWith('cpq.subscription_item.status_changed', {
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      subscriptionId: 'sub-1',
      subscriptionItemIds: ['i1', 'i2'],
      status: 'suspended',
      fromDate: '2027-01-10',
      toDate: null,
      chargeBehavior: 'charge',
      reason: 'Non-payment',
    })
    expect(flushOrder.at(-1)).toBe('emit')
    expect(flushOrder.indexOf('flush')).toBeLessThan(flushOrder.indexOf('emit'))
  })

  it('a pause defaults to no charge and keeps the dated window', async () => {
    const { items, service } = setup('active', [{ id: 'i1', status: 'active' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', action: 'pause', fromDate: '2027-01-10', toDate: '2027-01-19' }, SCOPE)
    expect(items[0]).toMatchObject({ status: 'paused', statusFromDate: '2027-01-10', statusToDate: '2027-01-19', statusChargeBehavior: 'no_charge' })
    expect(emitted.mock.calls[0][1]).toMatchObject({ status: 'paused', chargeBehavior: 'no_charge', toDate: '2027-01-19' })
  })

  it('a suspension can be "no charge"', async () => {
    const { items, service } = setup('active', [{ id: 'i1', status: 'active' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', action: 'suspend', chargeBehavior: 'no_charge' }, SCOPE)
    expect(items[0].statusChargeBehavior).toBe('no_charge')
  })

  it('resume emits status active from the first running day, without charge behaviour', async () => {
    const { sub, items, service } = setup('paused', [{ id: 'i1', status: 'paused' }, { id: 'i2', status: 'paused' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', action: 'resume', fromDate: '2027-01-20' }, SCOPE)
    expect(sub.status).toBe('active')
    expect(items.every((item) => item.status === 'active' && item.statusToDate === null && item.statusChargeBehavior === null)).toBe(true)
    const payload = emitted.mock.calls[0][1] as unknown as Record<string, unknown>
    expect(payload).toMatchObject({ status: 'active', fromDate: '2027-01-20', toDate: null, subscriptionItemIds: ['i1', 'i2'] })
    expect(payload).not.toHaveProperty('chargeBehavior')
  })

  it('a subscription-wide suspend leaves an item paused on its own as it is', async () => {
    const { items, service } = setup('active', [{ id: 'i1', status: 'active' }, { id: 'i2', status: 'paused' }])
    const result = await service.applyStatusAction({ subscriptionId: 'sub-1', action: 'suspend' }, SCOPE)
    expect(result.subscriptionItemIds).toEqual(['i1'])
    expect(items[1].status).toBe('paused')
  })

  it('terminate retires assets, ends the subscription and emits cpq.subscription.terminated', async () => {
    const asset: Row = { id: 'a1', status: 'active', subscriptionItemId: 'i1' }
    const { sub, items, service } = setup('active', [{ id: 'i1', status: 'active' }, { id: 'i2', status: 'suspended' }], [asset])
    await service.applyStatusAction({ subscriptionId: 'sub-1', action: 'terminate', fromDate: '2027-02-01', reason: 'Moved away' }, SCOPE)
    expect(sub.status).toBe('terminated')
    expect(sub.terminatedAt).toBeInstanceOf(Date)
    expect(items.map((item) => item.status)).toEqual(['terminated', 'terminated'])
    expect(asset.status).toBe('returned')
    expect(emitted).toHaveBeenCalledWith('cpq.subscription.terminated', {
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      subscriptionId: 'sub-1',
      subscriptionItemIds: ['i1', 'i2'],
      effectiveDate: '2027-02-01',
      reason: 'Moved away',
    })
  })

  it('refuses an action the state machine does not allow (pause a suspended subscription)', async () => {
    const { service } = setup('suspended', [{ id: 'i1', status: 'suspended' }])
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'pause' }, SCOPE)).rejects.toMatchObject({ status: 409 })
    expect(emitted).not.toHaveBeenCalled()
  })

  it('refuses a resume of a running subscription', async () => {
    const { service } = setup('active', [{ id: 'i1', status: 'active' }])
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'resume' }, SCOPE)).rejects.toMatchObject({ status: 409 })
  })

  it('validates dates and action options', async () => {
    const { service } = setup('active', [{ id: 'i1', status: 'active' }])
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'pause', fromDate: '2027-01-10', toDate: '2027-01-01' }, SCOPE))
      .rejects.toMatchObject({ status: 400 })
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'terminate', toDate: '2027-01-01' }, SCOPE))
      .rejects.toMatchObject({ status: 400 })
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'resume', chargeBehavior: 'charge' }, SCOPE))
      .rejects.toMatchObject({ status: 400 })
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', action: 'pause', fromDate: '10/01/2027' }, SCOPE))
      .rejects.toMatchObject({ status: 400 })
  })

  it('404 for an unknown subscription', async () => {
    const { service } = setup('active', [])
    await expect(service.applyStatusAction({ subscriptionId: 'nope', action: 'pause' }, SCOPE)).rejects.toMatchObject({ status: 404 })
  })
})

describe('applyStatusAction — one item', () => {
  it('suspends only that item; the subscription stays active', async () => {
    const { sub, items, service } = setup('active', [{ id: 'i1', status: 'active' }, { id: 'i2', status: 'active' }])
    const result = await service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i2', action: 'suspend' }, SCOPE)
    expect(sub.status).toBe('active')
    expect(items.map((item) => item.status)).toEqual(['active', 'suspended'])
    expect(result.subscriptionItemIds).toEqual(['i2'])
    expect(emitted.mock.calls[0][1]).toMatchObject({ subscriptionItemIds: ['i2'], status: 'suspended' })
  })

  it('grace on one item, then the item escalates to a suspension', async () => {
    const { items, service } = setup('active', [{ id: 'i1', status: 'active' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i1', action: 'grace' }, SCOPE)
    expect(items[0]).toMatchObject({ status: 'grace', statusChargeBehavior: 'charge' })
    await service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i1', action: 'suspend' }, SCOPE)
    expect(items[0].status).toBe('suspended')
  })

  it('needs a running subscription', async () => {
    const { service } = setup('suspended', [{ id: 'i1', status: 'suspended' }])
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i1', action: 'resume' }, SCOPE))
      .rejects.toMatchObject({ status: 409 })
  })

  it('terminating one item keeps the subscription while other items run', async () => {
    const { sub, items, service } = setup('active', [{ id: 'i1', status: 'active' }, { id: 'i2', status: 'active' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i1', action: 'terminate', fromDate: '2027-03-01' }, SCOPE)
    expect(items[0].status).toBe('terminated')
    expect(sub.status).toBe('active')
    expect(emitted).toHaveBeenCalledWith('cpq.subscription.terminated', expect.objectContaining({ subscriptionItemIds: ['i1'], effectiveDate: '2027-03-01' }))
  })

  it('terminating the last live item terminates the subscription', async () => {
    const { sub, service } = setup('active', [{ id: 'i1', status: 'active' }, { id: 'i2', status: 'terminated' }])
    await service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'i1', action: 'terminate' }, SCOPE)
    expect(sub.status).toBe('terminated')
  })

  it('404 for an item that is not on the subscription', async () => {
    const { service } = setup('active', [{ id: 'i1', status: 'active' }])
    await expect(service.applyStatusAction({ subscriptionId: 'sub-1', subscriptionItemId: 'x', action: 'pause' }, SCOPE))
      .rejects.toMatchObject({ status: 404 })
  })
})

describe('legacy status endpoint mapping', () => {
  it('maps stop / resume / terminate targets to actions and keeps plain transitions', () => {
    expect(statusActionFor('active', 'suspended')).toBe('suspend')
    expect(statusActionFor('active', 'paused')).toBe('pause')
    expect(statusActionFor('active', 'grace')).toBe('grace')
    expect(statusActionFor('suspended', 'active')).toBe('resume')
    expect(statusActionFor('active', 'terminated')).toBe('terminate')
    expect(statusActionFor('pending', 'active')).toBeNull()
    expect(statusActionFor('pending', 'terminated')).toBeNull()
    expect(statusActionFor('active', 'expired')).toBeNull()
  })

  it('changeSubscriptionStatus suspends through the action (emits) and activates pending plainly (no event)', async () => {
    const running = setup('active', [{ id: 'i1', status: 'active' }])
    await running.service.changeSubscriptionStatus('sub-1', 'suspended', SCOPE)
    expect(emitted).toHaveBeenCalledWith('cpq.subscription_item.status_changed', expect.objectContaining({ status: 'suspended' }))
    emitted.mockReset()
    const pending = setup('pending', [{ id: 'i1', status: 'pending' }])
    await pending.service.changeSubscriptionStatus('sub-1', 'active', SCOPE)
    expect(pending.sub.status).toBe('active')
    expect(emitted).not.toHaveBeenCalled()
  })
})
