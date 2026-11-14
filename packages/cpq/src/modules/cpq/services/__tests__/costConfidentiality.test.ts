/**
 * Confidentiality sweep (App Spec Q7 / I-4, feature spec Q7). Sentinel cost, supplier, note and markup values are
 * planted in cost lines, markup overrides and charge markup; they must NEVER surface in a response for a user without
 * `cpq.costs.view`, in a broadcast event, in a command log, or in a `ce.ts` registration. Each surface also has a
 * positive control (the sentinel IS visible where it is meant to be) so a dead fixture cannot pass silently.
 */
import {
  CpqInventoryAsset, CpqInventoryCost, CpqInventorySubscription, CpqInventorySubscriptionItem, CpqOrderLineConfiguration,
  CpqOrderConfiguration, CpqOrderLineCost, CpqPriceRule, CpqProductCharge, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost, CpqQuoteMarkupOverride,
} from '../../data/entities'
import { DefaultCpqPricingService } from '../cpqPricingService'
import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { DefaultCpqOrderService } from '../cpqOrderService'
import { CpqQuoteCostService } from '../costs/quoteCostService'
import { redactedCostView, fullCostView } from '../costs/quoteCostView'
import { withoutChargeMarkup, chargeMarkupFields } from '../../lib/chargeView'
import { emitQuoteWriteEvents } from '../priceAdjustments/quotePricingEvents'
import { eventsConfig } from '../../events'
import ceEntities from '../../ce'
import { createQuoteLineCostCommand, updateQuoteLineCostCommand, deleteQuoteLineCostCommand } from '../../commands/quote-line-costs'
import { stripSnapshotCosts } from '../costs/inventoryCostSnapshot'
import { DefaultCpqInventoryService } from '../cpqInventoryService'
import { ACTIVATION_SCOPE, createActivationHarness } from './_helpers/activationHarness'
import { setMarkupOverrideCommand, clearMarkupOverrideCommand } from '../../commands/markup-overrides'

const mockCanView = jest.fn()
jest.mock('../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: async (em: any, quoteId: string, _scope: unknown, execute: any, makeError: any) => {
    const quote = em.__quote
    if (!quote || quote.id !== quoteId) throw makeError(404, 'Quote not found')
    quote.pricingRevision = (quote.pricingRevision ?? 0) + 1
    return execute(em, quote)
  },
}))
jest.mock('../../api/_helpers/costAccess', () => ({ canViewCosts: (...args: unknown[]) => mockCanView(...args) }))
jest.mock('../../api/_helpers/quoteMutationGuard', () => ({
  runCpqMutationGuards: jest.fn(async () => ({ ok: true, runAfterSuccess: async () => undefined })),
}))
jest.mock('../../api/context', () => ({ resolveCpqRouteContext: jest.fn() }))

const SCOPE = { organizationId: 'org', tenantId: 'tenant' }
const COST = '7777.7700'
const SUPPLIER = 'ZXQ-Sentinel-Supplier'
const NOTE = 'ZXQ-sentinel-note'
const MARKUP = '41.3737'
const OVERRIDE_MARKUP = '63.6363'
const SENTINELS = ['7777.77', SUPPLIER, NOTE, MARKUP, OVERRIDE_MARKUP]
type Row = Record<string, any>

const leaked = (value: unknown) => { const json = JSON.stringify(value) ?? ''; return SENTINELS.filter((s) => json.includes(s)) }
const expectClean = (value: unknown) => expect(leaked(value)).toEqual([])

const ids = { quote: '11111111-1111-4111-8111-111111111111', line: '22222222-2222-4222-8222-222222222222', cost: '33333333-3333-4333-8333-333333333333' }
const costRow = (over: Row = {}): Row => ({
  id: ids.cost, ...SCOPE, quoteConfigurationId: ids.quote, quoteLineId: ids.line, costKey: 'tail', chargeCode: 'tail', origin: 'catalog',
  costElementId: 'el', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat', valueStatus: 'confirmed',
  valueOrigin: 'catalog', unitAmount: COST, instanceAmount: COST, currencyCode: 'USD', supplierId: null, supplierName: SUPPLIER,
  supplierQuoteRef: null, validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: NOTE, errorCode: null, deletedAt: null, ...over,
})
const overrideRow = (): Row => ({ id: 'ov-1', ...SCOPE, quoteConfigurationId: ids.quote, quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: OVERRIDE_MARKUP, note: NOTE, deletedAt: null })
const costPlusCharge = (): Row => ({
  id: 'ch', ...SCOPE, offeringId: 'off', code: 'tail', name: 'Tail', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'cost_plus',
  markupRule: 'markup_percent', markupValue: MARKUP, fixedPrice: null, isActive: true, deletedAt: null, sortOrder: 0, applicabilityCondition: null,
  quantityAttributeCode: null, currencyCode: null,
})

