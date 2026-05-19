import {
  selectItemsForPeriod,
  shouldIncludeItem,
  type SelectableItem,
} from '../../lib/itemSelector'
import { deriveBillPeriod } from '../../lib/billPeriod'

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

function baseItem(overrides: Partial<SelectableItem> = {}): SelectableItem {
  return {
    id: overrides.id ?? 'item-x',
    type: overrides.type ?? 'recurring',
    billStartDate: overrides.billStartDate ?? date('2026-01-01'),
    billEndDate: overrides.billEndDate ?? null,
    billedToDate: overrides.billedToDate ?? null,
    description: overrides.description ?? 'desc',
    rateJson: overrides.rateJson ?? { unit_price: 49.99 },
    isActive: overrides.isActive ?? true,
    deletedAt: overrides.deletedAt ?? null,
  }
}

// May 2026 monthly period: 2026-05-01..2026-05-31
const MAY_PERIOD = deriveBillPeriod(date('2026-06-01'), 'monthly')

describe('shouldIncludeItem — type=recurring', () => {
  it('includes a standard ongoing item (started before, no end)', () => {
    const decision = shouldIncludeItem(baseItem({ type: 'recurring' }), MAY_PERIOD)
    expect(decision.include).toBe(true)
  })

  it('skips an item that starts mid-cycle (2026-05-15)', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'recurring', billStartDate: date('2026-05-15') }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({ include: false, reason: 'recurring-starts-mid-cycle' })
  })

  it('skips an item that ends mid-cycle (2026-05-15)', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'recurring', billEndDate: date('2026-05-15') }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({ include: false, reason: 'recurring-ends-mid-cycle' })
  })

  it('skips an item already billed through this period (billed_to_date >= period_end)', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'recurring', billedToDate: date('2026-05-31') }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({
      include: false,
      reason: 'recurring-already-billed-through-period',
    })
  })

  it('includes when billed_to_date is from a prior cycle (< period_end)', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'recurring', billedToDate: date('2026-04-30') }),
      MAY_PERIOD,
    )
    expect(decision.include).toBe(true)
  })

  it('includes when item starts exactly on period_start', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'recurring', billStartDate: date('2026-05-01') }),
      MAY_PERIOD,
    )
    expect(decision.include).toBe(true)
  })

  it('includes when item ends exactly on period_end (full cycle covered)', () => {
    const decision = shouldIncludeItem(
      baseItem({
        type: 'recurring',
        billStartDate: date('2026-05-01'),
        billEndDate: date('2026-05-31'),
      }),
      MAY_PERIOD,
    )
    expect(decision.include).toBe(true)
  })
})

describe('shouldIncludeItem — type=one_time', () => {
  it('includes when window overlaps period and billed_to_date is null', () => {
    const decision = shouldIncludeItem(
      baseItem({ type: 'one_time', rateJson: { amount: 99 } }),
      MAY_PERIOD,
    )
    expect(decision.include).toBe(true)
  })

  it('skips when already billed (billed_to_date set)', () => {
    const decision = shouldIncludeItem(
      baseItem({
        type: 'one_time',
        rateJson: { amount: 99 },
        billedToDate: date('2026-04-30'),
      }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({ include: false, reason: 'one_time-already-billed' })
  })

  it('skips when window is entirely after period_end', () => {
    const decision = shouldIncludeItem(
      baseItem({
        type: 'one_time',
        billStartDate: date('2026-06-01'),
        rateJson: { amount: 99 },
      }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({ include: false, reason: 'one_time-window-outside-period' })
  })

  it('skips when window ends before period_start', () => {
    const decision = shouldIncludeItem(
      baseItem({
        type: 'one_time',
        billStartDate: date('2026-04-01'),
        billEndDate: date('2026-04-15'),
        rateJson: { amount: 99 },
      }),
      MAY_PERIOD,
    )
    expect(decision).toEqual({ include: false, reason: 'one_time-window-outside-period' })
  })

  it('includes a mid-cycle proration item (the canonical add-package case)', () => {
    // Mirrors spec Story 2: New package on 2026-05-15 → one_time proration
    // with bill_start_date=2026-05-15. Overlaps May period → included.
    const decision = shouldIncludeItem(
      baseItem({
        type: 'one_time',
        billStartDate: date('2026-05-15'),
        rateJson: { amount: 15.9 },
      }),
      MAY_PERIOD,
    )
    expect(decision.include).toBe(true)
  })
})

describe('shouldIncludeItem — guards', () => {
  it('skips inactive items', () => {
    expect(
      shouldIncludeItem(baseItem({ isActive: false }), MAY_PERIOD),
    ).toEqual({ include: false, reason: 'item-inactive' })
  })

  it('skips soft-deleted items', () => {
    expect(
      shouldIncludeItem(baseItem({ deletedAt: date('2026-04-01') }), MAY_PERIOD),
    ).toEqual({ include: false, reason: 'item-soft-deleted' })
  })

  it('skips usage items (handled by Phase 3 rater)', () => {
    expect(
      shouldIncludeItem(
        baseItem({ type: 'usage', rateJson: { unit_price: 0.001 } }),
        MAY_PERIOD,
      ),
    ).toEqual({ include: false, reason: 'usage-handled-by-rater' })
  })
})

describe('selectItemsForPeriod', () => {
  it('partitions a mix into included + skipped with reasons', () => {
    const items = [
      baseItem({ id: 'a', type: 'recurring' }), // include
      baseItem({ id: 'b', type: 'recurring', billStartDate: date('2026-05-15') }), // mid-cycle start
      baseItem({ id: 'c', type: 'one_time', rateJson: { amount: 99 } }), // include
      baseItem({ id: 'd', type: 'usage', rateJson: { unit_price: 0.001 } }), // usage → skipped
      baseItem({ id: 'e', type: 'recurring', billedToDate: date('2026-05-31') }), // already billed
    ]
    const { included, skipped } = selectItemsForPeriod(items, MAY_PERIOD)
    expect(included.map((i) => i.id)).toEqual(['a', 'c'])
    expect(skipped.map((s) => ({ id: s.item.id, reason: s.reason }))).toEqual([
      { id: 'b', reason: 'recurring-starts-mid-cycle' },
      { id: 'd', reason: 'usage-handled-by-rater' },
      { id: 'e', reason: 'recurring-already-billed-through-period' },
    ])
  })
})
