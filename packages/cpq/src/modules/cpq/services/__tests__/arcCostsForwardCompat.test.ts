import {
  CpqInventoryCost, CpqInventorySubscriptionItem, CpqOrderLineConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../data/entities'
import { DefaultCpqOrderService } from '../cpqOrderService'
import * as eventsModule from '../../events'
import type { TenantScope } from '../types'
import { ACTIVATION_SCOPE, createActivationHarness } from './_helpers/activationHarness'

/**
 * ARC costs step 11 (forward compatibility, spec Q5). Renews created BEFORE the carry step exist in flight:
 *  - A: a standalone Renew of a cost-plus item under the Phase 1 freeze (`_arcPriceFrozen` + `_arcCostPlusFrozen`, no
 *    carried lines and no carry markers);
 *  - B: a non-cost-plus Renew whose lines are unmarked (never frozen), one of them reconfigured.
 * Both convert and activate after Phase C: frozen lines stay untouched, the reconfigured line replaces (the sibling's
 * catalog-only rule, never the carried full image), and every other line stays untouched.
 */

const SCOPE: TenantScope = { organizationId: 'org', tenantId: 'tenant' }

const line = (quoteLineId: string, configuration: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  quoteLineId, quantity: 1, action: 'modify', nrcTotal: '0', mrcTotal: '345', charges: [], configuration, offeringId: null, targetSubscriptionId: 'sub-1',
  sourceSubscriptionItemId: `item-${quoteLineId}`, parentLineId: null, ...over,
})
const FROZEN = { _arcMirroredFromItemId: 'i', _arcPriceFrozen: true, _arcCostPlusFrozen: true }
const PLAIN = { _arcMirroredFromItemId: 'i' }
const RECONFIGURED = { _arcMirroredFromItemId: 'i', _arcReconfigured: true }

const fixtureA = [line('ql-f1', FROZEN), line('ql-f2', FROZEN)]
const fixtureB = [line('ql-u1', PLAIN), line('ql-re', RECONFIGURED), line('ql-u2', PLAIN)]

describe('conversion of Phase 1 Renews after Phase C', () => {
  async function convert(quoteLines: Array<Record<string, unknown>>) {
    const em: Record<string, jest.Mock> = {
      fork: jest.fn(), transactional: jest.fn(), findOne: jest.fn(), find: jest.fn(), findAndCount: jest.fn(),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ createdAt: new Date(), ...data })), persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
    }
    em.fork.mockReturnValue(em)
    em.transactional.mockImplementation((callback: (tx: unknown) => unknown) => callback(em))
    em.findOne.mockResolvedValueOnce({ id: 'quote', quoteId: 'sales', cpqStatus: 'accepted', quoteType: 'renew', currencyCode: 'EUR', customerId: 'customer', pricingSummary: { nrcTotal: 0, mrcTotal: 345 } })
      .mockResolvedValueOnce(null)
    em.find.mockImplementation(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? quoteLines : []))
    const service = new DefaultCpqOrderService({
      em: em as never, cpqInventoryService: {} as never, salesDocumentNumberGenerator: { generate: jest.fn().mockResolvedValue({ number: 'ORD-1' }) } as never,
    })
    await service.convertQuoteToOrder('quote', SCOPE)
    return em
  }

  it.each([['A: Phase 1 cost-plus freeze', fixtureA], ['B: unmarked never-frozen lines', fixtureB]] as const)('%s converts with no stale-cost guard read and no linked cost', async (_name, lines) => {
    const em = await convert([...lines])
    const entities = em.find.mock.calls.map(([entity]) => entity)
    expect(entities).not.toContain(CpqInventoryCost) // no carry markers: the COST_SOURCE_CHANGED guard is a no-op
    expect(entities).not.toContain(CpqInventorySubscriptionItem)
    const orderLines = em.create.mock.calls.filter(([entity]) => entity === CpqOrderLineConfiguration)
    expect(orderLines).toHaveLength(lines.length)
    expect(em.create.mock.calls.filter(([entity]) => entity === CpqQuoteLineCost)).toHaveLength(0)
  })
})

describe('activation of Phase 1 Renews after Phase C', () => {
  const arcResult = { changeLog: { effectiveAt: new Date('2026-06-01T00:00:00.000Z'), afterSnapshot: { items: [] }, lineChanges: [] },
    subscription: { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01'), currentTermEnd: new Date('2028-01-01') } }
  const olc = (id: string, orderLineId: string) => ({ id, orderLineId, orderConfigurationId: 'oc-1', costKey: 'tail', name: 'tail', role: 'price_basis', costType: 'mrc',
    source: 'table', costModel: 'flat', valueStatus: 'confirmed', origin: 'catalog', totalAmount: '300', inventoryCostId: null })
  const orderLine = (orderLineId: string, sourceQuoteLineId: string) => ({ orderLineId, orderConfigurationId: 'oc-1', sourceQuoteLineId, quantity: 1, configuration: {}, charges: [],
    parentLineId: null, mrcTotal: '0', nrcTotal: '0' })

  async function activate(quoteLines: Array<ReturnType<typeof line>>, costPlusEnabled?: boolean) {
    const h = createActivationHarness({
      quoteType: 'renew', quoteLines,
      targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }],
      orderLines: quoteLines.map((l, index) => orderLine(`ol-${index}`, l.quoteLineId)),
      orderLineCosts: quoteLines.map((l, index) => olc(`c-${index}`, `ol-${index}`)),
      inventory: { applyRenewal: arcResult }, ...(costPlusEnabled === undefined ? {} : { costPlusEnabled }),
    })
    jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const [input] = h.inventory.applyRenewal.mock.calls[0] as [{ lineChanges: Array<{ quoteLineId: string; costSync?: { mode: string; fullImage?: boolean; seeds: Array<{ orderLineCostId: string; inventoryCostId?: string }> } }> }]
    return { h, lineChanges: input.lineChanges }
  }
  afterEach(() => jest.restoreAllMocks())

  it('A: frozen lines stay untouched: no costSync, no item cost read, activates', async () => {
    const { h, lineChanges } = await activate(fixtureA)
    expect(lineChanges.map((change) => change.costSync)).toEqual([undefined, undefined])
    expect((h.txEm.find.mock.calls as unknown as Array<[unknown]>).map(([entity]) => entity)).not.toContain(CpqInventoryCost)
    expect(h.store.committedOrderStatus).toBe('active')
  })

  it.each([[true, 'replace'], [false, 'upsert']] as const)('B (toggle on=%s): only the reconfigured line syncs (%s, catalog-only, no full image); the others stay untouched', async (on, mode) => {
    const { h, lineChanges } = await activate(fixtureB, on)
    expect(lineChanges.map((change) => change.quoteLineId)).toEqual(['ql-u1', 'ql-re', 'ql-u2'])
    expect(lineChanges[0].costSync).toBeUndefined()
    expect(lineChanges[2].costSync).toBeUndefined()
    expect(lineChanges[1].costSync).toMatchObject({ mode })
    expect(lineChanges[1].costSync?.fullImage).toBeUndefined()
    expect(lineChanges[1].costSync?.seeds.map((seed) => [seed.orderLineCostId, seed.inventoryCostId])).toEqual([['c-1', undefined]])
    expect(h.store.committedOrderStatus).toBe('active')
  })
})
