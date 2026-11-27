import {
  adjustmentAccess, adjustmentErrorCode, collectAdjustmentErrors, allowedAdjustmentTypes, buildAdjustmentDraft, canDeleteInvalidAdjustment, discountDepth, formatDepth, parseStoredCharge, toAdjustmentPatch,
  lineAdjustmentBlock, lineWaterfallTotals, waterfallRows, requiresChargeType, overrideSetsChargeTotal, isAboveStandard, lineTypeTotals,
} from '../priceAdjustmentView'
import { TERMINAL_STATUSES } from '../../services/types'

const rule = { origin: 'rule' as const, ruleCode: 'VOL', ruleName: 'Volume', ruleType: 'discount_percent', value: 10, unitPriceBefore: 100, unitPriceAfter: 90, delta: -10 }
const manual = { origin: 'manual' as const, adjustmentId: 'a1', ruleCode: 'a1', ruleName: 'competitive_match', ruleType: 'price_override', value: 80, unitPriceBefore: 90, unitPriceAfter: 80, delta: -10, reasonCode: 'competitive_match' }

describe('waterfallRows', () => {
  it('orders list, rules, standard, manual, offer', () => {
    const rows = waterfallRows({ chargeType: 'mrc', unitPrice: 80, totalPrice: 80, listUnitPrice: 100, standardUnitPrice: 90, adjustments: [manual, rule] })
    expect(rows.map((row) => row.kind)).toEqual(['list', 'rule', 'standard', 'manual', 'offer'])
    expect(rows[0]).toEqual({ kind: 'list', unitPrice: 100 })
    expect(rows[2]).toEqual({ kind: 'standard', unitPrice: 90 })
    expect(rows[3]).toMatchObject({ reasonCode: 'competitive_match', adjustmentId: 'a1', delta: -10 })
    expect(rows[4]).toEqual({ kind: 'offer', unitPrice: 80 })
  })

  it('shows list and offer only when nothing adjusted the price', () => {
    expect(waterfallRows({ chargeType: 'nrc', unitPrice: 50, totalPrice: 50 }).map((row) => row.kind)).toEqual(['list', 'offer'])
  })

  it('treats legacy rule entries without origin as rules and derives list from them', () => {
    const { origin: _origin, ...legacy } = rule
    const rows = waterfallRows({ chargeType: 'mrc', unitPrice: 90, totalPrice: 90, adjustments: [legacy] })
    expect(rows).toEqual([
      { kind: 'list', unitPrice: 100 },
      expect.objectContaining({ kind: 'rule', label: 'Volume' }),
      { kind: 'standard', unitPrice: 90 },
      { kind: 'offer', unitPrice: 90 },
    ])
  })
})

describe('depth', () => {
  it('is signed and formatted with one decimal', () => {
    expect(discountDepth(100, 80)).toBeCloseTo(0.2)
    expect(formatDepth(discountDepth(100, 80))).toBe('−20%')
    expect(formatDepth(discountDepth(100, 112.5))).toBe('+12.5%')
    expect(formatDepth(discountDepth(100, 100))).toBeNull()
    expect(discountDepth(0, 0)).toBeNull()
    expect(discountDepth(null, 5)).toBeNull()
  })

  it('totals a line by quantity and skips usage', () => {
    expect(lineWaterfallTotals({ quantity: 2, charges: [
      { chargeType: 'mrc', unitPrice: 80, totalPrice: 80, listTotalPrice: 100, standardTotalPrice: 90 },
      { chargeType: 'usage', unitPrice: 1, totalPrice: null },
      { chargeType: 'nrc', unitPrice: 10, totalPrice: 10 },
    ] })).toEqual({ list: 220, standard: 200, offer: 180 })
  })
})

describe('allowedAdjustmentTypes', () => {
  it.each([
    ['line', undefined, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'flat' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'nrc', pricingMethod: 'per_unit' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'tiered' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'volume' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'usage', pricingMethod: 'flat' }, []],
  ] as const)('%s %j → %j', (level, charge, expected) => {
    expect(allowedAdjustmentTypes(level, charge)).toEqual(expected)
  })
})

