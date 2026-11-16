import { arcCostsOfLine, arcDiffCostRows, costLineEntry, orderArcCostsOfLine } from '../arcCostView'

const costs = { before: { mrcCost: 270, nrcCost: 10 }, after: { mrcCost: 240, nrcCost: 10 } }

describe('arcDiffCostRows', () => {
  it('returns null (rows hidden) without costs', () => {
    expect(arcDiffCostRows(undefined, { beforeMrc: 500, afterMrc: 400 })).toBeNull()
    expect(arcDiffCostRows(null, { beforeMrc: 500, afterMrc: 400 })).toBeNull()
  })
  it('derives the MRC margin from the line price and the MRC cost', () => {
    expect(arcDiffCostRows(costs, { beforeMrc: 500, afterMrc: 400 })).toEqual([
      { key: 'mrcCost', before: 270, after: 240 },
      { key: 'mrcMargin', before: 230, after: 160 },
      { key: 'nrcCost', before: 10, after: 10 },
    ])
  })
  it('rounds the margin to four decimals', () => {
    const rows = arcDiffCostRows({ before: { mrcCost: 0.1, nrcCost: 0 }, after: { mrcCost: 0.2, nrcCost: 0 } }, { beforeMrc: 0.3, afterMrc: 0.3 })
    expect(rows?.[1]).toEqual({ key: 'mrcMargin', before: 0.2, after: 0.1 })
  })
})

describe('line lookups', () => {
  const data = { pricingRevision: 1, lines: [{ quoteLineId: 'l1', costs: [], arcCosts: costs }, { quoteLineId: 'l2', costs: [] }] }
  it('finds arcCosts on a quote line and is undefined for a line without them (or without a read)', () => {
    expect(arcCostsOfLine(data, 'l1')).toBe(costs)
    expect(arcCostsOfLine(data, 'l2')).toBeUndefined()
    expect(arcCostsOfLine(null, 'l1')).toBeUndefined()
    expect(costLineEntry(data, 'l2')?.quoteLineId).toBe('l2')
  })
  it('finds arcCosts on an order line', () => {
    expect(orderArcCostsOfLine({ orderId: 'o', lines: [{ orderLineId: 'ol', costs: [], arcCosts: costs }] }, 'ol')).toBe(costs)
    expect(orderArcCostsOfLine({ orderId: 'o', lines: [] }, 'ol')).toBeUndefined()
  })
})

import {
  arcCostBadges, arcLineNotice, buildKeepCurrentBody, canKeepCurrent, canRefreshFromSubscription, carriedChanged, costSourceChangedView,
  exposureReference, exposureRows, isCostOnlyAmend, keepCurrentIssues, keepCurrentShortDates, parseCostSourceChanged, previousParts,
} from '../arcCostView'
import type { FullQuoteCost } from '../quoteCostView'

const cost = (over: Partial<FullQuoteCost> = {}): FullQuoteCost => ({
  id: 'c1', costKey: 'tail', name: 'Tail', role: 'price_basis', valueStatus: 'estimated', expired: false, quoteLineId: 'l1', chargeCode: null,
  origin: 'carried', carried: true, renegotiationDue: true, costType: 'mrc', source: 'fixed', costModel: 'flat', unitAmount: '240', instanceAmount: '240',
  currencyCode: 'EUR', supplierName: 'Carrier X', supplierQuoteRef: 'Q-1', validUntil: '2027-01-01', supplierTermEnd: '2027-06-30', supplierMinTermMonths: null, note: null,
  previous: { unitAmount: '270', currencyCode: 'EUR', supplierName: 'Carrier X', validUntil: '2027-01-01', supplierTermEnd: '2028-11-30' },
  ...over,
})

describe('notices and badges', () => {
  const mirror = { _arcMirroredFromItemId: 'i' }
  it('Phase 1 frozen standalone Renew line and merge line get notices; a new standalone Renew line none', () => {
    expect(arcLineNotice('renew', { action: 'modify', targetSubscriptionId: 's', configuration: { ...mirror, _arcPriceFrozen: true, _arcCostPlusFrozen: true } })).toBe('phase1')
    expect(arcLineNotice('renew', { action: 'modify', targetSubscriptionId: null, configuration: mirror })).toBe('merge')
    expect(arcLineNotice('renew', { action: 'modify', targetSubscriptionId: 's', configuration: { ...mirror, _arcCostsCarried: true } })).toBeNull()
    expect(arcLineNotice('amend', { action: 'modify', targetSubscriptionId: null, configuration: mirror })).toBeNull()
    expect(arcLineNotice('renew', { action: 'cancel', targetSubscriptionId: null, configuration: mirror })).toBeNull()
  })
  it('badges Carried and Renegotiation due in stable order', () => {
    expect(arcCostBadges([{ carried: true }, { renegotiationDue: true }])).toEqual(['carried', 'renegotiationDue'])
    expect(arcCostBadges([{}])).toEqual([])
  })
})

