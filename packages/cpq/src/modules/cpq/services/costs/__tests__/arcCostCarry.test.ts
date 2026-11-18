import { CpqInventoryCost, CpqQuoteLineCost } from '../../../data/entities'
import { ARC_CARRIED_COST_SET_HASH_KEY, ARC_COSTS_CARRIED_KEY, stripQuoteOnlyArcMarkers } from '../../arcPriceFreeze'
import { carriedCostLines, itemCostSetHash, itemCostStateHash } from '../itemCostState'
import {
  carriedQuoteCostData, carryItemCosts, loadOpenItemCosts, reconcileRenewCosts, reconcileRenewLine, renewDuePatch, reevaluateCarriedIndexCosts, isIndexReevaluable,
  type RenewCostRow,
} from '../arcCostCarry'
import { conversionCostBlockers } from '../conversionGuard'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const QUOTE = { id: 'cpq-1', quoteId: 'sq-1' }
const ITEM = { id: 'item-1', status: 'active' }

const cost = (over: Record<string, unknown> = {}) => ({
  id: 'ic-1', subscriptionId: 'sub-1', subscriptionItemId: 'item-1', status: 'active', costKey: 'tail', chargeCode: 'mrc', origin: 'catalog', costElementId: 'el-1',
  name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'catalog',
  unitAmount: '270.0000', instanceAmount: '270.0000', totalAmount: '270.0000', currencyCode: 'USD', fxRate: '0.92000000', fxRateDate: '2026-11-01', fxRateSource: 'ecb',
  fxRateDerivation: 'direct', indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30',
  supplierTermEnd: '2028-11-30', supplierMinTermMonths: 12, note: 'n', ...over,
}) as unknown as CpqInventoryCost

function setup(existing: Array<Record<string, unknown>> = [], itemCosts: CpqInventoryCost[] = []) {
  const persisted: Array<Record<string, unknown>> = []
  const em = {
    find: jest.fn(async (entity: unknown) => (entity === CpqInventoryCost ? itemCosts : entity === CpqQuoteLineCost ? existing : [])),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((row: Record<string, unknown>) => { persisted.push(row) }),
    flush: jest.fn(async () => undefined),
  }
  const line = { quoteLineId: 'ql-1', configuration: { _arcMirroredFromItemId: 'item-1' } as Record<string, unknown> }
  return { em, persisted, line }
}