function pricingService(charges: Row[]) {
  const em = {
    find: jest.fn(async (entity: unknown) => (entity === CpqProductCharge ? charges : entity === CpqPriceRule ? [] : [])),
    findOne: jest.fn(async () => null),
  }
  return new DefaultCpqPricingService(em as never)
}
const costPlusContext = () => ({
  enabled: true, errors: [] as never[],
  costs: [{ chargeCode: 'tail', costKey: 'tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', instanceAmount: COST, errorCode: null }] as never[],
  overrides: new Map([['tail', { markupRule: 'markup_percent', markupValue: OVERRIDE_MARKUP }]]),
})

describe('pricing output (quote lines, orders, calculate-price)', () => {
  it('a cost-plus charge is priced from the sentinel cost without carrying cost or markup', async () => {
    const charges = await pricingService([costPlusCharge()]).resolveProductCharges({
      offeringId: 'off', configuration: {}, currencyCode: 'USD', ...SCOPE, costPlus: costPlusContext() as never,
    })
    expect(charges[0].totalPrice).toBeGreaterThan(0) // positive control: the cost really flowed into the price
    expect(charges[0].totalPrice).not.toBe(7777.77)
    expectClean(charges)
  })

  it('a quote recalculation result (quote and line) stays clean with sentinel cost lines on a locked quote', async () => {
    const stored = [costRow()], overrides = [overrideRow()]
    const line = { id: 'lc', ...SCOPE, quoteConfigurationId: ids.quote, quoteLineId: ids.line, offeringId: 'off', productId: null, configuration: {}, quantity: 1, usageEstimates: null, charges: [], termMonths: 12, deletedAt: null }
    const em: Row = {
      find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [line] : entity === CpqQuoteLineCost ? stored : entity === CpqQuoteMarkupOverride ? overrides : [])),
      findOne: jest.fn(async () => ({})), count: jest.fn().mockResolvedValue(0),
      assign: jest.fn((entity: Row, updates: Row) => Object.assign(entity, updates)), persist: jest.fn(), create: jest.fn((_e: unknown, d: Row) => d), flush: jest.fn(),
    }
    const pricing = pricingService([costPlusCharge()])
    const quoting = new DefaultCpqQuotingService({
      em: em as never,
      cpqPricingService: { resolveProductCharges: (params: never) => pricing.resolveProductCharges(params) } as never,
      cpqValidationService: { validateOfferingConfiguration: async () => ({ valid: true, errors: [] }), validateRelationships: async () => [] } as never,
      cpqProductService: {} as never, salesDocumentNumberGenerator: {} as never, cpqCostService: { enabled: async () => true },
    })
    const quote = { id: ids.quote, quoteId: 'sales', cpqStatus: 'with_customer', quoteType: 'new', currencyCode: 'USD', quoteContext: {} } as unknown as CpqQuoteConfiguration
    const result = await quoting.recalculateLockedQuote(em as never, quote, SCOPE, false)
    expect(JSON.stringify(result)).toContain('cost_plus') // positive control: the cost-plus line was priced and returned
    expectClean(result)
  })

  it('conversion output (returned order and every created record) stays clean with sentinel cost lines', async () => {
    const em: Row = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(async (entity: unknown, where: Row) => {
        if (entity === CpqQuoteLineConfiguration && where.quoteConfigurationId) return [{ quoteLineId: ids.line, quantity: 1, action: 'add', nrcTotal: '0', mrcTotal: '100', configuration: {}, offeringId: null, charges: [{ chargeCode: 'tail', totalPrice: 100 }] }]
        if (entity === CpqQuoteLineCost) return [costRow(), costRow({ costKey: 'm', role: 'margin_only', valueStatus: 'estimated' })].filter((row) => row.role === where.role || !where.role)
        return []
      }),
      count: jest.fn().mockResolvedValue(0), create: jest.fn((_e: unknown, d: Row) => ({ createdAt: new Date(), ...d })), persist: jest.fn(), flush: jest.fn(),
      __quote: { id: ids.quote, quoteId: 'sales', cpqStatus: 'accepted', currencyCode: 'USD', customerId: 'cust', pricingSummary: { nrcTotal: 0, mrcTotal: 100 } },
    }
    const service = new DefaultCpqOrderService({
      em: em as never, cpqInventoryService: {} as never, salesDocumentNumberGenerator: { generate: async () => ({ number: 'ORD-1' }) } as never,
    })
    const result = await service.convertQuoteToOrder(ids.quote, SCOPE)
    expect(em.create).toHaveBeenCalled()
    expectClean(result)
    // MODIFIED by step 4: conversion now stores the quote's costs as order line costs (the sensitive, cost-guarded
    // records, so they DO hold the sentinels). Every other created record (order, order lines) stays clean.
    const created = em.create.mock.calls as Array<[{ name: string }, Row]>
    const costRecords = created.filter(([entity]) => entity === CpqOrderLineCost)
    expect(costRecords).toHaveLength(2)
    expect(leaked(costRecords.map(([, values]) => values))).toEqual(expect.arrayContaining(['7777.77']))
    expectClean(created.filter(([entity]) => entity !== CpqOrderLineCost))
  })

  it('the calculate-price route returns no cost, supplier or markup for a cost-plus charge', async () => {
    const { resolveCpqRouteContext } = jest.requireMock('../../api/context') as { resolveCpqRouteContext: jest.Mock }
    const pricing = pricingService([{ ...costPlusCharge(), fixedPrice: '10' }])
    const priceEm: Row = { findOne: async () => null, find: async () => [] }
    priceEm.fork = () => priceEm
    resolveCpqRouteContext.mockResolvedValue({ auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', em: priceEm, container: { resolve: (name: string) => (name === 'cpqCostService' ? { enabled: async () => true } : pricing) } })
    const { POST } = await import('../../api/quotes/price/route')
    const response = await POST(new Request('http://localhost/api/cpq/quotes/price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryItem: { offeringId: ids.quote, configuration: {} }, childItems: [], currencyCode: 'USD', includeWaterfall: true }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.primaryCharges).toHaveLength(1) // positive control: the charge is in the response
    expectClean(body)
  })
})

describe('catalog surfaces (offering, charge)', () => {
  it('strips markup without cpq.costs.view and keeps it with it', () => {
    const charge = { code: 'tail', pricingMethod: 'cost_plus', markupRule: 'markup_percent', markupValue: MARKUP }
    expectClean(withoutChargeMarkup(charge))
    expectClean(chargeMarkupFields(charge, false))
    expect(leaked(chargeMarkupFields(charge, true))).toEqual([MARKUP])
  })
})

describe('quote cost API', () => {
  function costService(costs: Row[], overrides: Row[]) {
    const quote = { id: ids.quote, quoteId: ids.quote, cpqStatus: 'ready', quoteType: 'new', currencyCode: 'USD', pricingRevision: 1 }
    const line = { quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, quantity: '1', charges: [], termMonths: 12, parentLineId: null, configuration: {}, offeringId: 'off', deletedAt: null }
    const em: Row = {
      __quote: quote, fork: jest.fn(() => em),
      findOne: jest.fn(async (entity: unknown, where: Row) => entity === CpqQuoteConfiguration ? quote : entity === CpqQuoteLineConfiguration ? line
        : entity === CpqProductCharge ? { code: 'tail', pricingMethod: 'cost_plus', chargeType: 'mrc', offeringId: 'off' } : entity === CpqQuoteLineCost ? costs.find((c) => c.id === where.id) ?? null
          : entity === CpqQuoteMarkupOverride ? overrides[0] ?? null : null),
      find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [line] : entity === CpqQuoteLineCost ? costs : entity === CpqQuoteMarkupOverride ? overrides : [])),
      count: jest.fn(async () => 0), create: jest.fn((_e: unknown, d: Row) => ({ createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...d })),
      persist: jest.fn((row: Row) => { if (row.costKey !== undefined) costs.push(row); else overrides.push(row) }), flush: jest.fn(),
    }
    const service = new CpqQuoteCostService({ em: em as never, costService: { enabled: async () => true }, quotingService: { recalculateLockedQuote: async () => ({}) } as never })
    return { service, costs, overrides }
  }

  it('the read projection without cpq.costs.view is status-only; with it the sentinels are visible (control)', async () => {
    const { service } = costService([costRow()], [overrideRow()])
    const redacted = await service.read(ids.quote, SCOPE, false)
    expect(redacted.lines[0].costs).toHaveLength(1)
    expectClean(redacted)
    expect(leaked(await service.read(ids.quote, SCOPE, true)).sort()).toEqual([COST.slice(0, 7), SUPPLIER, NOTE, OVERRIDE_MARKUP].sort())
    expectClean(redactedCostView(costRow() as never))
    expect(leaked(fullCostView(costRow() as never))).toContain(SUPPLIER)
  })

  it('cost write routes redact the response for a user without cpq.costs.view', async () => {
    const { costCommandRoute } = await import('../../api/_helpers/costCommandRoute')
    const fullResult = { cost: fullCostView(costRow() as never), override: null, margin: { contractMargin: 7777.77, marginHash: 'h' }, pricingRevision: 2, audit: {} }
    const ctx = { tenantId: 'tenant', organizationId: 'org', auth: { sub: 'user' }, organizationScope: null,
      container: { resolve: (name: string) => name === 'cpqCostService' ? { enabled: async () => true } : { execute: async () => ({ result: fullResult }) } } }
    const options = { quoteId: ids.quote, commandId: 'x', resourceKind: 'k', operation: 'create' as const, body: {}, schema: { parse: (v: unknown) => v } as never, ownedKeys: [], buildInput: () => ({}), status: 201 }
    mockCanView.mockResolvedValue(false)
    const redacted = await (await costCommandRoute(new Request('http://localhost/x', { method: 'POST' }), ctx as never, options)).json()
    expect(redacted.cost.costKey).toBe('tail')
    expectClean(redacted)
    expect(redacted).not.toHaveProperty('margin')
    mockCanView.mockResolvedValue(true)
    expect(leaked(await (await costCommandRoute(new Request('http://localhost/x', { method: 'POST' }), ctx as never, options)).json())).toContain(SUPPLIER)
  })
})