describe('Was diff and cost-only Amend', () => {
  it('shows only when the carried cost differs from its source', () => {
    expect(previousParts(cost())).toEqual({ value: '270.00 EUR', supplierName: 'Carrier X', termEnd: '2028-11-30' })
    expect(carriedChanged(cost({ unitAmount: '270', supplierTermEnd: '2028-11-30' }))).toBe(false)
    expect(previousParts(cost({ previous: undefined }))).toBeNull()
  })
  it('cost-only Amend: untouched frozen modify lines with a changed carried cost', () => {
    const line = { action: 'modify', configuration: { _arcPriceFrozen: true } }
    const data = { pricingRevision: 1, lines: [{ quoteLineId: 'l1', costs: [cost()] }] }
    expect(isCostOnlyAmend('amend', [line], data)).toBe(true)
    expect(isCostOnlyAmend('amend', [{ ...line, configuration: { _arcPriceFrozen: true, _arcReconfigured: true } }], data)).toBe(false)
    expect(isCostOnlyAmend('amend', [line, { action: 'add' }], data)).toBe(false)
    expect(isCostOnlyAmend('renew', [line], data)).toBe(false)
    expect(isCostOnlyAmend('amend', [line], { pricingRevision: 1, lines: [] })).toBe(false)
  })
})

describe('Keep current cost', () => {
  const ctx = { canManage: true, cpqStatus: 'ready' }
  it('is offered on due carried costs with an amount, to managers, on open quotes', () => {
    expect(canKeepCurrent(cost(), ctx)).toBe(true)
    expect(canKeepCurrent(cost(), { ...ctx, canManage: false })).toBe(false)
    expect(canKeepCurrent(cost(), { ...ctx, cpqStatus: 'rejected' })).toBe(false)
    expect(canKeepCurrent(cost(), { ...ctx, convertedOrderId: 'o' })).toBe(false)
    expect(canKeepCurrent(cost({ renegotiationDue: false }), ctx)).toBe(false)
    expect(canKeepCurrent(cost({ unitAmount: null }), ctx)).toBe(false)
    expect(canKeepCurrent({ id: 'c', costKey: 'k', name: 'n', role: 'r', valueStatus: 'estimated', expired: false, carried: true, renegotiationDue: true }, ctx)).toBe(false)
  })
  const form = { validUntil: '2028-01-01', supplierTermEnd: '', rolling: false, supplierQuoteRef: '', note: '' }
  it('needs a new supplier quote ref or a note, and valid dates', () => {
    expect(keepCurrentIssues(form, cost())).toEqual(['VALIDITY_EVIDENCE_REQUIRED'])
    expect(keepCurrentIssues({ ...form, supplierQuoteRef: 'Q-1' }, cost())).toEqual(['VALIDITY_EVIDENCE_REQUIRED'])
    expect(keepCurrentIssues({ ...form, supplierQuoteRef: 'Q-2' }, cost())).toEqual([])
    expect(keepCurrentIssues({ ...form, note: 'agreed', validUntil: '01/01/2028' }, cost())).toEqual(['DATE_INVALID'])
  })
  it('warns on dates before the new term end; rolling clears the supplier term', () => {
    expect(keepCurrentShortDates({ ...form, validUntil: '2026-12-01', supplierTermEnd: '2026-11-01' }, '2027-01-01')).toEqual(['validUntil', 'supplierTermEnd'])
    expect(keepCurrentShortDates({ ...form, supplierTermEnd: '2026-11-01', rolling: true, validUntil: '2028-01-01' }, '2027-01-01')).toEqual([])
    expect(keepCurrentShortDates(form, null)).toEqual([])
  })
  it('builds the keepCurrent body without an amount', () => {
    expect(buildKeepCurrentBody({ ...form, rolling: true, note: ' ok ' }, 7)).toEqual({ keepCurrent: true, validUntil: '2028-01-01', supplierTermEnd: null, note: 'ok', expectedRevision: 7 })
    expect(buildKeepCurrentBody({ ...form, supplierTermEnd: '2029-01-01', supplierQuoteRef: 'Q-2' }, 1)).toEqual({ keepCurrent: true, validUntil: '2028-01-01', supplierTermEnd: '2029-01-01', supplierQuoteRef: 'Q-2', expectedRevision: 1 })
  })
})

