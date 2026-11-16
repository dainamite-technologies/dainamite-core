import { LockMode } from '@mikro-orm/core'
import {
  CpqOrderConfiguration, CpqOrderLineConfiguration, CpqOrderLineCost, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration,
} from '../../../data/entities'
import { CpqOrderCostReconfirmService } from '../orderCostReconfirm'
import { costSeedFromOrderLineCost, createItemCosts } from '../inventoryCostSync'

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const ACTOR = '33333333-3333-4333-8333-333333333333'
const ORDER = 'oc-1', COST = 'olc-1'
type Row = Record<string, any>

const costRow = (over: Row = {}): Row => ({
  id: COST, orderConfigurationId: ORDER, orderLineId: 'ol-1', sourceQuoteLineCostId: 'qlc-1', inventoryCostId: null, costKey: 'tail', chargeCode: 'mrc',
  origin: 'catalog', costElementId: null, name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'table', costModel: 'flat', valueStatus: 'confirmed',
  valueOrigin: 'catalog', unitAmount: '276.0000', instanceAmount: '276.0000', totalAmount: '552.0000', currencyCode: 'EUR', fxRate: null, fxRateDate: null,
  fxRateSource: null, fxRateDerivation: null, indexSnapshot: null, supplierId: null, supplierName: 'Carrier', supplierQuoteRef: 'REF-1', validUntil: null,
  supplierTermEnd: null, supplierMinTermMonths: null, note: null, reconfirmedAt: null, reconfirmedByUserId: null, deletedAt: null, ...over,
})

function setup(opts: { status?: string; cost?: Row; enabled?: boolean; fx?: jest.Mock | null; line?: Row; currency?: string; sourceQuoteId?: string | null } = {}) {
  const trace: string[] = []
  const charges = [{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }]
  const order: Row = { id: ORDER, orderId: 'sales-1', sourceQuoteId: opts.sourceQuoteId === undefined ? 'q-1' : opts.sourceQuoteId, cpqStatus: opts.status ?? 'draft', currencyCode: opts.currency ?? 'EUR', totalMrc: '100' }
  const orderTotalsBefore = JSON.stringify(order)
  const line: Row = { orderLineId: 'ol-1', orderConfigurationId: ORDER, quantity: 2, charges, sourceQuoteLineId: 'ql-1', ...opts.line }
  const cost = opts.cost ?? costRow()
  const quote: Row = { id: 'q-1', quoteContext: {} }
  const tx: Row = {
    findOne: jest.fn(async (entity: unknown, where: Row, options?: Row) => {
      if (entity === CpqQuoteConfiguration) { trace.push(options?.lockMode === LockMode.PESSIMISTIC_WRITE ? 'tx:lock-quote' : 'tx:read-quote'); return quote }
      if (entity === CpqOrderConfiguration) { trace.push(options?.lockMode ? 'tx:LOCK-ORDER' : 'tx:read-order'); return order }
      if (entity === CpqOrderLineCost) { trace.push('tx:read-cost'); return where.id === cost.id ? cost : null }
      if (entity === CpqOrderLineConfiguration) return line
      if (entity === CpqQuoteLineConfiguration) return { quoteLineId: 'ql-1', offeringId: 'off', productId: null, configuration: { qty: 4 } }
      if (entity === CpqProductCharge) return { quantityAttributeCode: 'qty' }
      return null
    }),
    flush: jest.fn(async () => { trace.push('tx:flush') }),
    transactional: jest.fn(async (fn: (tx: Row) => Promise<unknown>) => { trace.push('tx:begin'); const out = await fn(tx); trace.push('tx:commit'); return out }),
  }
  const reader: Row = { findOne: jest.fn(async (entity: unknown) => { trace.push('pre-read-order'); return entity === CpqOrderConfiguration ? order : null }) }
  let forks = 0
  const em: Row = { fork: jest.fn(() => (forks++ === 0 ? reader : tx)), isInTransaction: jest.fn(() => false) }
  const fx = opts.fx === undefined ? jest.fn(async () => ({ ok: true, rate: '0.92000000', rateDate: '2026-11-15', source: 'ECB', derivation: 'direct' })) : opts.fx
  const service = new CpqOrderCostReconfirmService({ em: em as never, costService: { enabled: jest.fn(async () => opts.enabled !== false) } as never, fxRateResolver: fx ? { resolve: fx } as never : undefined })
  return { service, tx, reader, em, trace, order, line, cost, charges, fx, unchangedOrder: () => JSON.stringify(order) === orderTotalsBefore }
}

