import {
  CpqInventoryAsset, CpqInventoryCost, CpqOrderConfiguration, CpqSubscriptionChangeLog,
} from '../../../data/entities'
import { computeCancelExposure, exposureMonthsBetween } from '../arcCostCarry'
import { loadCancelExposure } from '../cancelExposure'

const SCOPE = { organizationId: 'org', tenantId: 'ten' }
const cost = (over: Record<string, unknown> = {}) => ({
  id: 'ic-1', costKey: 'tail', name: 'Carrier X tail', costType: 'mrc', supplierName: 'Carrier X', supplierTermEnd: '2028-11-30', ...over,
})

describe('computeCancelExposure (ARC costs spec step 17)', () => {
  it('lists a supplier term that outlives the cancel with its months of exposure (12 months from 2027-11-30)', () => {
    expect(computeCancelExposure([cost()] as never, '2027-11-30')).toEqual([
      { inventoryCostId: 'ic-1', costKey: 'tail', name: 'Carrier X tail', supplierName: 'Carrier X', supplierTermEnd: '2028-11-30', exposureMonths: 12, termUnknown: false },
    ])
  })

  it('lists an asset licence the same way (6 months from 2027-11-30 to 2028-05-31)', () => {
    const [item] = computeCancelExposure([cost({ id: 'ic-2', costKey: 'licence', name: 'Server licence', supplierTermEnd: '2028-05-31' })] as never, '2027-11-30')
    expect(item).toMatchObject({ name: 'Server licence', exposureMonths: 6 })
  })

  it('measures from the reference date: the same cost after activation on 2027-12-15 is 11 months', () => {
    expect(computeCancelExposure([cost()] as never, new Date('2027-12-15T00:00:00Z'))[0].exposureMonths).toBe(11)
  })

  it('shows an MRC cost without a supplier term as unknown, and never a one-off cost without one', () => {
    const rows = computeCancelExposure([cost({ id: 'a', supplierTermEnd: null }), cost({ id: 'b', costType: 'nrc', supplierTermEnd: null })] as never, '2027-11-30')
    expect(rows).toEqual([expect.objectContaining({ inventoryCostId: 'a', termUnknown: true, exposureMonths: null, supplierTermEnd: null })])
  })

  it('lists nothing that does not outlive the reference date (ended before, or exactly on it)', () => {
    expect(computeCancelExposure([cost({ id: 'a', supplierTermEnd: '2027-06-30' }), cost({ id: 'b', supplierTermEnd: '2027-11-30' })] as never, '2027-11-30')).toEqual([])
  })

  it('a term ending days after the reference date counts as one month; months follow the calendar, not 30-day blocks', () => {
    expect(exposureMonthsBetween('2027-11-30', '2027-12-05')).toBe(1)
    expect(exposureMonthsBetween('2027-01-31', '2027-02-28')).toBe(1)
    expect(exposureMonthsBetween('2027-11-15', '2028-11-14')).toBe(11)
  })

  it('carries no amount: only identity, supplier and term fields', () => {
    const [item] = computeCancelExposure([{ ...cost(), unitAmount: '7777.77', instanceAmount: '7777.77' }] as never, '2027-11-30')
    expect(JSON.stringify(item)).not.toContain('7777')
  })
})

describe('loadCancelExposure', () => {
  const cancelLine = (id: string, itemId: string, target = 'sub-1') => ({ quoteLineId: id, action: 'cancel', configuration: { _arcMirroredFromItemId: itemId }, sourceSubscriptionItemId: itemId, targetSubscriptionId: target })
  function fixture(opts: { order?: Record<string, unknown> | null; logs?: Array<Record<string, unknown>>; costs?: Array<Record<string, unknown>>; assets?: Array<Record<string, unknown>> }) {
    const find = jest.fn(async (entity: unknown) => {
      if (entity === CpqSubscriptionChangeLog) return opts.logs ?? []
      if (entity === CpqInventoryAsset) return opts.assets ?? []
      if (entity === CpqInventoryCost) return opts.costs ?? []
      return []
    })
    const findOne = jest.fn(async (entity: unknown) => (entity === CpqOrderConfiguration ? opts.order ?? null : null))
    return { em: { find, findOne } as never, find }
  }
  const itemCost = (over: Record<string, unknown> = {}) => ({ ...cost(), subscriptionItemId: 'item-1', assetId: null, status: 'active', lastChangeId: null, ...over })

  it('an open Cancel quote lists item and asset costs as of today', async () => {
    const { em } = fixture({ costs: [itemCost(), itemCost({ id: 'ic-2', name: 'Server licence', costKey: 'licence', subscriptionItemId: null, assetId: 'as-1', supplierTermEnd: '2099-05-31' })], assets: [{ id: 'as-1', subscriptionItemId: 'item-1', status: 'active' }] })
    const read = await loadCancelExposure(em, { id: 'q-1', quoteType: 'cancel' } as never, [cancelLine('l-1', 'item-1')] as never, SCOPE)
    expect(read.exposure?.referenceDate).toBe(new Date().toISOString().slice(0, 10))
    expect(read.exposure?.items.map((i) => i.name).sort()).toEqual(['Carrier X tail', 'Server licence'])
    expect(read.lines).toHaveLength(1)
    expect(read.lines[0].items).toHaveLength(2)
  })

  it('an Amend quote reports only its cancel lines; a quote without cancel lines reports nothing', async () => {
    const { em } = fixture({ costs: [itemCost()] })
    expect(await loadCancelExposure(em, { id: 'q-1', quoteType: 'amend' } as never, [{ quoteLineId: 'm', action: 'modify', configuration: { _arcMirroredFromItemId: 'item-1' } }] as never, SCOPE)).toEqual({ exposure: null, lines: [] })
    const read = await loadCancelExposure(em, { id: 'q-1', quoteType: 'amend' } as never, [cancelLine('l-1', 'item-1')] as never, SCOPE)
    expect(read.lines[0].quoteLineId).toBe('l-1')
  })

  it('an activated order is measured from the change-log effective_at over the costs that order ended', async () => {
    const { em, find } = fixture({
      order: { id: 'o-1', cpqStatus: 'active' },
      logs: [{ id: 'log-1', effectiveAt: new Date('2028-06-01T00:00:00Z') }],
      costs: [itemCost({ status: 'ended', lastChangeId: 'log-1', supplierTermEnd: '2028-11-30' })],
    })
    const read = await loadCancelExposure(em, { id: 'q-1', quoteType: 'cancel' } as never, [cancelLine('l-1', 'item-1')] as never, SCOPE)
    expect(read.exposure).toEqual({ referenceDate: '2028-06-01', items: [expect.objectContaining({ exposureMonths: 5 })] })
    expect(find).toHaveBeenCalledWith(CpqInventoryCost, expect.objectContaining({ status: 'ended', lastChangeId: { $in: ['log-1'] } }))
  })

  it('every query is tenant scoped', async () => {
    const { em, find } = fixture({ costs: [] })
    await loadCancelExposure(em, { id: 'q-1', quoteType: 'cancel' } as never, [cancelLine('l-1', 'item-1')] as never, SCOPE)
    for (const [, where] of find.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>) {
      expect(where).toMatchObject({ organizationId: 'org', tenantId: 'ten' })
    }
  })
})
