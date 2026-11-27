/**
 * Price phases (spec 2026-11-26 billing price phases, Phase 2): month ranges on
 * price rules (D9) and manual adjustments, campaign dates (D10), the charge
 * schedule, deal value and the C2 payload phases.
 */
import { DefaultCpqPricingService } from '../cpqPricingService'
import { resolveManualAdjustments, type AdjustmentPricingLine } from '../priceAdjustments/resolveManualAdjustments'
import { computeWaterfallSummary } from '../priceAdjustments/pricingSnapshot'
import { adjustmentsOverlap } from '../priceAdjustments/adjustmentService'
import type { PriceAdjustment } from '../../data/price-adjustments'
import type { ResolvedCharge } from '../types'
import {
  compactSchedule, isInsideCampaign, rangesOverlap, segmentsFor, storedRuleCodes, withoutSchedule,
} from '../../lib/priceSchedule'
import { mergeRecurringPhases } from '../../lib/payloadPhases'
import { buildRecurringPayloadCharges } from '../../lib/chargeBillingPeriod'
import { buildArcAddedItems } from '../cpqOrderService'

const SCOPE = { tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }

type RuleStub = {
  code: string; name: string; ruleType: string; value: number; chargeCodeFilter?: string | null; chargeTypeFilter?: string | null
  applicabilityCondition?: null; fromMonth?: number; toMonth?: number | null; validFrom?: string | null; validUntil?: string | null
}

function pricingWith(charges: Array<{ code: string; chargeType: 'mrc' | 'nrc'; fixedPrice: number }>, rules: RuleStub[]) {
  const em = { findOne: jest.fn(), find: jest.fn() }
  em.find.mockResolvedValueOnce(charges.map((charge) => ({
    code: charge.code, name: charge.code, description: null, chargeType: charge.chargeType, pricingMethod: 'fixed',
    pricingTableId: null, priceColumnKey: null, fixedPrice: String(charge.fixedPrice), currencyCode: 'USD',
    quantityAttributeCode: null, applicabilityCondition: null,
  })))
  em.find.mockResolvedValueOnce(rules.map((rule) => ({ chargeCodeFilter: null, chargeTypeFilter: null, applicabilityCondition: null, fromMonth: 1, toMonth: null, validFrom: null, validUntil: null, ...rule })))
  return new DefaultCpqPricingService(em as never)
}

const resolve = (service: DefaultCpqPricingService, extra: Record<string, unknown> = {}) =>
  service.resolveProductCharges({ offeringId: 'o', configuration: {}, currencyCode: 'USD', ...SCOPE, ...extra })

describe('priceSchedule helpers', () => {
  it('cuts segments at every range boundary, the last open', () => {
    expect(segmentsFor([{ fromMonth: 1, toMonth: 1 }, { fromMonth: 2, toMonth: 3 }])).toEqual([
      { fromMonth: 1, toMonth: 1 }, { fromMonth: 2, toMonth: 3 }, { fromMonth: 4, toMonth: null },
    ])
    expect(segmentsFor([{ fromMonth: 1, toMonth: null }])).toEqual([{ fromMonth: 1, toMonth: null }])
    expect(segmentsFor([{ fromMonth: 13, toMonth: null }])).toEqual([{ fromMonth: 1, toMonth: 12 }, { fromMonth: 13, toMonth: null }])
  })
  it('detects overlapping month ranges', () => {
    expect(rangesOverlap({ fromMonth: 1, toMonth: 3 }, { fromMonth: 4, toMonth: null })).toBe(false)
    expect(rangesOverlap({ fromMonth: 1, toMonth: 3 }, { fromMonth: 3, toMonth: 6 })).toBe(true)
    expect(rangesOverlap({}, { fromMonth: 7, toMonth: 9 })).toBe(true)
  })
  it('drops a schedule that prices every month the same', () => {
    const segment = { fromMonth: 1, toMonth: 3, unitPrice: 10, totalPrice: 10, standardUnitPrice: 10, standardTotalPrice: 10, source: 'list' as const, name: null }
    expect(compactSchedule([segment, { ...segment, fromMonth: 4, toMonth: null }])).toBeUndefined()
  })
  it('checks campaign dates inclusively', () => {
    expect(isInsideCampaign({ validFrom: '2026-11-01', validUntil: '2026-12-31' }, '2026-12-31')).toBe(true)
    expect(isInsideCampaign({ validFrom: '2026-11-01', validUntil: '2026-12-31' }, '2027-01-01')).toBe(false)
    expect(isInsideCampaign({ validFrom: null, validUntil: null }, '2030-01-01')).toBe(true)
  })
})