describe('Refresh from subscription visibility', () => {
  const line = { action: 'modify', targetSubscriptionId: 's', configuration: { _arcMirroredFromItemId: 'i' } }
  const ctx = { granted: ['cpq.quotes.manage', 'cpq.arc.amend.manage'], cpqStatus: 'ready' }
  it('needs manage + the quote type feature, a standalone mirror line and an editable quote', () => {
    expect(canRefreshFromSubscription('amend', line, ctx)).toBe(true)
    expect(canRefreshFromSubscription('renew', line, ctx)).toBe(false)
    expect(canRefreshFromSubscription('amend', line, { ...ctx, granted: ['cpq.arc.amend.manage'] })).toBe(false)
    expect(canRefreshFromSubscription('amend', { ...line, action: 'cancel' }, ctx)).toBe(false)
    expect(canRefreshFromSubscription('renew', { ...line, targetSubscriptionId: null }, { ...ctx, granted: ['cpq.quotes.manage', 'cpq.arc.renew.manage'] })).toBe(false)
    expect(canRefreshFromSubscription('amend', line, { ...ctx, cpqStatus: 'accepted' })).toBe(false)
    expect(canRefreshFromSubscription('amend', line, { ...ctx, removed: true })).toBe(false)
    expect(canRefreshFromSubscription('new', line, ctx)).toBe(false)
  })
})

describe('COST_SOURCE_CHANGED', () => {
  const body = { error: 'COST_SOURCE_CHANGED', lines: [{ quoteLineId: 'l1', subscriptionItemId: 'i1', costKeys: ['tail'] }, { nope: 1 }] }
  it('parses only the 409 with that code', () => {
    expect(parseCostSourceChanged(409, body)).toEqual([{ quoteLineId: 'l1', subscriptionItemId: 'i1', costKeys: ['tail'] }])
    expect(parseCostSourceChanged(409, { error: 'COST_LOCKED' })).toBeNull()
    expect(parseCostSourceChanged(422, body)).toBeNull()
    expect(parseCostSourceChanged(409, { error: 'COST_SOURCE_CHANGED' })).toEqual([])
  })
  it('names the lines and offers Refresh only before conversion', () => {
    const entries = parseCostSourceChanged(409, body) ?? []
    const names = new Map([['l1', 'Fiber 100M']])
    expect(costSourceChangedView(entries, names, 'quote').lines).toEqual([{ quoteLineId: 'l1', name: 'Fiber 100M', costKeys: ['tail'], refreshable: true }])
    expect(costSourceChangedView(entries, new Map(), 'order').lines[0]).toMatchObject({ name: 'l1', refreshable: false })
  })
})

describe('exposure', () => {
  const exposure = { referenceDate: '2026-11-15', items: [
    { inventoryCostId: 'a', costKey: 'k', name: 'tail', supplierName: 'Carrier X', supplierTermEnd: '2028-11-30', exposureMonths: 12, termUnknown: false },
    { inventoryCostId: 'b', costKey: 'k2', name: 'Carrier Y line', supplierName: 'Carrier Y', supplierTermEnd: null, exposureMonths: null, termUnknown: true },
  ] }
  it('builds rows with supplier names and unknown terms; nothing when empty', () => {
    expect(exposureRows(exposure)).toEqual([
      { key: 'a', label: 'Carrier X tail', termEnd: '2028-11-30', months: 12, termUnknown: false },
      { key: 'b', label: 'Carrier Y line', termEnd: null, months: null, termUnknown: true },
    ])
    expect(exposureRows({ referenceDate: 'x', items: [] })).toEqual([])
    expect(exposureRows(undefined)).toEqual([])
  })
  it('says today only for today', () => {
    expect(exposureReference('2026-11-15', '2026-11-15').today).toBe(true)
    expect(exposureReference('2026-12-01', '2026-11-15').today).toBe(false)
  })
})