describe('reconfirm: the Q-D13 write', () => {
  it('the carrier confirms 276 -> 270: value, recomputed total_amount (instance x quantity, one rounding), reconfirmed_*; order charges and totals untouched', async () => {
    const h = setup()
    const result = await h.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'carrier mail' }, ACTOR, SCOPE)
    expect(h.cost).toMatchObject({ unitAmount: '270', instanceAmount: '270', totalAmount: '540', valueStatus: 'confirmed', valueOrigin: 'manual', origin: 'catalog', reconfirmedByUserId: ACTOR, note: 'carrier mail' })
    expect(h.cost.reconfirmedAt).toBeInstanceOf(Date)
    expect(result.cost).toMatchObject({ id: COST, unitAmount: '270', totalAmount: '540' })
    expect(result.audit.before.valueStatus).toBe('confirmed')
    expect(h.charges).toEqual([{ chargeCode: 'mrc', chargeType: 'mrc', totalPrice: 100 }])
    expect(h.unchangedOrder()).toBe(true)
    expect(h.tx.flush).toHaveBeenCalledTimes(1)
  })

  it('a foreign value takes the dated rate at the write: total = instance x fx_rate x quantity in the order currency', async () => {
    const h = setup()
    await h.service.reconfirm(ORDER, COST, { unitAmount: 300, currencyCode: 'USD', supplierQuoteRef: 'REF-2' }, ACTOR, SCOPE)
    expect(h.fx).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', scope: SCOPE })
    expect(h.cost).toMatchObject({ currencyCode: 'USD', fxRate: '0.92000000', fxRateSource: 'ECB', totalAmount: '552', supplierQuoteRef: 'REF-2' })
  })

  it('a foreign value with no rate is refused with CURRENCY_NO_RATE and nothing is written', async () => {
    const h = setup({ fx: jest.fn(async () => ({ ok: false, code: 'CURRENCY_NO_RATE' })) })
    await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 300, currencyCode: 'USD', note: 'x' }, ACTOR, SCOPE))
      .rejects.toMatchObject({ status: 422, message: 'CURRENCY_NO_RATE', details: { from: 'USD', to: 'EUR' } })
    expect(h.tx.flush).not.toHaveBeenCalled()
    expect(h.cost).toMatchObject({ unitAmount: '276.0000', reconfirmedAt: null })
  })

  describe('a cost with no value yet (review: currency of a first amount)', () => {
    const unknown = () => costRow({ valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, totalAmount: null, currencyCode: null })

    it('an amount without a currency is refused with CURRENCY_REQUIRED (never silently the order currency); nothing is written', async () => {
      const h = setup({ cost: unknown() })
      await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 250, note: 'carrier mail' }, ACTOR, SCOPE))
        .rejects.toMatchObject({ status: 422, message: 'CURRENCY_REQUIRED' })
      expect(h.tx.flush).not.toHaveBeenCalled()
      expect(h.cost).toMatchObject({ unitAmount: null, currencyCode: null, reconfirmedAt: null })
    })

    it('the amount with its foreign currency resolves the rate and is stored in that currency', async () => {
      const h = setup({ cost: unknown() })
      await h.service.reconfirm(ORDER, COST, { unitAmount: 250, currencyCode: 'USD', note: 'carrier mail' }, ACTOR, SCOPE)
      expect(h.fx).toHaveBeenCalledWith({ from: 'USD', to: 'EUR', scope: SCOPE })
      expect(h.cost).toMatchObject({ unitAmount: '250', currencyCode: 'USD', fxRate: '0.92000000', valueStatus: 'confirmed', valueOrigin: 'manual', totalAmount: '460' })
    })

    it('a foreign currency with no rate is refused with CURRENCY_NO_RATE', async () => {
      const h = setup({ cost: unknown(), fx: jest.fn(async () => ({ ok: false, code: 'CURRENCY_NO_RATE' })) })
      await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 250, currencyCode: 'USD', note: 'x' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'CURRENCY_NO_RATE' })
      expect(h.tx.flush).not.toHaveBeenCalled()
    })

    it('the amount in the order currency is stored as is (no snapshot)', async () => {
      const h = setup({ cost: unknown() })
      await h.service.reconfirm(ORDER, COST, { unitAmount: 250, currencyCode: 'EUR', note: 'carrier mail' }, ACTOR, SCOPE)
      expect(h.fx).not.toHaveBeenCalled()
      expect(h.cost).toMatchObject({ unitAmount: '250', currencyCode: 'EUR', fxRate: null, totalAmount: '500' })
    })
  })

  it('an unchanged foreign value keeps its stored snapshot (no rate lookup); back to the order currency clears it', async () => {
    const foreign = costRow({ currencyCode: 'USD', unitAmount: '300.0000', instanceAmount: '300.0000', fxRate: '0.90000000', fxRateDate: '2026-11-01', fxRateSource: 'ECB', fxRateDerivation: 'direct', totalAmount: '540.0000' })
    const kept = setup({ cost: foreign })
    await kept.service.reconfirm(ORDER, COST, { note: 'still valid' }, ACTOR, SCOPE)
    expect(kept.fx).not.toHaveBeenCalled()
    expect(kept.cost).toMatchObject({ fxRate: '0.90000000', totalAmount: '540', reconfirmedByUserId: ACTOR })
    const back = setup({ cost: costRow({ ...foreign }) })
    await back.service.reconfirm(ORDER, COST, { unitAmount: 250, currencyCode: 'EUR', note: 'EUR deal' }, ACTOR, SCOPE)
    expect(back.cost).toMatchObject({ currencyCode: 'EUR', fxRate: null, fxRateSource: null, totalAmount: '500' })
  })

  it('a per_unit cost multiplies by the charge quantity attribute of the source quote line', async () => {
    const h = setup({ cost: costRow({ costModel: 'per_unit' }) })
    await h.service.reconfirm(ORDER, COST, { unitAmount: 10, note: 'n' }, ACTOR, SCOPE)
    expect(h.cost).toMatchObject({ unitAmount: '10', instanceAmount: '40', totalAmount: '80' })
  })

  it('confirming without changing the value (an estimate) needs no evidence and keeps value_origin', async () => {
    const h = setup({ cost: costRow({ valueStatus: 'estimated', valueOrigin: 'catalog' }) })
    await h.service.reconfirm(ORDER, COST, { supplierName: 'Carrier B' }, ACTOR, SCOPE)
    expect(h.cost).toMatchObject({ valueStatus: 'confirmed', valueOrigin: 'catalog', supplierName: 'Carrier B', unitAmount: '276.0000' })
  })

  it('refusals: a changed value needs a NEW supplier quote reference or a note; extending a validity needs evidence; nothing is written', async () => {
    const h = setup()
    await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 270 }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'NOTE_REQUIRED' })
    await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 270, supplierQuoteRef: 'REF-1' }, ACTOR, SCOPE)).rejects.toMatchObject({ message: 'NOTE_REQUIRED' })
    await expect(h.service.reconfirm(ORDER, COST, { validUntil: '2027-01-01' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 422, message: 'VALIDITY_EVIDENCE_REQUIRED' })
    await expect(h.service.reconfirm(ORDER, COST, {}, ACTOR, SCOPE)).rejects.toThrow()
    await expect(h.service.reconfirm(ORDER, COST, { costKey: 'x' } as never, ACTOR, SCOPE)).rejects.toThrow()
    expect(h.tx.flush).not.toHaveBeenCalled()
    await h.service.reconfirm(ORDER, COST, { unitAmount: 270, supplierQuoteRef: 'REF-2' }, ACTOR, SCOPE)
    expect(h.cost.unitAmount).toBe('270')
  })

  it('refuses an active, fulfilled or cancelled order (409) and writes nothing; pending_activation is allowed', async () => {
    for (const [status, code] of [['active', 'ORDER_ACTIVATED'], ['fulfilled', 'ORDER_ACTIVATED'], ['cancelled', 'ORDER_CANCELLED']] as const) {
      const h = setup({ status })
      await expect(h.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'n' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 409, message: code })
      expect(h.tx.flush).not.toHaveBeenCalled()
      expect(h.cost).toMatchObject({ unitAmount: '276.0000', reconfirmedAt: null })
    }
    const pending = setup({ status: 'pending_activation' })
    await pending.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'n' }, ACTOR, SCOPE)
    expect(pending.cost.unitAmount).toBe('270')
  })

  it('404s the toggle off (before anything is read), an unknown order and a cost line of another order', async () => {
    const off = setup({ enabled: false })
    await expect(off.service.reconfirm(ORDER, COST, { note: 'n' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    expect(off.em.fork).not.toHaveBeenCalled()
    const other = setup()
    await expect(other.service.reconfirm(ORDER, 'olc-other', { note: 'n' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
    const none = setup()
    none.reader.findOne.mockResolvedValue(null)
    await expect(none.service.reconfirm('nope', COST, { note: 'n' }, ACTOR, SCOPE)).rejects.toMatchObject({ status: 404 })
  })

  it('every read is tenant scoped and excludes soft-deleted rows', async () => {
    const h = setup()
    await h.service.reconfirm(ORDER, COST, { note: 'n' }, ACTOR, SCOPE)
    for (const [, where] of [...h.tx.findOne.mock.calls, ...h.reader.findOne.mock.calls] as Array<[unknown, Row]>) {
      expect(where).toMatchObject({ organizationId: 'org', tenantId: 'tenant' })
      expect(where.deletedAt).toBeNull()
    }
  })
})

describe('reconfirm: lock order and the race with activation (spec Q2, step 3/4 note)', () => {
  it('inside ONE transaction the source quote is locked FIRST, then the order row is read WITHOUT a lock, then the cost; the flush is last', async () => {
    const h = setup()
    await h.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'n' }, ACTOR, SCOPE)
    expect(h.trace).toEqual(['pre-read-order', 'tx:begin', 'tx:lock-quote', 'tx:read-order', 'tx:read-cost', 'tx:flush', 'tx:commit'])
    expect(h.trace).not.toContain('tx:LOCK-ORDER')
    const quoteCall = h.tx.findOne.mock.calls.find(([entity]: unknown[]) => entity === CpqQuoteConfiguration)
    expect(quoteCall[2]).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
    const orderCall = h.tx.findOne.mock.calls.find(([entity]: unknown[]) => entity === CpqOrderConfiguration)
    expect(orderCall[2]).toEqual({ refresh: true })
    expect(h.tx.transactional).toHaveBeenCalledTimes(1)
    // the transaction runs on its own fork, not on the request EM
    expect(h.em.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
  })

  it('a re-confirmation refused with 409 has taken the quote lock but never locked the order row', async () => {
    const h = setup({ status: 'active' })
    await expect(h.service.reconfirm(ORDER, COST, { note: 'n' }, ACTOR, SCOPE)).rejects.toMatchObject({ message: 'ORDER_ACTIVATED' })
    expect(h.trace).toEqual(['pre-read-order', 'tx:begin', 'tx:lock-quote', 'tx:read-order'])
  })

  it('race: activation holds the quote lock (order locked first, as activateOrder does); the re-confirmation waits on the quote lock, then sees the committed status and gets 409 ORDER_ACTIVATED with no write', async () => {
    const h = setup()
    // The quote lock is held by "activation" until it commits: it flips the order to active, then releases.
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const lockQuote = h.tx.findOne.getMockImplementation()!
    h.tx.findOne.mockImplementation(async (entity: unknown, where: Row, options?: Row) => {
      if (entity === CpqQuoteConfiguration && options?.lockMode) await held
      return lockQuote(entity, where, options)
    })
    const pending = h.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'n' }, ACTOR, SCOPE)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.tx.flush).not.toHaveBeenCalled()
    expect(h.trace).not.toContain('tx:read-order')
    h.order.cpqStatus = 'active' // activation commits first
    release()
    await expect(pending).rejects.toMatchObject({ status: 409, message: 'ORDER_ACTIVATED' })
    expect(h.tx.flush).not.toHaveBeenCalled()
    expect(h.cost).toMatchObject({ unitAmount: '276.0000', reconfirmedAt: null })
  })

  it('race: when the re-confirmation commits first, the activation that follows reads the re-confirmed value (seed with the order line cost id) and writes it with last_order_line_cost_id', async () => {
    const h = setup({ cost: costRow({ origin: 'carried', costModel: 'flat' }) })
    await h.service.reconfirm(ORDER, COST, { unitAmount: 270, note: 'n' }, ACTOR, SCOPE)
    // activation (after the quote lock was released) reads the committed order line cost and seeds the item cost from it
    const seed = costSeedFromOrderLineCost(h.cost as never)
    expect(seed).toMatchObject({ orderLineCostId: COST, unitAmount: '270', instanceAmount: '270', totalAmount: '540', valueOrigin: 'manual' })
    const created: Row[] = []
    const em: Row = { find: jest.fn(async () => []), create: jest.fn((_entity: unknown, data: Row) => { const row = { ...data }; created.push(row); return row }), persist: jest.fn() }
    const result = await createItemCosts(em as never, [{ subscriptionId: 'sub-1', subscriptionItemId: 'item-1', seeds: [seed] }], { scope: SCOPE, startedAt: '2026-11-15' })
    expect(created[0]).toMatchObject({ unitAmount: '270', totalAmount: '540', lastOrderLineCostId: COST, costKey: 'tail' })
    expect(result.links).toEqual([{ orderLineCostId: COST, inventoryCostId: created[0].id }])
    // the cost_changed cause (amend / renew / activation) is activation's own; this service emits nothing
    expect(Object.keys(h.em)).not.toContain('emit')
  })

  it('refuses to start inside an existing transaction', async () => {
    const h = setup()
    h.em.isInTransaction.mockReturnValue(true)
    await expect(h.service.reconfirm(ORDER, COST, { note: 'n' }, ACTOR, SCOPE)).rejects.toThrow(/existing transaction/)
  })
})