describe('price rules with a month range (D9)', () => {
  it('"first month free" makes the standard price a schedule; the regular price is unchanged', async () => {
    const service = pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }, { code: 'setup', chargeType: 'nrc', fixedPrice: 50 }],
      [{ code: 'TRIAL', name: 'Free trial', ruleType: 'price_override', value: 0, fromMonth: 1, toMonth: 1 }])
    const [net, setup] = await resolve(service)
    expect(net).toMatchObject({ unitPrice: 100, totalPrice: 100, standardTotalPrice: 100, adjustments: [] })
    expect(net.schedule).toEqual([
      expect.objectContaining({ fromMonth: 1, toMonth: 1, totalPrice: 0, standardTotalPrice: 0, source: 'rule', name: 'Free trial', ruleCodes: ['TRIAL'] }),
      expect.objectContaining({ fromMonth: 2, toMonth: null, totalPrice: 100, source: 'list', name: null }),
    ])
    // Phases price recurring charges only.
    expect(setup.schedule).toBeUndefined()
    expect(setup.totalPrice).toBe(50)
  })

  it('runs permanent and phased rules in sort order per segment', async () => {
    const service = pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [
      { code: 'BASE10', name: 'Base 10', ruleType: 'discount_percent', value: 10 },
      { code: 'PROMO50', name: 'Promo 50%', ruleType: 'discount_percent', value: 50, fromMonth: 1, toMonth: 3 },
    ])
    const [net] = await resolve(service)
    expect(net.totalPrice).toBe(90)
    expect(net.schedule?.map((segment) => [segment.fromMonth, segment.toMonth, segment.totalPrice, segment.source])).toEqual([
      [1, 3, 45, 'rule'], [4, null, 90, 'rule'],
    ])
    expect(net.schedule?.[0].ruleCodes).toEqual(['BASE10', 'PROMO50'])
  })

  it('skips a rule outside its campaign dates (D10)', async () => {
    const rule: RuleStub = { code: 'XMAS', name: 'Xmas', ruleType: 'discount_percent', value: 50, fromMonth: 1, toMonth: 3, validFrom: '2026-11-01', validUntil: '2026-12-31' }
    const inside = await resolve(pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [rule]), { pricingDate: '2026-12-15' })
    expect(inside[0].schedule?.[0]).toMatchObject({ totalPrice: 50, name: 'Xmas' })
    const after = await resolve(pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [rule]), { pricingDate: '2027-01-05' })
    expect(after[0].schedule).toBeUndefined()
    expect(after[0].totalPrice).toBe(100)
  })

  it('a quote priced before the campaign ended keeps it when re-saved after (D10)', async () => {
    const rule: RuleStub = { code: 'XMAS', name: 'Xmas', ruleType: 'discount_percent', value: 50, fromMonth: 1, toMonth: 3, validUntil: '2026-12-31' }
    const [first] = await resolve(pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [rule]), { pricingDate: '2026-12-20' })
    // The stored snapshot names the rule; re-pricing after the campaign keeps it.
    const retained = storedRuleCodes([first as unknown as Record<string, unknown>])
    expect([...retained]).toEqual(['XMAS'])
    const [resaved] = await resolve(pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [rule]), { pricingDate: '2027-02-01', retainRuleCodes: retained })
    expect(resaved.schedule).toEqual(first.schedule)
    // A new line (nothing stored) after the campaign does not get it.
    const [fresh] = await resolve(pricingWith([{ code: 'net', chargeType: 'mrc', fixedPrice: 100 }], [rule]), { pricingDate: '2027-02-01', retainRuleCodes: new Set() })
    expect(fresh.schedule).toBeUndefined()
  })
})

const mrc: ResolvedCharge = { chargeCode: 'net', chargeName: 'Internet', chargeType: 'mrc', pricingMethod: 'flat', unitPrice: 100, totalPrice: 100, quantity: 1, currencyCode: 'USD' }
const lineOf = (charges: ResolvedCharge[], extra: Partial<AdjustmentPricingLine> = {}): AdjustmentPricingLine =>
  ({ lineId: 'line', parentLineId: null, enginePriced: true, mirrored: false, termMonths: 24, charges, ...extra })
