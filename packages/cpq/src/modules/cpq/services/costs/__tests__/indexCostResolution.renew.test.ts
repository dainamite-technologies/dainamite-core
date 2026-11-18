import {
  CpqChargeCostElement, CpqCostIndex, CpqCostIndexValue, CpqInventoryCost, CpqOrderConfiguration, CpqPricingTable, CpqPricingTableEntry, CpqProductCharge,
  CpqQuoteLineCost, CpqQuoteTargetSubscription,
} from '../../../data/entities'
import { resolveQuoteCosts } from '../costResolution'
import { reevaluateCarriedIndexCosts, type IndexValueInForce } from '../indexCostResolution'
import { conversionCostBlockers } from '../conversionGuard'
import { costSeedFromOrderLineCost, replaceItemCosts } from '../inventoryCostSync'
import * as eventsModule from '../../../events'
import { ACTIVATION_SCOPE, createActivationHarness } from '../../__tests__/_helpers/activationHarness'

// Index costs step 12 (spec Q12, ARC costs spec "R1c reconciliation, then index re-evaluation"): a Renew re-reads the value
// in force for its carried index costs, on the contracted formula of the carried snapshot, and nothing else changes.

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const QUOTE_ID = 'quote-cfg'
const LINE_ID = 'line-1'
const OFFERING = 'offering-1'
const INDEX = 'idx-1'
const ASOF = '2026-11-16'
type Row = Record<string, unknown>

const snapshot = (over: Row = {}) => ({ indexId: INDEX, currencyCode: 'USD', effectiveDate: '2026-06-01', revision: 1, value: '70', factor: '0.5', offset: '2', asOfDate: '2026-06-02', ...over })
const valuesAt = (value: string, effectiveDate = '2026-11-10', revision = 2): Map<string, IndexValueInForce> => new Map([[INDEX, { indexId: INDEX, effectiveDate, revision, value }]])
const line = (over: Row = {}) => ({
  costKey: 'tail', origin: 'carried', role: 'price_basis', costType: 'mrc', source: 'index', chargeCode: 'mrc', costElementId: 'el-1', valueStatus: 'confirmed', valueOrigin: 'carried',
  unitAmount: '37', instanceAmount: '37', currencyCode: 'USD', costModel: 'flat', renegotiationDue: false, validUntil: '2030-01-01', supplierTermEnd: '2030-01-01',
  indexSnapshot: snapshot(), ...over,
}) as never

describe('reevaluateCarriedIndexCosts (pure)', () => {
  const run = (lines: unknown[], over: Row = {}) => reevaluateCarriedIndexCosts(lines as never, { asOfDate: ASOF, quoteType: 'renew', valuesInForce: valuesAt('82.4'), ...over } as never)

  it('re-reads the value in force on the carried formula; the patch is only the value, its instance amount and the snapshot', () => {
    const l = line()
    const [out] = run([l])
    expect(out.row).toBe(l)
    expect(out.patch).toEqual({
      unitAmount: '43.2', instanceAmount: '43.2',
      indexSnapshot: { indexId: INDEX, currencyCode: 'USD', effectiveDate: '2026-11-10', revision: 2, value: '82.4', factor: '0.5', offset: '2', asOfDate: ASOF },
    })
    expect(Object.keys(out.patch)).not.toContain('valueStatus')
    expect(Object.keys(out.patch)).not.toContain('renegotiationDue')
  })

  it('uses the carried factor and offset, never a catalog element (the contracted formula)', () => {
    const [out] = run([line({ indexSnapshot: snapshot({ factor: '2', offset: '0' }) })])
    expect(out.patch.unitAmount).toBe('164.8')
  })

  it('a per_unit line multiplies by the quantity', () => {
    const [out] = run([line({ costModel: 'per_unit' })], { quantityFor: () => 3 })
    expect(out.patch).toMatchObject({ unitAmount: '43.2', instanceAmount: '129.6' })
  })

  it('a renegotiation-due line is not touched', () => {
    expect(run([line({ renegotiationDue: true, valueStatus: 'estimated' })])).toEqual([])
  })

  it.each([['supplier'], ['manual'], ['catalog']])('a %s value is not re-evaluated', (valueOrigin) => {
    expect(run([line({ valueOrigin })])).toEqual([])
  })

  it('non-index and non-carried lines are not touched', () => {
    expect(run([line({ source: 'fixed' }), line({ origin: 'catalog' })])).toEqual([])
  })

  it('Amend (and every non-Renew quote) is not re-evaluated', () => {
    expect(run([line()], { quoteType: 'amend' })).toEqual([])
    expect(run([line()], { quoteType: 'new_sale' })).toEqual([])
  })

  it('leaves a line as it is when no value is in force at the date, or the snapshot is unusable', () => {
    expect(run([line()], { valuesInForce: new Map() })).toEqual([])
    expect(run([line({ indexSnapshot: null })])).toEqual([])
    expect(run([line({ currencyCode: 'EUR' })])).toEqual([])
  })
})