describe('carriedQuoteCostData', () => {
  it('copies the full field list incl. source, cost_model, index_snapshot and the FX snapshot', () => {
    const row = cost()
    expect(carriedQuoteCostData(row, QUOTE, 'ql-1', SCOPE)).toEqual({
      id: expect.any(String), organizationId: 'org-1', tenantId: 'tenant-1', quoteConfigurationId: 'cpq-1', quoteId: 'sq-1', quoteLineId: 'ql-1',
      costKey: 'tail', chargeCode: 'mrc', origin: 'carried', costElementId: 'el-1', carriedFromItemCostId: 'ic-1', carriedFromHash: itemCostStateHash(row as never),
      name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed', valueOrigin: 'carried',
      unitAmount: '270.0000', instanceAmount: '270.0000', currencyCode: 'USD', fxRate: '0.92000000', fxRateDate: '2026-11-01', fxRateSource: 'ecb', fxRateDerivation: 'direct',
      indexSnapshot: { index: 'cpi', value: 1.2 }, supplierId: 'sup-1', supplierName: 'Carrier X', supplierQuoteRef: 'CX-1', validUntil: '2028-11-30',
      supplierTermEnd: '2028-11-30', supplierMinTermMonths: 12, note: 'n', sourcingStatus: 'not_requested', renegotiationDue: false,
    })
  })

  it('is confirmed whatever the item cost status says, as long as it holds an amount; without an amount it keeps its own status', () => {
    expect(carriedQuoteCostData(cost({ valueStatus: 'estimated' }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ valueStatus: 'confirmed' })
    expect(carriedQuoteCostData(cost({ valueStatus: 'none', unitAmount: null, instanceAmount: null }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ valueStatus: 'none', unitAmount: null })
  })

  it('normalises Date columns to ISO days', () => {
    expect(carriedQuoteCostData(cost({ fxRateDate: new Date('2026-11-01T10:00:00Z'), validUntil: null }), QUOTE, 'ql-1', SCOPE)).toMatchObject({ fxRateDate: '2026-11-01', validUntil: null })
  })
})

describe('carryItemCosts', () => {
  it('creates one carried row per open cost and marks the line with the set hash the guard recomputes', async () => {
    const open = [cost({ id: 'ic-2', costKey: 'install', costType: 'nrc' }), cost()]
    const { em, persisted, line } = setup([], open)
    const result = await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: open })
    expect(result.rows.map((row) => row.costKey)).toEqual(['install', 'tail'])
    expect(persisted).toHaveLength(2)
    const expected = itemCostSetHash(open as never, ITEM as never)
    expect(result.setHash).toBe(expected)
    expect(line.configuration).toMatchObject({ _arcMirroredFromItemId: 'item-1', [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: expected })
    // the guard's covered-line projection reads exactly these markers
    expect(carriedCostLines([{ quoteLineId: 'ql-1', action: 'modify', configuration: line.configuration, sourceSubscriptionItemId: 'item-1' } as never], 'amend'))
      .toEqual([{ quoteLineId: 'ql-1', subscriptionItemId: 'item-1', expectedSetHash: expected }])
    // markers are quote-only: they never reach orders / items
    expect(stripQuoteOnlyArcMarkers(line.configuration)).toEqual({ _arcMirroredFromItemId: 'item-1' })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('loads the item costs itself when none are given, scoped and open only', async () => {
    const { em, line } = setup([], [cost()])
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE })
    expect(em.find).toHaveBeenCalledWith(CpqInventoryCost, { subscriptionItemId: { $in: ['item-1'] }, status: 'active', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
  })

  it('ignores ended costs and costs of another item', async () => {
    const { em, persisted, line } = setup()
    const result = await carryItemCosts(em as never, {
      quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE,
      openCosts: [cost({ status: 'ended' }), cost({ id: 'ic-9', subscriptionItemId: 'item-2' })],
    })
    expect(result).toEqual({ rows: [], setHash: null })
    expect(persisted).toHaveLength(0)
  })

  it('an item with no open costs leaves the line unmarked', async () => {
    const { em, line } = setup()
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [] })
    expect(line.configuration).toEqual({ _arcMirroredFromItemId: 'item-1' })
  })

  it('replace soft-deletes the line\'s existing cost rows (flushed before the new rows) and then carries', async () => {
    const stale = { id: 'old', deletedAt: null as Date | null }
    const { em, persisted, line } = setup([stale])
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [cost()], replace: true })
    expect(stale.deletedAt).toBeInstanceOf(Date)
    expect(em.find).toHaveBeenCalledWith(CpqQuoteLineCost, { quoteLineId: 'ql-1', organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null })
    expect(em.flush).toHaveBeenCalled()
    expect(persisted).toHaveLength(1)
  })

  it('never opens a sourcing request: rows are created not_requested with no request fields', async () => {
    const { em, persisted, line } = setup()
    await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [cost({ source: 'on_request' })] })
    expect(persisted[0]).toMatchObject({ sourcingStatus: 'not_requested' })
    expect(persisted[0]).not.toHaveProperty('costRequestId')
  })
})

describe('loadOpenItemCosts', () => {
  it('groups by item and reads nothing for no items', async () => {
    const { em } = setup([], [cost(), cost({ id: 'ic-3', subscriptionItemId: 'item-2' })])
    expect(await loadOpenItemCosts(em as never, [], SCOPE)).toEqual(new Map())
    expect(em.find).not.toHaveBeenCalled()
    const grouped = await loadOpenItemCosts(em as never, ['item-1', 'item-2'], SCOPE)
    expect([...grouped.keys()]).toEqual(['item-1', 'item-2'])
  })
})

// ─── ARC costs step 14: R1c reconciliation, renegotiation due, index re-evaluation seam ───

const row = (over: Record<string, unknown> = {}) => ({
  costKey: 'tail', origin: 'carried', role: 'price_basis', costType: 'mrc', source: 'fixed', chargeCode: 'mrc', costElementId: 'el-1', valueStatus: 'confirmed',
  valueOrigin: 'carried', unitAmount: '320', validUntil: '2030-01-01', supplierTermEnd: '2030-01-01', renegotiationDue: false, sourcingStatus: 'not_requested', ...over,
}) as unknown as RenewCostRow
const reconcile = (rows: RenewCostRow[], over: Record<string, unknown> = {}) => reconcileRenewCosts({
  rows, applicableKeys: new Set(['tail']), chargeCodes: new Set(['mrc']), newTermEnd: '2028-12-31', ...over,
} as never)