describe('manual pricing flexibility helpers (spec F)', () => {
  it('requires Recurring or One-time only for line-level Set price and Amount off', () => {
    expect(requiresChargeType('line', 'price_override')).toBe(true)
    expect(requiresChargeType('line', 'discount_absolute')).toBe(true)
    expect(requiresChargeType('line', 'discount_percent')).toBe(false)
    expect(requiresChargeType('charge', 'price_override')).toBe(false)
  })
  it('sets the charge total on volume and tiered charges only', () => {
    expect(overrideSetsChargeTotal({ pricingMethod: 'tiered' })).toBe(true)
    expect(overrideSetsChargeTotal({ pricingMethod: 'volume' })).toBe(true)
    expect(overrideSetsChargeTotal({ pricingMethod: 'flat' })).toBe(false)
    expect(overrideSetsChargeTotal(undefined)).toBe(false)
  })
  it('flags an offer above standard and shows the uplift as a negative discount', () => {
    expect(isAboveStandard(100, 120)).toBe(true)
    expect(isAboveStandard(100, 100)).toBe(false)
    expect(isAboveStandard(100, 80)).toBe(false)
    expect(isAboveStandard(null, 80)).toBe(false)
    expect(discountDepth(100, 120)).toBeCloseTo(-0.2)
    expect(formatDepth(discountDepth(100, 120))).toBe('+20%')
  })
  it('totals one charge type of a line over the line quantity', () => {
    const line = { quantity: 2, charges: [
      { chargeType: 'mrc' as const, unitPrice: 80, totalPrice: 80, standardTotalPrice: 100 },
      { chargeType: 'nrc' as const, unitPrice: 10, totalPrice: 10 },
      { chargeType: 'usage' as const, unitPrice: 1, totalPrice: null },
    ] }
    expect(lineTypeTotals(line, 'mrc')).toEqual({ standard: 200, offer: 160 })
    expect(lineTypeTotals(line, 'nrc')).toEqual({ standard: 20, offer: 20 })
    expect(lineTypeTotals(line)).toEqual({ standard: 220, offer: 180 })
  })
})

describe('eligibility and access', () => {
  it('blocks ARC mirror and free-form lines', () => {
    expect(lineAdjustmentBlock({ offeringId: 'o', configuration: { _arcMirroredFromItemId: 'i' } }, 'amend')).toBe('mirror')
    expect(lineAdjustmentBlock({ offeringId: 'o', configuration: { _arcMirroredFromItemId: 'i' } }, 'new')).toBeNull()
    expect(lineAdjustmentBlock({ offeringId: null }, 'new')).toBe('free_form')
    expect(lineAdjustmentBlock({ offeringId: null, productId: 'p1' }, 'new')).toBeNull()
    expect(lineAdjustmentBlock({ offeringId: 'o', configuration: {} }, 'renew')).toBeNull()
  })

  const base = { enabled: true, canAdjust: true, cpqStatus: 'ready', convertedOrderId: null }
  it.each([
    [{}, null],
    [{ enabled: null }, 'loading'],
    [{ enabled: false }, 'disabled'],
    [{ canAdjust: false }, 'no_permission'],
    [{ convertedOrderId: 'order' }, 'converted'],
    [{ cpqStatus: 'in_approval' }, 'locked'],
  ] as const)('%j → %s', (patch, reason) => {
    expect(adjustmentAccess({ ...base, ...patch }).reason).toBe(reason)
  })

  it('lets invalid adjustments be deleted while submitted, never once final', () => {
    expect(canDeleteInvalidAdjustment({ ...base, cpqStatus: 'in_approval' })).toBe(true)
    for (const status of TERMINAL_STATUSES) expect(canDeleteInvalidAdjustment({ ...base, cpqStatus: status })).toBe(false)
    expect(canDeleteInvalidAdjustment({ ...base, convertedOrderId: 'x' })).toBe(false)
  })
})