const phase = (values: Partial<PriceAdjustment>): PriceAdjustment => ({
  id: 'p1', quoteLineId: 'line', level: 'charge', chargeCode: 'net', adjustmentType: 'price_override', value: 0, currencyCode: 'USD',
  reasonCode: 'promotion', windowKind: 'relative', fromMonth: 1, toMonth: 1, ...values,
})

describe('manual phases (month ranges on recurring adjustments)', () => {
  it('prices a ramp per segment and keeps the regular price after the last phase', () => {
    const result = resolveManualAdjustments([lineOf([mrc])], [
      phase({ id: 'y1', value: 80, fromMonth: 1, toMonth: 12, phaseName: 'Year 1' }),
      phase({ id: 'y2', value: 90, fromMonth: 13, toMonth: 24, phaseName: 'Year 2' }),
    ], 'USD')
    expect(result.errors).toEqual([])
    const charge = result.lines[0].charges[0]
    expect(charge).toMatchObject({ unitPrice: 100, totalPrice: 100 })
    expect(charge.schedule?.map((segment) => [segment.fromMonth, segment.toMonth, segment.totalPrice, segment.source, segment.name])).toEqual([
      [1, 12, 80, 'manual', 'Year 1'], [13, 24, 90, 'manual', 'Year 2'], [25, null, 100, 'list', null],
    ])
  })

  it('combines a rule phase and a manual phase in the same month (rule → standard, manual → offer)', () => {
    // Rule: 50% off months 1–3 (standard 50). Manual: an extra Set price 30 in month 1 only.
    const ruled: ResolvedCharge = { ...mrc, standardUnitPrice: 100, standardTotalPrice: 100, schedule: [
      { fromMonth: 1, toMonth: 3, unitPrice: 50, totalPrice: 50, standardUnitPrice: 50, standardTotalPrice: 50, source: 'rule', name: 'Promo 50%', ruleCodes: ['PROMO'] },
      { fromMonth: 4, toMonth: null, unitPrice: 100, totalPrice: 100, standardUnitPrice: 100, standardTotalPrice: 100, source: 'list', name: null },
    ] }
    const result = resolveManualAdjustments([lineOf([ruled])], [phase({ value: 30, fromMonth: 1, toMonth: 1, phaseName: 'Deal' })], 'USD')
    expect(result.errors).toEqual([])
    expect(result.lines[0].charges[0].schedule?.map((segment) => [segment.fromMonth, segment.toMonth, segment.totalPrice, segment.standardTotalPrice, segment.source, segment.name])).toEqual([
      [1, 1, 30, 50, 'manual', 'Deal'],
      [2, 3, 50, 50, 'rule', 'Promo 50%'],
      [4, null, 100, 100, 'list', null],
    ])
    // % off in a phase deepens the rule's promotion, never compounded with another manual adjustment.
    const deeper = resolveManualAdjustments([lineOf([ruled])], [phase({ adjustmentType: 'discount_percent', value: 20, currencyCode: undefined, fromMonth: 1, toMonth: 3 })], 'USD')
    expect(deeper.lines[0].charges[0].schedule?.[0]).toMatchObject({ fromMonth: 1, toMonth: 3, totalPrice: 40, standardTotalPrice: 50, source: 'manual' })
  })

  it('a line-level Set price phase spreads over the recurring charges (applyLineSpread per segment)', () => {
    const second: ResolvedCharge = { ...mrc, chargeCode: 'tv', chargeName: 'TV', unitPrice: 50, totalPrice: 50 }
    const result = resolveManualAdjustments([lineOf([mrc, second])], [
      phase({ level: 'line', chargeCode: undefined, chargeTypeFilter: 'mrc', value: 75, fromMonth: 1, toMonth: 3 }),
    ], 'USD')
    expect(result.errors).toEqual([])
    const [net, tv] = result.lines[0].charges
    expect(net.schedule?.[0].totalPrice! + tv.schedule?.[0].totalPrice!).toBeCloseTo(75)
    expect(net.schedule?.[0].totalPrice).toBeCloseTo(50)
    expect([net.totalPrice, tv.totalPrice]).toEqual([100, 50])
  })

  it('refuses a phase past the line term, and a phase on a one-time charge', () => {
    const nrc: ResolvedCharge = { ...mrc, chargeCode: 'setup', chargeType: 'nrc' }
    const result = resolveManualAdjustments([lineOf([mrc, nrc], { termMonths: 12 })], [
      phase({ id: 'late', fromMonth: 6, toMonth: 13 }),
      phase({ id: 'once', chargeCode: 'setup', fromMonth: 1, toMonth: 1 }),
    ], 'USD')
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ adjustmentId: 'late', code: 'PHASE_PAST_TERM' }),
      expect.objectContaining({ adjustmentId: 'once', code: 'PHASE_RECURRING_ONLY' }),
    ]))
    expect(result.lines[0].charges[0].schedule).toBeUndefined()
    expect(result.lines[0].charges[0].adjustmentErrors).toEqual([expect.objectContaining({ code: 'PHASE_PAST_TERM' })])
  })

  it('mirrored ARC lines stay not eligible for phases (D8)', () => {
    const result = resolveManualAdjustments([lineOf([mrc], { mirrored: true })], [phase({})], 'USD')
    expect(result.errors).toEqual([expect.objectContaining({ code: 'LINE_NOT_ELIGIBLE' })])
    expect(result.lines[0].charges[0].schedule).toBeUndefined()
  })

  it('phases on one target overlap only when their months intersect', () => {
    const a = { id: 'a', level: 'charge', quoteLineId: 'line', chargeCode: 'net', fromMonth: 1, toMonth: 3 }
    expect(adjustmentsOverlap(a, { ...a, id: 'b', fromMonth: 4, toMonth: 6 })).toBe(false)
    expect(adjustmentsOverlap(a, { ...a, id: 'b', fromMonth: 3, toMonth: 6 })).toBe(true)
    expect(adjustmentsOverlap(a, { ...a, id: 'b', fromMonth: 1, toMonth: null })).toBe(true)
  })
})