describe('carryItemCosts markEmpty (Renew)', () => {
  it('marks a line cost-managed with the empty set hash when the item has no open costs', async () => {
    const { em, persisted, line } = setup()
    const result = await carryItemCosts(em as never, { quote: QUOTE as never, line: line as never, item: ITEM as never, scope: SCOPE, openCosts: [], markEmpty: true })
    expect(result.rows).toHaveLength(0)
    expect(persisted).toHaveLength(0)
    expect(line.configuration).toMatchObject({ [ARC_COSTS_CARRIED_KEY]: true, [ARC_CARRIED_COST_SET_HASH_KEY]: itemCostSetHash([], ITEM as never) })
  })
})

describe('reconcileRenewCosts (R1c)', () => {
  it('matches a carried cost to an applicable element by cost key', () => {
    const tail = row()
    const out = reconcile([tail])
    expect(out.matched).toEqual([tail])
    expect(out.dropped).toEqual([])
    expect(out.instantiate).toEqual([])
  })

  it('instantiates an applicable element the item lacks (sorted keys)', () => {
    const out = reconcile([row()], { applicableKeys: new Set(['tail', 'setup', 'install']) })
    expect(out.instantiate).toEqual(['install', 'setup'])
    expect(reconcile([], { applicableKeys: new Set(['tail']) }).instantiate).toEqual(['tail'])
  })

  it('drops a carried cost whose element no longer applies, or whose charge code no longer resolves; carries one no element claimed', () => {
    const gone = row({ costKey: 'old' })
    const chargeGone = row({ costKey: 'tail', chargeCode: 'removed' })
    const free = row({ costKey: 'free', costElementId: null, chargeCode: null })
    const out = reconcile([gone, free, chargeGone])
    expect(out.dropped).toEqual([gone, chargeGone])
    expect(out.carried).toEqual([free])
    expect(out.matched).toEqual([])
  })

  it('ignores non-carried rows (catalog, manual)', () => {
    const out = reconcile([row({ origin: 'catalog', costKey: 'x' }), row({ origin: 'manual', costKey: 'y' })])
    expect(out.matched).toEqual([])
    expect(out.dropped).toEqual([])
    expect(out.due).toEqual([])
  })

  it('flags due kept rows and never dropped ones', () => {
    const dueRow = row({ validUntil: '2027-01-01' })
    const dropped = row({ costKey: 'old', validUntil: '2027-01-01' })
    const out = reconcile([dueRow, dropped])
    expect(out.due).toEqual([{ row: dueRow, patch: { renegotiationDue: true, valueStatus: 'estimated' } }])
  })
})

describe('renewDuePatch (R13)', () => {
  it('is due when valid_until or supplier_term_end is before the new term end; the end date itself is not short', () => {
    expect(renewDuePatch(row({ validUntil: '2028-12-30', supplierTermEnd: null }), '2028-12-31')).toEqual({ renegotiationDue: true, valueStatus: 'estimated' })
    expect(renewDuePatch(row({ validUntil: null, supplierTermEnd: '2028-12-30' }), new Date('2028-12-31T00:00:00Z'))).toEqual({ renegotiationDue: true, valueStatus: 'estimated' })
    expect(renewDuePatch(row({ validUntil: '2028-12-31', supplierTermEnd: '2028-12-31' }), '2028-12-31')).toBeNull()
  })

  it('is null without dates, without a term end, for NRC, for non-carried values and for answered requests', () => {
    expect(renewDuePatch(row({ validUntil: null, supplierTermEnd: null }), '2028-12-31')).toBeNull()
    expect(renewDuePatch(row({ validUntil: '2020-01-01' }), null)).toBeNull()
    expect(renewDuePatch(row({ validUntil: '2020-01-01', costType: 'nrc' }), '2028-12-31')).toBeNull()
    expect(renewDuePatch(row({ validUntil: '2020-01-01', valueOrigin: 'manual' }), '2028-12-31')).toBeNull()
    expect(renewDuePatch(row({ validUntil: '2020-01-01', sourcingStatus: 'answered' }), '2028-12-31')).toBeNull()
  })

  it('does not rewrite an already-due row, and un-flags one that is no longer short', () => {
    expect(renewDuePatch(row({ validUntil: '2020-01-01', renegotiationDue: true, valueStatus: 'estimated' }), '2028-12-31')).toBeNull()
    expect(renewDuePatch(row({ renegotiationDue: true, valueStatus: 'estimated' }), '2028-12-31')).toEqual({ renegotiationDue: false, valueStatus: 'confirmed' })
    expect(renewDuePatch(row({ renegotiationDue: true, valueStatus: 'none', unitAmount: null }), '2028-12-31')).toEqual({ renegotiationDue: false })
  })
})

