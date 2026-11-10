import {
  adjustmentAccess, allowedAdjustmentTypes, canDeleteInvalidAdjustment, discountDepth, formatDepth,
  lineAdjustmentBlock, lineWaterfallTotals, waterfallRows,
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
    ['line', undefined, ['discount_percent']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'flat' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'nrc', pricingMethod: 'per_unit' }, ['price_override', 'discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'tiered' }, ['discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'mrc', pricingMethod: 'volume' }, ['discount_percent', 'discount_absolute']],
    ['charge', { chargeType: 'usage', pricingMethod: 'flat' }, []],
  ] as const)('%s %j → %j', (level, charge, expected) => {
    expect(allowedAdjustmentTypes(level, charge)).toEqual(expected)
  })
})

describe('eligibility and access', () => {
  it('blocks ARC mirror and free-form lines', () => {
    expect(lineAdjustmentBlock({ offeringId: 'o', configuration: { _arcMirroredFromItemId: 'i' } }, 'amend')).toBe('mirror')
    expect(lineAdjustmentBlock({ offeringId: 'o', configuration: { _arcMirroredFromItemId: 'i' } }, 'new')).toBeNull()
    expect(lineAdjustmentBlock({ offeringId: null }, 'new')).toBe('free_form')
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