describe('deal value over the schedule', () => {
  it('sums each month of the term and flags time-based pricing', () => {
    const priced = resolveManualAdjustments([lineOf([mrc])], [phase({ value: 0, fromMonth: 1, toMonth: 1 }), phase({ id: 'p2', adjustmentType: 'discount_percent', value: 50, currencyCode: undefined, fromMonth: 2, toMonth: 3 })], 'USD')
    const summary = computeWaterfallSummary([{ lineId: 'line', quantity: 2, termMonths: 12, charges: priced.lines[0].charges }], [], 'USD')
    // 0 + 2×50 + 9×100 = 1000 per instance, × 2.
    expect(summary.dealValue).toEqual({ list: 2400, standard: 2400, offer: 2000 })
    expect(summary.hasTimeBasedAdjustments).toBe(true)
    const flat = computeWaterfallSummary([{ lineId: 'line', quantity: 2, termMonths: 12, charges: [mrc] }], [], 'USD')
    expect(flat.hasTimeBasedAdjustments).toBe(false)
    expect(flat.snapshotHash).not.toBe(summary.snapshotHash)
  })
})

describe('C2 payload phases', () => {
  const segment = (fromMonth: number, toMonth: number | null, totalPrice: number, name: string | null = null) =>
    ({ fromMonth, toMonth, unitPrice: totalPrice, totalPrice, standardUnitPrice: totalPrice, standardTotalPrice: totalPrice, source: 'manual' as const, name })

  it('merges several MRC charges into one schedule: union of boundaries, prices summed', () => {
    const net = { chargeType: 'mrc', totalPrice: 100, schedule: [segment(1, 1, 0, 'Free trial'), segment(2, null, 100)] }
    const tv = { chargeType: 'mrc', totalPrice: 50, schedule: [segment(1, 3, 25, 'Promo 50%'), segment(4, null, 50)] }
    const flat = { chargeType: 'mrc', totalPrice: 10 }
    expect(mergeRecurringPhases([net, tv, flat], 2)).toEqual([
      { name: 'Free trial + Promo 50%', months: 1, priceType: 'fixed', value: 70 },
      { name: 'Promo 50%', months: 2, priceType: 'fixed', value: 270 },
    ])
    expect(mergeRecurringPhases([flat], 1)).toEqual([])
  })

  it('rides on the recurring charge of its billing period; unitPrice stays the regular price', () => {
    const monthly = { chargeType: 'mrc', totalPrice: 100, schedule: [segment(1, 1, 0, 'Free trial'), segment(2, null, 100)] }
    const yearly = { chargeType: 'mrc', totalPrice: 1200, billingPeriod: { unit: 'year', interval: 1 } }
    expect(buildRecurringPayloadCharges([monthly, yearly], 1, 200)).toEqual([
      { type: 'recurring', unitPrice: 100, description: 'Recurring charge', phases: [{ name: 'Free trial', months: 1, priceType: 'fixed', value: 0 }] },
      { type: 'recurring', unitPrice: 1200, description: 'Recurring charge', billingPeriod: { unit: 'year', interval: 1 } },
    ])
  })

  it('ARC addedItems carry the phases of the added line', () => {
    const charges = [{ chargeType: 'mrc', totalPrice: 100, schedule: [segment(1, 3, 50, 'Promo'), segment(4, null, 100)] }]
    const [item] = buildArcAddedItems({
      afterSnapshot: { items: [{ id: 'item-1', name: 'Internet', quantity: 1, charges }] },
      lineChanges: [{ action: 'add', itemId: 'item-1', mrcAmount: 100, nrcAmount: 0 }],
    } as never)
    expect(item.charges).toEqual([{ type: 'recurring', unitPrice: 100, description: 'Recurring charge', phases: [{ name: 'Promo', months: 3, priceType: 'fixed', value: 50 }] }])
  })

  it('withoutSchedule keeps an existing line at its regular price (D8)', () => {
    expect(withoutSchedule({ ...mrc, schedule: [segment(1, 1, 0), segment(2, null, 100)] })).toEqual(mrc)
  })
})