describe('request bodies', () => {
  const form = { adjustmentType: 'price_override' as const, value: '80', reasonCode: 'competitive_match', reasonNote: '', chargeTypeFilter: '' as const }
  it('builds a charge override with currency and revision', () => {
    expect(buildAdjustmentDraft(form, { level: 'charge', quoteLineId: 'l1', chargeCode: 'fee' }, 'USD', 3)).toEqual({
      level: 'charge', quoteLineId: 'l1', chargeCode: 'fee', adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match', expectedRevision: 3,
    })
  })
  it('builds a line percentage without currency, with filter and note; accepts a decimal comma', () => {
    expect(buildAdjustmentDraft({ ...form, adjustmentType: 'discount_percent', value: '12,5', chargeTypeFilter: 'mrc', reasonCode: 'other', reasonNote: ' match ' }, { level: 'line', quoteLineId: 'l1' }, 'USD')).toEqual({
      level: 'line', quoteLineId: 'l1', chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: 12.5, reasonCode: 'other', reasonNote: 'match',
    })
  })
  it('returns null for empty or non-numeric values', () => {
    expect(buildAdjustmentDraft({ ...form, value: ' ' }, { level: 'line', quoteLineId: 'l1' }, 'USD')).toBeNull()
    expect(buildAdjustmentDraft({ ...form, value: 'abc' }, { level: 'line', quoteLineId: 'l1' }, 'USD')).toBeNull()
  })
  it('drops immutable target fields from a patch and clears removed notes', () => {
    const draft = buildAdjustmentDraft(form, { level: 'charge', quoteLineId: 'l1', chargeCode: 'fee' }, 'USD', 2)!
    expect(toAdjustmentPatch(draft)).toEqual({ adjustmentType: 'price_override', value: 80, currencyCode: 'USD', reasonCode: 'competitive_match', reasonNote: null, expectedRevision: 2, fromMonth: 1, toMonth: null, phaseName: null })
  })
  it.each([
    [409, { error: 'STALE_REVISION' }, 'STALE_REVISION'],
    [400, { error: 'Validation error', details: [{ message: 'Invalid' }, { message: 'INVALID_PERCENT' }] }, 'INVALID_PERCENT'],
    [422, { error: 'ABOVE_STANDARD' }, 'ABOVE_STANDARD'],
    [403, { error: 'Manual price adjustments are disabled' }, 'FORBIDDEN'],
    [500, null, 'UNKNOWN'],
  ])('maps %s %j → %s', (status, body, code) => {
    expect(adjustmentErrorCode(status, body)).toBe(code)
  })
})

describe('parseStoredCharge', () => {
  it('keeps waterfall fields and well-formed adjustments, drops malformed ones', () => {
    const parsed = parseStoredCharge({ chargeCode: 'fee', chargeType: 'mrc', unitPrice: 80, totalPrice: 80, quantity: 1, listUnitPrice: 100, standardUnitPrice: 90,
      adjustments: [{ ...manual }, { ruleType: 'x' }, null] })
    expect(parsed).toMatchObject({ chargeName: 'fee', chargeType: 'mrc', unitPrice: 80, listUnitPrice: 100, standardUnitPrice: 90, quantity: 1 })
    expect(parsed?.adjustments).toHaveLength(1)
  })
  it.each([null, 'x', { chargeType: 'mrc' }, { chargeType: 'other', unitPrice: 1 }])('rejects %j', (raw) => {
    expect(parseStoredCharge(raw)).toBeNull()
  })
})

describe('collectAdjustmentErrors', () => {
  it('reads recalculation errors, charge errors and persisted validation errors (after reload)', () => {
    const map = collectAdjustmentErrors({
      adjustmentErrors: [{ adjustmentId: 'a1', code: 'ABOVE_STANDARD' }],
      lines: [{ charges: [{ adjustmentErrors: [{ adjustmentId: 'a1', code: 'CURRENCY_MISMATCH' }, { adjustmentId: 'a2', code: 'ADJUSTMENT_OVERLAP' }] }],
        validationErrors: [{ adjustmentId: 'a3', message: 'ADJUSTMENT_TARGET_MISSING' }, { message: 'Port size is required' }] }],
      validationResult: { errors: [{ adjustmentId: 'a4', message: 'TARGET_AMBIGUOUS' }] },
    })
    expect(Object.fromEntries(map)).toEqual({ a1: 'ABOVE_STANDARD', a2: 'ADJUSTMENT_OVERLAP', a3: 'ADJUSTMENT_TARGET_MISSING', a4: 'TARGET_AMBIGUOUS' })
  })
  it('is empty for a missing quote', () => {
    expect(collectAdjustmentErrors(null).size).toBe(0)
  })
})