describe('reconcileRenewLine call order (reconciliation, then index re-evaluation)', () => {
  const index = (over: Record<string, unknown> = {}) => row({ costKey: 'idx', source: 'index', ...over })
  const run = (rows: RenewCostRow[], hook: jest.Mock, order: string[] = []) => reconcileRenewLine({
    rows, applicableKeys: new Set(['tail', 'idx']), chargeCodes: new Set(['mrc']), newTermEnd: '2028-12-31', asOf: '2027-11-15',
  }, { reevaluateCarriedIndexCosts: hook as never })

  it('hands the hook only carried index lines with value_origin carried that are not due, post-reconciliation', async () => {
    const order: string[] = []
    const ok = index()
    const due = index({ costKey: 'idx2', validUntil: '2027-01-01' })
    const manual = index({ costKey: 'idx3', valueOrigin: 'manual' })
    const dropped = index({ costKey: 'idx4' })
    const nonIndex = row()
    const hook = jest.fn(async ({ lines }: { lines: RenewCostRow[] }) => { order.push(`hook:${lines.map((l) => l.costKey).join(',')}`); return [] })
    const out = await reconcileRenewLine({
      rows: [ok, due, manual, dropped, nonIndex], applicableKeys: new Set(['tail', 'idx', 'idx2', 'idx3']), chargeCodes: new Set(['mrc']), newTermEnd: '2028-12-31', asOf: '2027-11-15',
    }, { reevaluateCarriedIndexCosts: hook as never })
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0][0]).toMatchObject({ asOf: '2027-11-15' })
    expect(order).toEqual(['hook:idx'])
    // reconciliation ran first: the dropped row never reaches the hook, the due one was flagged before it
    expect(out.dropped).toEqual([dropped])
    expect(out.due.map((entry) => entry.row)).toEqual([due])
    expect(isIndexReevaluable({ ...due, renegotiationDue: true } as never)).toBe(false)
  })

  it('does not call the hook when nothing qualifies, and the shipped seam is a no-op', async () => {
    const hook = jest.fn(async () => [])
    await run([row(), index({ validUntil: '2020-01-01' })], hook)
    expect(hook).not.toHaveBeenCalled()
    expect(await reevaluateCarriedIndexCosts({ lines: [index()], asOf: '2027-11-15' })).toEqual([])
    const out = await reconcileRenewLine({ rows: [index()], applicableKeys: new Set(['idx']), chargeCodes: new Set(['mrc']), newTermEnd: '2028-12-31', asOf: '2027-11-15' })
    expect(out.indexPatches).toEqual([])
  })

  it('reduces the hook result to value / snapshot fields and ignores rows it was not given', async () => {
    const target = index()
    const hook = jest.fn(async () => [
      { row: target, patch: { unitAmount: '1', instanceAmount: '1', indexSnapshot: { v: 1 }, valueStatus: 'none', note: 'x' } },
      { row: index({ costKey: 'stranger' }), patch: { unitAmount: '9' } },
      { row: target, patch: { valueStatus: 'none' } },
    ])
    const out = await run([target], hook)
    expect(out.indexPatches).toEqual([{ row: target, patch: { unitAmount: '1', instanceAmount: '1', indexSnapshot: { v: 1 } } }])
  })
})

describe('conversion guard with renegotiation-due costs (R7 / R13)', () => {
  const guardRow = (over: Record<string, unknown> = {}) => ({ quoteLineId: 'ql-1', costKey: 'tail', role: 'price_basis', valueStatus: 'estimated', validUntil: '2030-01-01', ...over }) as never
  it('refuses a due price-basis cost (estimated) with its key; a due margin-only cost does not block', () => {
    expect(conversionCostBlockers([{ quoteLineId: 'ql-1', charges: [] }], [guardRow()], '2027-11-15')).toEqual([{ quoteLineId: 'ql-1', costKeys: ['tail'], chargeCodes: [] }])
    expect(conversionCostBlockers([{ quoteLineId: 'ql-1', charges: [] }], [guardRow({ role: 'margin_only', costKey: 'm' })], '2027-11-15')).toEqual([])
  })

  it('an answered / kept (confirmed) cost no longer blocks', () => {
    expect(conversionCostBlockers([{ quoteLineId: 'ql-1', charges: [] }], [guardRow({ valueStatus: 'confirmed' })], '2027-11-15')).toEqual([])
  })
})