describe('price rule phase validation (V-PR-PHASE)', () => {
  const { cpqPriceRuleCreateSchema, cpqPriceRuleUpdateSchema } = jest.requireActual('../../data/validators') as typeof import('../../data/validators')
  const rule = { code: 'TRIAL', name: 'Free trial', ruleType: 'price_override', value: 0 }
  it('accepts a month range and campaign dates', () => {
    expect(cpqPriceRuleCreateSchema.parse({ ...rule, fromMonth: 1, toMonth: 1, chargeTypeFilter: 'mrc', validFrom: '2026-11-01', validUntil: '2026-12-31' }))
      .toMatchObject({ fromMonth: 1, toMonth: 1, validFrom: '2026-11-01', validUntil: '2026-12-31' })
  })
  it.each([
    [{ fromMonth: 3, toMonth: 2 }, 'PHASE_RANGE_INVALID'],
    [{ toMonth: 1, chargeTypeFilter: 'nrc' }, 'PHASE_RECURRING_ONLY'],
    [{ validFrom: '2026-12-31', validUntil: '2026-11-01' }, 'CAMPAIGN_RANGE_INVALID'],
    [{ validFrom: '31/12/2026' }, 'Expected YYYY-MM-DD'],
  ])('refuses %j', (patch, message) => {
    const result = cpqPriceRuleCreateSchema.safeParse({ ...rule, ...patch })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })
  it('a partial update without phase fields keeps defaults out', () => {
    expect(cpqPriceRuleUpdateSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'x' })).toEqual({ id: '11111111-1111-4111-8111-111111111111', name: 'x' })
  })
})

describe('stored phase rows', () => {
  const { adjustmentInput, adjustmentSnapshot } = jest.requireActual('../priceAdjustments/adjustmentService') as typeof import('../priceAdjustments/adjustmentService')
  const row = {
    id: '11111111-1111-4111-8111-111111111111', level: 'charge', quoteLineId: '22222222-2222-4222-8222-222222222222', chargeCode: 'net', chargeTypeFilter: null,
    adjustmentType: 'price_override', value: '0', currencyCode: 'USD', reasonCode: 'promotion', reasonNote: null,
    windowKind: 'relative', fromMonth: 1, toMonth: 3, phaseName: 'Free trial',
    quoteConfigurationId: '33333333-3333-4333-8333-333333333333', quoteId: '44444444-4444-4444-8444-444444444444',
    tenantId: '55555555-5555-4555-8555-555555555555', organizationId: '66666666-6666-4666-8666-666666666666',
    createdByUserId: '77777777-7777-4777-8777-777777777777', createdAt: new Date('2026-11-27T00:00:00Z'), updatedAt: new Date('2026-11-27T00:00:00Z'),
    deletedAt: null, isActive: true,
  }
  it('keeps the month range and name in the input and the audit snapshot (undo restores a phase, not a permanent price)', () => {
    expect(adjustmentInput(row as never)).toMatchObject({ fromMonth: 1, toMonth: 3, windowKind: 'relative', phaseName: 'Free trial' })
    expect(adjustmentSnapshot(row as never)).toMatchObject({ fromMonth: 1, toMonth: 3, phaseName: 'Free trial' })
    expect(adjustmentInput({ ...row, toMonth: null, phaseName: null } as never)).not.toHaveProperty('fromMonth')
  })
})