describe('command logs and audit snapshots', () => {
  it('cost and markup command logs carry no sentinel, whatever the input held', async () => {
    const { service, costs } = (() => {
      const quote = { id: ids.quote, quoteId: ids.quote, cpqStatus: 'ready', quoteType: 'new', currencyCode: 'USD', pricingRevision: 1 }
      const line = { quoteLineId: ids.line, ...SCOPE, quoteConfigurationId: ids.quote, quantity: '1', charges: [], termMonths: 12, parentLineId: null, configuration: {}, offeringId: 'off', deletedAt: null }
      const costs: Row[] = [costRow({ origin: 'manual', costKey: 'manual:abcd1234', costElementId: null, valueOrigin: 'manual' })], overrides: Row[] = []
      const em: Row = {
        __quote: quote, fork: jest.fn(() => em),
        findOne: jest.fn(async (entity: unknown, where: Row) => entity === CpqQuoteLineConfiguration ? line : entity === CpqProductCharge ? { code: 'tail', pricingMethod: 'cost_plus', chargeType: 'mrc', offeringId: 'off' }
          : entity === CpqQuoteLineCost ? costs.find((c) => c.id === where.id && !c.deletedAt) ?? null : entity === CpqQuoteMarkupOverride ? overrides.find((o) => !o.deletedAt) ?? null : null),
        find: jest.fn(async (entity: unknown) => (entity === CpqQuoteLineConfiguration ? [line] : entity === CpqQuoteLineCost ? costs : entity === CpqQuoteMarkupOverride ? overrides : [])),
        count: jest.fn(async () => 0), create: jest.fn((_e: unknown, d: Row) => ({ id: 'ov-1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...d })),
        persist: jest.fn((row: Row) => { if (row.costKey !== undefined) costs.push(row); else overrides.push(row) }), flush: jest.fn(),
      }
      return { costs, service: new CpqQuoteCostService({ em: em as never, costService: { enabled: async () => true }, quotingService: { recalculateLockedQuote: async () => ({}) } as never }) }
    })()
    const actor = '44444444-4444-4444-8444-444444444444'
    const created = await service.createCost(ids.quote, {
      quoteLineId: ids.line, chargeCode: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat',
      unitAmount: 7777.77, currencyCode: 'USD', supplierName: SUPPLIER, note: NOTE,
    } as never, actor, SCOPE)
    const updated = await service.updateCost(ids.quote, costs[0].id, { note: NOTE, supplierName: SUPPLIER } as never, actor, SCOPE)
    const deleted = await service.deleteCost(ids.quote, costs[0].id, actor, SCOPE)
    const set = await service.setMarkupOverride(ids.quote, { quoteLineId: ids.line, chargeCode: 'tail', markupRule: 'markup_percent', markupValue: Number(OVERRIDE_MARKUP), note: NOTE } as never, actor, SCOPE)
    const cleared = await service.clearMarkupOverride(ids.quote, ids.line, 'tail', actor, SCOPE)
    const ctx = {} as never
    const logs = await Promise.all([
      createQuoteLineCostCommand.buildLog!({ input: {}, result: created, ctx, snapshots: {} } as never),
      updateQuoteLineCostCommand.buildLog!({ input: {}, result: updated, ctx, snapshots: {} } as never),
      deleteQuoteLineCostCommand.buildLog!({ input: {}, result: deleted, ctx, snapshots: {} } as never),
      setMarkupOverrideCommand.buildLog!({ input: {}, result: set, ctx, snapshots: {} } as never),
      clearMarkupOverrideCommand.buildLog!({ input: {}, result: cleared, ctx, snapshots: {} } as never),
    ])
    expect(logs.every((log) => (log as { replayable: boolean }).replayable === false)).toBe(true)
    expect(leaked(created.cost)).toContain(SUPPLIER) // control: the write itself did see the sentinel
    expectClean(logs)
    for (const command of [createQuoteLineCostCommand, updateQuoteLineCostCommand, deleteQuoteLineCostCommand, setMarkupOverrideCommand, clearMarkupOverrideCommand]) {
      expect(command.isUndoable).toBe(false)
    }
  })
})

describe('events', () => {
  const declared = (eventsConfig as unknown as { events: Array<{ id: string; clientBroadcast?: boolean; payloadSchema?: { fields: Array<{ path: string }> } }> }).events

  it('no broadcast event declares a cost, markup, margin or supplier field; margin_changed is not broadcast', () => {
    for (const event of declared.filter((e) => e.clientBroadcast)) {
      // The two booleans on status_changed are the only sanctioned cost-related fields: flags, never values.
      for (const field of (event.payloadSchema?.fields ?? []).filter((f) => !['hasPendingCosts', 'hasEstimatedCosts'].includes(f.path))) expect(field.path).not.toMatch(/cost|markup|margin|supplier/i)
    }
    expect(declared.find((e) => e.id === 'cpq.quote.margin_changed')?.clientBroadcast).toBe(false)
  })

  it('cost_changed is not broadcast and declares no amount field (ids and keys only)', () => {
    const event = declared.find((e) => e.id === 'cpq.subscription.cost_changed')
    expect(event?.clientBroadcast).toBe(false)
    for (const field of event?.payloadSchema?.fields ?? []) expect(field.path).not.toMatch(/amount|price|total|margin|markup|fx/i)
  })

  it('declares previousMarginHash as optional (null when a write creates the first cost lines)', () => {
    const fields = (declared.find((e) => e.id === 'cpq.quote.margin_changed')?.payloadSchema?.fields ?? []) as Array<{ path: string; optional?: boolean }>
    expect(fields.find((f) => f.path === 'previousMarginHash')).toMatchObject({ optional: true })
    expect(fields.find((f) => f.path === 'marginHash')?.optional).toBeUndefined()
  })

  it('broadcast payloads emitted for a quote with sentinel costs carry no sentinel; margin_changed has quote-level keys only', async () => {
    const emitted: Array<[string, Record<string, unknown>]> = []
    const quote = { id: 'q', quoteId: 's', tenantId: 'tenant', organizationId: 'org', cpqStatus: 'in_approval', currencyCode: 'USD', pricingRevision: 3,
      pricingSummary: { snapshotHash: 'b', dealValue: { list: 1, standard: 1, offer: 1 }, discountDepth: {}, hasTimeBasedAdjustments: false } }
    await emitQuoteWriteEvents({ snapshotHash: 'a', cpqStatus: 'ready' }, quote as never, { pricingCause: 'cost', statusCause: 'manual' }, async (id, payload) => { emitted.push([id, payload]) }, {
      previousMarginHash: 'm0', marginHash: 'm1', approvalInvalidated: true, contractMargin: 12.5, marginPercent: 5, costCoverage: 100,
      hasPendingCosts: false, hasEstimatedCosts: true, hasExpiredCosts: false, priceBasis: { hasPendingCosts: false, hasEstimatedCosts: true },
    })
    expect(emitted.map(([id]) => id)).toEqual(['cpq.quote.pricing_changed', 'cpq.quote.status_changed', 'cpq.quote.margin_changed'])
    for (const [id, payload] of emitted) {
      if (declared.find((e) => e.id === id)?.clientBroadcast) expectClean(payload)
    }
    expect(Object.keys(emitted[2][1]).sort()).toEqual([
      'approvalInvalidated', 'cause', 'contractMargin', 'cpqStatus', 'costCoverage', 'currencyCode', 'hasEstimatedCosts', 'hasExpiredCosts',
      'hasPendingCosts', 'marginHash', 'marginPercent', 'occurredAt', 'organizationId', 'previousMarginHash', 'pricingRevision', 'quoteId', 'tenantId',
    ].sort())
  })
})

describe('ce.ts registrations (App Spec Q7)', () => {
  it('registers no cost entity and no field on any entity, so nothing cost-bearing reaches custom-entity or index surfaces', () => {
    const specs = (ceEntities as unknown as { entities?: unknown } | unknown[])
    const list = (Array.isArray(specs) ? specs : (specs as { entities: Array<{ id: string; fields: unknown[] }> }).entities) as Array<{ id: string; fields: unknown[] }>
    expect(list.length).toBeGreaterThan(0)
    for (const spec of list) {
      expect(spec.id).not.toMatch(/cost|markup/i)
      expect(spec.fields).toEqual([])
    }
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining(['cpq:cpq_product_charge', 'cpq:cpq_pricing_table', 'cpq:cpq_pricing_table_entry']))
  })
})

/**
 * Feature 2 extension (feature spec §Risks): the order and inventory surfaces. Order line costs and inventory costs
 * carrying the sentinel are made reachable from EVERY query of a poisoned EM, so a surface that wrongly loaded them
 * would leak them. For a caller without `cpq.costs.view`, cost routes return only ids, cost keys, names, roles, types
 * and statuses: no sentinel, no supplier name, and none of the keys below. Each surface has a positive control.
 */
const FORBIDDEN_KEYS = /"(unitAmount|instanceAmount|totalAmount|fxRate|fxRateDate|supplier\w*|margin\w*|mrcCost|nrcCost)"/
const expectNoCostKeys = (value: unknown) => expect(JSON.stringify(value) ?? '').not.toMatch(FORBIDDEN_KEYS)
/** Cost routes without the feature also drop the currency (it is part of the value fields). */
const expectStatusOnly = (value: unknown) => { expectNoCostKeys(value); expect(JSON.stringify(value) ?? '').not.toContain('currencyCode') }

const feat = {
  sub: '55555555-5555-4555-8555-555555555555', item: '66666666-6666-4666-8666-666666666666', asset: '77777777-7777-4777-8777-777777777777',
  order: '88888888-8888-4888-8888-888888888888', orderLine: '99999999-9999-4999-8999-999999999999',
}
const inventoryCostRow = (over: Row = {}): Row => ({
  id: 'ic-1', ...SCOPE, subscriptionId: feat.sub, subscriptionItemId: feat.item, assetId: null, status: 'active', startedAt: '2026-11-01', endedAt: null, lastChangeId: 'log-1',
  costKey: 'tail', chargeCode: 'tail', origin: 'catalog', name: 'Tail', role: 'price_basis', costType: 'mrc', source: 'fixed', costModel: 'flat', valueStatus: 'confirmed',
  valueOrigin: 'catalog', unitAmount: COST, instanceAmount: COST, totalAmount: COST, currencyCode: 'USD', fxRate: '1.0000', supplierId: null, supplierName: SUPPLIER,
  supplierQuoteRef: null, validUntil: null, supplierTermEnd: null, supplierMinTermMonths: null, note: NOTE, deletedAt: null, ...over,
})
const orderLineCostRow = (): Row => ({ ...costRow(), orderConfigurationId: feat.order, orderLineId: feat.orderLine, sourceQuoteLineCostId: ids.cost, inventoryCostId: 'ic-1', totalAmount: COST })
const subscriptionRow: Row = { id: feat.sub, ...SCOPE, currencyCode: 'USD', status: 'active', code: 'S', name: 'S', customerId: 'cust', deletedAt: null }
const itemRow: Row = { id: feat.item, ...SCOPE, subscriptionId: feat.sub, status: 'active', name: 'Item', mrcAmount: '100', nrcAmount: '0', quantity: 1, sortOrder: 0, charges: [{ chargeCode: 'tail', chargeType: 'mrc', totalPrice: 100 }], configuration: {}, deletedAt: null, parentItemId: null }
const assetRow: Row = { id: feat.asset, ...SCOPE, subscriptionId: feat.sub, status: 'active', name: 'Box', code: 'A-1', purchasePrice: '500', currencyCode: 'USD', quantity: 1, sourceQuoteLineId: null, deletedAt: null }
const orderConfigRow: Row = { id: feat.order, ...SCOPE, orderId: 'so-1', cpqStatus: 'active', customerId: 'cust', currencyCode: 'USD', pricingSummary: { nrcTotal: 0, mrcTotal: 100 }, sourceQuoteId: ids.quote, createdAt: new Date(), deletedAt: null }
const orderLineRow: Row = { orderLineId: feat.orderLine, ...SCOPE, orderConfigurationId: feat.order, action: 'add', quantity: 1, parentLineId: null, termMonths: 12, configuration: {}, charges: [{ chargeCode: 'tail', chargeType: 'mrc', totalPrice: 100 }], nrcTotal: '0', mrcTotal: '100', deletedAt: null }

/** Every cost-bearing entity is reachable from any query, whatever its filters. */
function poisonedEm(): Row {
  const rows = (entity: unknown): Row[] => entity === CpqOrderLineCost ? [orderLineCostRow()]
    : entity === CpqInventoryCost ? [inventoryCostRow(), inventoryCostRow({ id: 'ic-2', subscriptionItemId: null, assetId: feat.asset, costKey: 'box', costType: 'nrc' })]
      : entity === CpqOrderLineConfiguration ? [orderLineRow] : entity === CpqInventorySubscriptionItem ? [itemRow] : entity === CpqInventoryAsset ? [assetRow] : []
  const em: Row = {
    findOne: jest.fn(async (entity: unknown) => entity === CpqOrderConfiguration ? orderConfigRow : entity === CpqInventorySubscription ? subscriptionRow : entity === CpqInventoryAsset ? assetRow
      : entity?.constructor?.name === 'SalesOrder' || (entity as { name?: string })?.name === 'SalesOrder' ? { id: 'so-1', orderNumber: 'ORD-1', status: 'draft', placedAt: null } : null),
    find: jest.fn(async (entity: unknown, where: Row = {}) => rows(entity).filter((row) => (where.assetId === undefined || row.assetId === where.assetId))),
    findAndCount: jest.fn(async (entity: unknown) => [entity === CpqOrderConfiguration ? [orderConfigRow] : [], 1]),
    count: jest.fn(async () => 0),
  }
  em.fork = () => em
  return em
}
const routeCtx = (em: Row, viewer: boolean, extra: Row = {}) => {
  mockCanView.mockResolvedValue(viewer)
  return { auth: { sub: 'user' }, tenantId: 'tenant', organizationId: 'org', organizationScope: null, em,
    container: { resolve: (name: string) => ({ cpqCostService: { enabled: async () => true }, cpqOrderService: new DefaultCpqOrderService({ em: em as never, cpqInventoryService: {} as never, salesDocumentNumberGenerator: {} as never }),
      cpqInventoryService: new DefaultCpqInventoryService(em as never), ...extra } as Record<string, unknown>)[name] } }
}
const useCtx = (ctx: Row) => (jest.requireMock('../../api/context') as { resolveCpqRouteContext: jest.Mock }).resolveCpqRouteContext.mockResolvedValue(ctx)
const get = (url = 'http://localhost/x') => new Request(url)

describe('order surfaces (feature 2)', () => {
  it('order costs route: status-only without cpq.costs.view; the sentinels are visible with it (control)', async () => {
    const { GET } = await import('../../api/orders/[orderId]/costs/route')
    const params = { params: Promise.resolve({ orderId: feat.order }) }
    useCtx(routeCtx(poisonedEm(), false))
    const redacted = await (await GET(get(), params)).json()
    expect(redacted.lines[0].costs).toEqual([{ id: ids.cost, costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed' }])
    expectClean(redacted)
    expectStatusOnly(redacted)
    useCtx(routeCtx(poisonedEm(), true))
    const full = await (await GET(get(), params)).json()
    expect(leaked(full)).toEqual(expect.arrayContaining(['7777.77', SUPPLIER]))
    expect(full.margin).toBeDefined()
  })

  it('order GET and the order list (data route of the order-cpq-tab widget) carry no cost data even for a cost holder', async () => {
    const { GET: ORDER } = await import('../../api/orders/[orderId]/route')
    const { GET: LIST } = await import('../../api/orders/route')
    for (const viewer of [false, true]) {
      useCtx(routeCtx(poisonedEm(), viewer))
      const order = await ORDER(get(), { params: Promise.resolve({ orderId: feat.order }) })
      expect(order.status).toBe(200)
      const body = await order.json()
      expect(body.lines).toHaveLength(1) // positive control: the order and its line were really built
      expectClean(body)
      expectNoCostKeys(body)
      const list = await LIST(get('http://localhost/api/cpq/orders?salesOrderId=so-1&pageSize=50'))
      expect(list.status).toBe(200)
      const listBody = await list.json()
      expect(JSON.stringify(listBody)).toContain(feat.order)
      expectClean(listBody)
      expectNoCostKeys(listBody)
    }
  })
})

describe('inventory surfaces (feature 2)', () => {
  it('subscription costs route: status-only without cpq.costs.view; full with it (control)', async () => {
    const { GET } = await import('../../api/inventory/subscriptions/[subscriptionId]/costs/route')
    const params = { params: Promise.resolve({ subscriptionId: feat.sub }) }
    useCtx(routeCtx(poisonedEm(), false))
    const redacted = await (await GET(get('http://localhost/x?includeEnded=true'), params)).json()
    expect(redacted.items[0].costs[0]).toEqual({ id: 'ic-1', costKey: 'tail', name: 'Tail', role: 'price_basis', costType: 'mrc', valueStatus: 'confirmed', status: 'active' })
    expect(redacted.assets).toHaveLength(1)
    expectClean(redacted)
    expectStatusOnly(redacted)
    useCtx(routeCtx(poisonedEm(), true))
    const full = await (await GET(get(), params)).json()
    expect(leaked(full)).toEqual(expect.arrayContaining(['7777.77', SUPPLIER]))
    expect(full.margin).toBeDefined()
  })

  it('asset costs route: status-only without cpq.costs.view; full with it (control)', async () => {
    const { GET } = await import('../../api/inventory/assets/[assetId]/costs/route')
    const params = { params: Promise.resolve({ assetId: feat.asset }) }
    useCtx(routeCtx(poisonedEm(), false))
    const redacted = await (await GET(get(), params)).json()
    expect(redacted.costs).toHaveLength(1)
    expectClean(redacted)
    expectStatusOnly(redacted)
    useCtx(routeCtx(poisonedEm(), true))
    expect(leaked(await (await GET(get(), params)).json())).toEqual(expect.arrayContaining(['7777.77', SUPPLIER]))
  })

  it('subscription, item and asset routes carry no cost data even for a cost holder', async () => {
    const { GET: SUBSCRIPTION } = await import('../../api/inventory/subscriptions/route')
    const { GET: ITEMS } = await import('../../api/inventory/subscription-items/route')
    const { GET: ASSETS } = await import('../../api/inventory/assets/route')
    for (const viewer of [false, true]) {
      useCtx(routeCtx(poisonedEm(), viewer))
      const subscription = await (await SUBSCRIPTION(get(`http://localhost/x?id=${feat.sub}`))).json()
      expect(subscription.items).toHaveLength(1) // control: the tree was built
      const items = await (await ITEMS(get(`http://localhost/x?subscriptionId=${feat.sub}`))).json()
      expect(items).toHaveLength(1)
      const asset = await (await ASSETS(get(`http://localhost/x?id=${feat.asset}`))).json()
      expect(asset.id).toBe(feat.asset)
      for (const body of [subscription, items, asset]) { expectClean(body); expectNoCostKeys(body); expect(JSON.stringify(body)).not.toContain('"costs"') }
    }
  })

  it('cost routes answer 404 with the toggle off, reading nothing', async () => {
    const { GET } = await import('../../api/inventory/subscriptions/[subscriptionId]/costs/route')
    const em = poisonedEm()
    useCtx(routeCtx(em, true, { cpqCostService: { enabled: async () => false } }))
    expect((await GET(get(), { params: Promise.resolve({ subscriptionId: feat.sub }) })).status).toBe(404)
    expect(em.find).not.toHaveBeenCalled()
  })
})

describe('change log (feature 2, Q7)', () => {
  const snapshot = () => ({
    id: feat.sub, items: [{ id: feat.item, costs: [inventoryCostRow()] }], assets: [{ id: feat.asset, costs: [inventoryCostRow({ id: 'ic-2' })] }],
  })
  const log = () => ({ id: 'log-1', changeType: 'amend', beforeSnapshot: snapshot(), afterSnapshot: snapshot() })

  it('the route strips every snapshot costs key without cpq.costs.view; the helper leaves no costs key anywhere', async () => {
    const { GET } = await import('../../api/inventory/subscriptions/[subscriptionId]/change-log/route')
    const listChangeLog = jest.fn(async () => ({ items: [log()], total: 1, page: 1, pageSize: 50, totalPages: 1 }))
    useCtx(routeCtx(poisonedEm(), false, { cpqInventoryService: { listChangeLog } }))
    const redacted = await (await GET(get(), { params: Promise.resolve({ subscriptionId: feat.sub }) })).json()
    expectClean(redacted)
    expectNoCostKeys(redacted)
    for (const owner of [...redacted.items[0].afterSnapshot.items, ...redacted.items[0].afterSnapshot.assets, ...redacted.items[0].beforeSnapshot.items]) expect(owner).not.toHaveProperty('costs')
    expect(JSON.stringify(stripSnapshotCosts(snapshot()))).not.toContain('"costs"')
    useCtx(routeCtx(poisonedEm(), true, { cpqInventoryService: { listChangeLog } }))
    expect(leaked(await (await GET(get(), { params: Promise.resolve({ subscriptionId: feat.sub }) })).json())).toEqual(expect.arrayContaining(['7777.77', SUPPLIER]))
  })
})

describe('subscription lifecycle events (feature 2)', () => {
  const lifecycle = ['activated', 'amended', 'renewed', 'merged', 'cancelled', 'superseded'].map((name) => `cpq.subscription.${name}`)

  it('all six lifecycle payloads and cost_changed carry no sentinel, supplier, amount or margin key, with sentinel costs in play', async () => {
    const eventsModule = jest.requireActual('../../events') as typeof import('../../events')
    const emitSpy = jest.spyOn(eventsModule, 'emitCpqEvent').mockResolvedValue(undefined as never)
    const sentinelCost = { ...orderLineCostRow(), orderLineId: 'ol-1' }
    const changes = [{ inventoryCostId: 'ic-1', subscriptionId: 'sub-1', ownerType: 'subscription_item', subscriptionItemId: 'item-1', assetId: null, costKey: 'tail', supplierId: 'sup-1', kind: 'created' }]
    const run = async (fixture: Parameters<typeof createActivationHarness>[0]) => {
      const h = createActivationHarness({ orderLineCosts: [sentinelCost], ...fixture })
      await h.service.activateOrder('oc-1', ACTIVATION_SCOPE)
    }
    const changeLog = { id: 'log-1', subscriptionId: 'sub-1', effectiveAt: new Date('2026-06-01T10:00:00.000Z'), afterSnapshot: { items: [] }, lineChanges: [] }
    const subscription = { id: 'sub-1', customerId: 'cust-1', currentTermStart: new Date('2027-01-01'), currentTermEnd: new Date('2028-01-01') }
    const target = { subscriptionId: 'sub-1', mergeAction: 'standalone', newTermStart: '2027-01-01', newTermEnd: '2028-01-01', newTermMonths: 12 }
    try {
      await run({ quoteType: 'new', orderLines: [{ orderLineId: 'ol-1', orderConfigurationId: 'oc-1', quantity: 1, configuration: { offeringName: 'H' }, charges: [], mrcTotal: '100', nrcTotal: '0' }], subscriptionItems: [{ id: 'item-1' }], inventory: { createSubscription: { id: 'sub-1' } }, createdCosts: { inventoryCostChanges: changes } })
      await run({ quoteType: 'amend', targets: [target], inventory: { applyAmendment: { changeLog, subscription } } })
      await run({ quoteType: 'renew', targets: [target], inventory: { applyRenewal: { changeLog, subscription } } })
      await run({ quoteType: 'cancel', targets: [target], inventory: { applyCancel: { changeLog, subscription } } })
      await run({
        quoteType: 'renew', quoteOver: { arcMergeNewTermStart: '2027-01-01', arcMergeNewTermEnd: '2028-01-01', arcMergeNewTermMonths: 12 },
        targets: [{ subscriptionId: 'sub-a', mergeAction: 'absorb' }, { subscriptionId: 'sub-b', mergeAction: 'absorb' }],
        inventory: { applyMergeRenewal: { mergedSubscription: { id: 'sub-m', currentTermStart: new Date('2027-01-01') }, mergeResultChangeLog: { id: 'log-m' }, sourceChangeLogs: [{ id: 'log-a', subscriptionId: 'sub-a' }, { id: 'log-b', subscriptionId: 'sub-b' }] } },
      })
      const emitted = emitSpy.mock.calls.map(([id, payload]) => ({ id: id as string, payload: payload as Record<string, unknown> }))
      expect([...new Set(emitted.map((e) => e.id))].sort()).toEqual([...lifecycle, 'cpq.subscription.cost_changed'].sort())
      for (const { id, payload } of emitted) {
        expectClean(payload)
        expect(JSON.stringify(payload)).not.toMatch(/amount|margin|supplierName|fxRate|"costs"/i)
        if (id === 'cpq.subscription.cost_changed') expect(Object.keys(payload).sort()).toEqual([
          'assetId', 'cause', 'changeLogId', 'costKey', 'effectiveDate', 'inventoryCostId', 'kind', 'organizationId', 'ownerType', 'sourceOrderId', 'subscriptionId', 'subscriptionItemId', 'supplierId', 'tenantId',
        ])
      }
    } finally { emitSpy.mockRestore() }
  })
})