describe('price phases view helpers', () => {
  const { buildPhaseDrafts, phaseStepRanges, monthRangeFields, isPermanentAdjustment } = jest.requireActual('../priceAdjustmentView') as typeof import('../priceAdjustmentView')
  const step = (values: Partial<import('../priceAdjustmentView').PhaseStepForm>) => ({ length: '1', unit: 'month' as const, kind: 'free' as const, value: '', name: '', ...values })
  it('lays steps back to back from month 1; years are 12 months', () => {
    expect(phaseStepRanges([step({}), step({ length: '2' }), step({ length: '1', unit: 'year' }), step({ length: 'x' })])).toEqual([
      { fromMonth: 1, toMonth: 1 }, { fromMonth: 2, toMonth: 3 }, { fromMonth: 4, toMonth: 15 }, null,
    ])
  })
  it('builds one draft per step: Free = Set price 0, line phases on the recurring total', () => {
    const result = buildPhaseDrafts({
      steps: [step({ name: 'Free trial' }), step({ length: '2', kind: 'discount_percent', value: '50', name: 'Promo 50%' })],
      target: { level: 'line', quoteLineId: 'l1' }, reasonCode: 'promotion', reasonNote: '', currencyCode: 'USD', termMonths: 12,
    })
    expect(result.error).toBeNull()
    expect(result.drafts).toEqual([
      { level: 'line', quoteLineId: 'l1', chargeTypeFilter: 'mrc', adjustmentType: 'price_override', value: 0, currencyCode: 'USD', reasonCode: 'promotion', fromMonth: 1, toMonth: 1, phaseName: 'Free trial' },
      { level: 'line', quoteLineId: 'l1', chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: 50, reasonCode: 'promotion', fromMonth: 2, toMonth: 3, phaseName: 'Promo 50%' },
    ])
  })
  it('refuses a sequence past the term, an empty value or an invalid percent', () => {
    const target = { level: 'charge' as const, quoteLineId: 'l1', chargeCode: 'net' }
    const base = { target, reasonCode: 'promotion', reasonNote: '', currencyCode: 'USD' }
    expect(buildPhaseDrafts({ ...base, steps: [step({ length: '2', unit: 'year' })], termMonths: 12 })).toMatchObject({ error: 'PHASE_PAST_TERM', stepIndex: 0 })
    expect(buildPhaseDrafts({ ...base, steps: [step({}), step({ kind: 'price_override', value: '' })] })).toMatchObject({ error: 'PHASE_VALUE_INVALID', stepIndex: 1 })
    expect(buildPhaseDrafts({ ...base, steps: [step({ kind: 'discount_percent', value: '120' })] })).toMatchObject({ error: 'PHASE_VALUE_INVALID' })
    expect(buildPhaseDrafts({ ...base, steps: [] })).toMatchObject({ error: 'PHASE_NONE' })
  })
  it('omits the range for a permanent adjustment and tells permanent from phases', () => {
    expect(monthRangeFields({ fromMonth: '', toMonth: '' })).toEqual({})
    expect(monthRangeFields({ fromMonth: '2', toMonth: '', phaseName: ' Year 2 ' })).toEqual({ fromMonth: 2, toMonth: null, phaseName: 'Year 2' })
    expect(isPermanentAdjustment({ fromMonth: 1, toMonth: null })).toBe(true)
    expect(isPermanentAdjustment({ fromMonth: 1, toMonth: 3 })).toBe(false)
  })
})