function store(rows: { charges?: Row[]; elements?: Row[]; costs?: Row[]; targets?: Row[]; indexValues?: Row[] }) {
  const byEntity = new Map<unknown, Row[]>([
    [CpqProductCharge, rows.charges ?? []], [CpqChargeCostElement, rows.elements ?? []], [CpqPricingTable, []], [CpqPricingTableEntry, []],
    [CpqQuoteLineCost, rows.costs ?? []], [CpqOrderConfiguration, []], [CpqQuoteTargetSubscription, rows.targets ?? []], [CpqCostIndex, []], [CpqCostIndexValue, rows.indexValues ?? []],
  ])
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return (value as { $in: unknown[] }).$in.includes(row[key])
    if (value && typeof value === 'object' && '$lte' in value) return String(row[key]) <= String((value as { $lte: unknown }).$lte)
    return (row[key] ?? null) === value
  })
  const em: Record<string, jest.Mock> = {
    find: jest.fn(async (entity: unknown, where: Row) => (byEntity.get(entity) ?? []).filter((row) => matches(row, where))),
    count: jest.fn(async () => 0),
    create: jest.fn((_e: unknown, data: Row) => ({ id: 'new', deletedAt: null, note: null, ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em, costs: byEntity.get(CpqQuoteLineCost)! }
}

describe('Renew saved recalculation with carried index costs (mock EM)', () => {
  const charge = { id: 'charge-1', ...SCOPE, deletedAt: null, isActive: true, offeringId: OFFERING, code: 'mrc', sortOrder: 0, quantityAttributeCode: 'qty', applicabilityCondition: null }
  const element = { id: 'el-1', ...SCOPE, deletedAt: null, isActive: true, productChargeId: 'charge-1', code: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc',
    source: 'fixed', costModel: 'flat', amount: '100', currencyCode: 'USD', costTableId: null, costColumnKey: null, estimateAmount: null, applicabilityCondition: null, sortOrder: 0 }
  const carried = (over: Row = {}) => ({
    id: 'k-1', ...SCOPE, deletedAt: null, quoteConfigurationId: QUOTE_ID, quoteLineId: LINE_ID, costKey: 'tail', chargeCode: 'mrc', origin: 'carried', valueOrigin: 'carried',
    valueStatus: 'confirmed', role: 'price_basis', costType: 'mrc', source: 'index', costModel: 'flat', costElementId: 'el-1', unitAmount: '37', instanceAmount: '37', currencyCode: 'USD',
    validUntil: '2030-01-01', supplierTermEnd: '2030-01-01', renegotiationDue: false, sourcingStatus: 'not_requested', note: 'kept note', supplierName: 'Carrier X', driverHash: null,
    errorCode: null, indexSnapshot: snapshot(), ...over,
  })
  const value = (effectiveDate: string, revision: number, amount: string) => ({ ...SCOPE, costIndexId: INDEX, effectiveDate, revision, value: amount })
  const values = [value('2026-06-01', 1, '70'), value('2026-11-10', 1, '80'), value('2026-11-10', 2, '82.4'), value('2026-11-20', 1, '99')]
  const target = { ...SCOPE, deletedAt: null, quoteId: QUOTE_ID, subscriptionId: 'sub-1', newTermEnd: '2028-12-31' }
  const managed = () => ({ quoteLineId: LINE_ID, offeringId: OFFERING, productId: null, targetSubscriptionId: 'sub-1',
    configuration: { _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' } }) as never
  const go = (s: ReturnType<typeof store>, quoteType = 'renew', cfg: never = managed()) => resolveQuoteCosts({
    em: s.em as never, quote: { id: QUOTE_ID, quoteId: 'sq', cpqStatus: 'new', quoteType, currencyCode: 'USD' } as never, scope: SCOPE, asOfDate: ASOF,
    isEnabled: async () => true, lines: [{ lineConfig: cfg, mergedConfig: {} }],
  })
  const build = (costs: Row[], extra: Row = {}) => store({ charges: [charge], elements: [element], costs, targets: [target], indexValues: values, ...extra })

  it('re-evaluates the carried index line: only the value, instance amount and snapshot change (Brent 70 -> 82.40 style)', async () => {
    const s = build([carried()])
    const before = { ...s.costs[0] }
    await go(s)
    const { unitAmount, instanceAmount, indexSnapshot, driverHash: _d, ...rest } = s.costs[0]
    const { unitAmount: _u, instanceAmount: _i, indexSnapshot: _s, driverHash: _dh, ...restBefore } = before
    expect(unitAmount).toBe('43.2')
    expect(instanceAmount).toBe('43.2')
    expect(indexSnapshot).toEqual({ indexId: INDEX, currencyCode: 'USD', effectiveDate: '2026-11-10', revision: 2, value: '82.4', factor: '0.5', offset: '2', asOfDate: ASOF })
    // status, origin, flags, note, supplier and validity are untouched
    expect(rest).toEqual(restBefore)
    expect(s.costs[0]).toMatchObject({ valueStatus: 'confirmed', valueOrigin: 'carried', origin: 'carried', renegotiationDue: false, note: 'kept note', supplierName: 'Carrier X' })
  })

  it('reads the values once, at the recalculation date (the future value is ignored)', async () => {
    const s = build([carried()])
    await go(s)
    expect(s.em.find.mock.calls.filter(([entity]) => entity === CpqCostIndexValue)).toHaveLength(1)
    expect(s.costs[0].indexSnapshot).toMatchObject({ value: '82.4' })
  })

  it('a renegotiation-due line stays estimated, keeps its value and snapshot, and still blocks conversion (COSTS_NOT_CONFIRMED)', async () => {
    const s = build([carried({ validUntil: '2027-06-30', supplierTermEnd: '2027-06-30' })])
    await go(s)
    expect(s.costs[0]).toMatchObject({ valueStatus: 'estimated', renegotiationDue: true, unitAmount: '37', instanceAmount: '37', indexSnapshot: snapshot() })
    const blockers = conversionCostBlockers([{ quoteLineId: LINE_ID, charges: [] }], [s.costs[0] as never], '2026-11-16')
    expect(blockers).toEqual([{ quoteLineId: LINE_ID, costKeys: ['tail'], chargeCodes: [] }])
  })

  it.each([['supplier'], ['manual']])('a %s value is not re-evaluated', async (valueOrigin) => {
    const s = build([carried({ valueOrigin })])
    await go(s)
    expect(s.costs[0]).toMatchObject({ unitAmount: '37', indexSnapshot: snapshot() })
  })

  it('other carried values are unchanged (a carried fixed cost keeps its amount)', async () => {
    const s = build([carried({ id: 'k-2', costKey: 'other', source: 'fixed', unitAmount: '240', instanceAmount: '240', indexSnapshot: null, costElementId: null }), carried()])
    await go(s)
    expect(s.costs[0]).toMatchObject({ unitAmount: '240', instanceAmount: '240', indexSnapshot: null })
    expect(s.costs[1]).toMatchObject({ unitAmount: '43.2' })
  })

  it('Amend keeps the contracted value (no re-evaluation)', async () => {
    const s = build([carried()])
    await go(s, 'amend', ({ ...(managed() as object), configuration: { _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcPriceFrozen: true } }) as never)
    expect(s.costs[0]).toMatchObject({ unitAmount: '37', indexSnapshot: snapshot() })
    expect(s.em.find.mock.calls.filter(([entity]) => entity === CpqCostIndexValue)).toHaveLength(0)
  })

  it('no value in force at the date leaves the line as it is', async () => {
    const s = build([carried()], { indexValues: [value('2026-12-01', 1, '99')] })
    await go(s)
    expect(s.costs[0]).toMatchObject({ unitAmount: '37', valueStatus: 'confirmed', indexSnapshot: snapshot() })
  })
})

describe('Renew activation updates the item cost in place (ARC fixtures)', () => {
  const itemCost = () => ({
    id: 'ic-1', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', assetId: null, status: 'active', endedAt: null, startedAt: '2026-01-01', lastChangeId: 'log-0', lastOrderLineCostId: 'olc-0',
    deletedAt: null, costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'index', costModel: 'flat',
    valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: '37', instanceAmount: '37', totalAmount: '37', currencyCode: 'USD', fxRate: null, fxRateDate: null, fxRateSource: null,
    fxRateDerivation: null, indexSnapshot: snapshot(), supplierId: null, supplierName: null, supplierQuoteRef: null, validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: null,
  }) as Row

  it('the item cost is unchanged by the Renew recalculation, then updated in place (same id) on activation, reported as cost_changed with cause renew', async () => {
    const inventoryRow = itemCost()
    const quoteCost = {
      id: 'k-1', ...SCOPE, deletedAt: null, quoteConfigurationId: QUOTE_ID, quoteLineId: LINE_ID, costKey: 'tail', chargeCode: 'mrc', origin: 'carried', valueOrigin: 'carried',
      valueStatus: 'confirmed', role: 'price_basis', costType: 'mrc', source: 'index', costModel: 'flat', costElementId: 'el-1', unitAmount: '37', instanceAmount: '37', currencyCode: 'USD',
      validUntil: '2030-01-01', supplierTermEnd: '2030-01-01', renegotiationDue: false, sourcingStatus: 'not_requested', note: null, driverHash: null, errorCode: null, indexSnapshot: snapshot(),
    } as Row
    const s = store({
      charges: [{ id: 'charge-1', ...SCOPE, deletedAt: null, isActive: true, offeringId: OFFERING, code: 'mrc', sortOrder: 0, quantityAttributeCode: 'qty', applicabilityCondition: null }],
      elements: [{ id: 'el-1', ...SCOPE, deletedAt: null, isActive: true, productChargeId: 'charge-1', code: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed',
        costModel: 'flat', amount: '100', currencyCode: 'USD', costTableId: null, costColumnKey: null, estimateAmount: null, applicabilityCondition: null, sortOrder: 0 }],
      costs: [quoteCost], targets: [{ ...SCOPE, deletedAt: null, quoteId: QUOTE_ID, subscriptionId: 'sub-1', newTermEnd: '2028-12-31' }],
      indexValues: [{ ...SCOPE, costIndexId: INDEX, effectiveDate: '2026-11-10', revision: 2, value: '82.4' }],
    })
    await resolveQuoteCosts({
      em: s.em as never, quote: { id: QUOTE_ID, quoteId: 'sq', cpqStatus: 'new', quoteType: 'renew', currencyCode: 'USD' } as never, scope: SCOPE, asOfDate: ASOF, isEnabled: async () => true,
      lines: [{ lineConfig: { quoteLineId: LINE_ID, offeringId: OFFERING, productId: null, targetSubscriptionId: 'sub-1',
        configuration: { _arcMirroredFromItemId: 'item-1', _arcCostsCarried: true, _arcCarriedCostSetHash: 'h' } } as never, mergedConfig: {} }],
    })
    // before activation: the quote line moved, the item cost did not
    expect(quoteCost).toMatchObject({ unitAmount: '43.2', indexSnapshot: { value: '82.4' } })
    expect(inventoryRow).toMatchObject({ id: 'ic-1', unitAmount: '37', indexSnapshot: { value: '70' } })

    // activation: the order line cost (copied from the quote line) is synced in place by replaceItemCosts
    const seed = costSeedFromOrderLineCost({ ...quoteCost, id: 'olc-1', inventoryCostId: 'ic-1', totalAmount: '43.2' } as never)
    const invEm = {
      find: jest.fn(async (entity: unknown) => { expect(entity).toBe(CpqInventoryCost); return [inventoryRow] }),
      create: jest.fn(), persist: jest.fn(),
    }
    const synced = await replaceItemCosts(invEm as never, [{ subscriptionId: 'sub-1', subscriptionItemId: 'item-1', seeds: [seed], fullImage: true }], { scope: SCOPE, startedAt: '2027-01-01', endedAt: '2027-01-01' })
    expect(invEm.create).not.toHaveBeenCalled()
    expect(inventoryRow).toMatchObject({ id: 'ic-1', unitAmount: '43.2', instanceAmount: '43.2', indexSnapshot: { value: '82.4', revision: 2, asOfDate: ASOF }, origin: 'catalog' })
    expect(synced.changes.map((change) => [change.inventoryCostId, change.kind])).toEqual([['ic-1', 'changed']])

    // the order service reports it as cost_changed with cause renew
    const h = createActivationHarness({
      quoteType: 'renew',
      targets: [{ subscriptionId: 'sub-1', mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }],
      inventory: { applyRenewal: {
        changeLog: { effectiveAt: new Date('2026-06-01'), afterSnapshot: { items: [] }, lineChanges: [] },
        subscription: { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01'), currentTermEnd: new Date('2028-01-01') },
        inventoryCostChanges: synced.changes.map((change) => ({ ...change, changeLogId: 'log-1', effectiveDate: '2027-01-01' })),
      } },
    })
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    const payloads = emitSpy.mock.calls.filter(([id]) => id === 'cpq.subscription.cost_changed').map(([, payload]) => payload as Record<string, unknown>)
    expect(payloads.map((p) => [p.cause, p.kind, p.inventoryCostId])).toEqual([['renew', 'changed', 'ic-1']])
    emitSpy.mockRestore()
  })
})
