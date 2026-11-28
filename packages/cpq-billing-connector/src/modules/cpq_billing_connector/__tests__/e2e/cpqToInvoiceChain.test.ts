import { buildRecurringPayloadCharges } from '@dainamite/cpq/modules/cpq/lib/chargeBillingPeriod'
import {
  computeRecurringLines,
  type ItemStatusPeriodState,
  type RecurringComputation,
  type RecurringItemState,
} from '@dainamite/billing/modules/billing/lib/servicePeriods'
import { resolvePhases } from '@dainamite/billing/modules/billing/lib/pricePhases'
import type { CycleSpec } from '@dainamite/billing/modules/billing/lib/billCycle'
import { mapSubscriptionItemsWithRejections, type BillingItemPayload, type CpqCharge } from '../../lib/chargeMapper'
import { planStatusWrites, type ExistingStatusPeriod, type StatusChange } from '../../lib/itemStatus'
import { buildTerminatedItemUpdates } from '../../subscribers/cpq-subscription-terminated'

/**
 * Pure end-to-end chain, no DB: the CPQ payload builder
 * (`buildRecurringPayloadCharges`, what activation / ARC emit) → the
 * connector mapper (contract C3) → billing's recurring engine
 * (`computeRecurringLines`) over consecutive bill dates.
 *
 * Asserts the worked examples of spec P (Example A: free month, then 50% for
 * two months) and spec L (yearly mobile plan on a monthly internet account),
 * plus a CPQ pause / resume / terminate flowing into the invoices.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null)
const monthlyOn1: CycleSpec = { cycle: 'monthly', interval: 1, day: '1' }

/** A CPQ stored MRC charge (the shape on quote / order lines). */
type StoredCharge = Record<string, unknown>

function cpqItem(id: string, charges: StoredCharge[], monthlyTotal: number, productName = 'Internet') {
  return {
    subscriptionItemId: id,
    productName,
    quantity: 1,
    charges: buildRecurringPayloadCharges(charges, 1, monthlyTotal) as CpqCharge[],
  }
}

function mapItems(items: ReturnType<typeof cpqItem>[], billStartDate: string): BillingItemPayload[] {
  const { payloads, rejected } = mapSubscriptionItemsWithRejections({ subscriptionId: 'sub-1', items, billStartDate })
  expect(rejected).toEqual([])
  return payloads
}

/** What `billing.items.create` stores from the connector payload, as the engine reads it. */
function engineState(payload: BillingItemPayload, extra: Partial<RecurringItemState> = {}): RecurringItemState {
  const rate = payload.rateJson as { unit_price: number }
  return {
    id: payload.sourceRef,
    chargeTiming: 'in_advance',
    prorate: true,
    billStartDate: d(payload.billStartDate),
    billEndDate: null,
    billedToDate: null,
    unitPrice: rate.unit_price,
    isActive: true,
    deletedAt: null,
    billingPeriod: payload.billingPeriodUnit
      ? { unit: payload.billingPeriodUnit, interval: payload.billingPeriodInterval ?? 1 }
      : null,
    phases: payload.phasesEnabled && payload.phases ? resolvePhases(payload.billStartDate, payload.phases) : [],
    ...extra,
  }
}

type Line = { item: string; from: string | null; to: string | null; amount: number; phase: string | null }

/** Runs the engine bill date by bill date, carrying the watermark and status `applied*` like the Bill Run. */
function billRuns(states: Array<{ state: RecurringItemState; from?: string }>, billDates: string[]) {
  const current = states.map((s) => ({ ...s, state: { ...s.state } }))
  return billDates.map((billDate) => {
    const lines: Line[] = []
    for (const entry of current) {
      if (entry.from && billDate < entry.from) continue
      const res: RecurringComputation = computeRecurringLines(entry.state, { billDate: d(billDate), cycle: monthlyOn1 })
      for (const line of res.lines) {
        lines.push({
          item: entry.state.id,
          from: iso(line.servicePeriodStart),
          to: iso(line.servicePeriodEnd),
          amount: line.amount,
          phase: line.phase?.name ?? null,
        })
      }
      const statusPeriods = entry.state.statusPeriods?.map((s) => {
        const update = res.statusApplied.find((u) => u.id === s.id)
        return update ? { ...s, appliedFrom: update.appliedFrom, appliedTo: update.appliedTo } : s
      })
      entry.state = { ...entry.state, billedToDate: res.newBilledToDate, statusPeriods }
    }
    const total = Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100
    return { billDate, lines, total }
  })
}

describe('CPQ → connector → billing: spec P Example A (free month, then 50% for two months)', () => {
  // Internet 79,900 / month; CPQ schedule: month 1 free, months 2–3 at 50%.
  const internet: StoredCharge = {
    chargeType: 'mrc',
    totalPrice: 79_900,
    schedule: [
      { fromMonth: 1, toMonth: 1, unitPrice: 0, totalPrice: 0, standardUnitPrice: 79_900, standardTotalPrice: 79_900, source: 'manual', name: 'Free trial' },
      { fromMonth: 2, toMonth: 3, unitPrice: 39_950, totalPrice: 39_950, standardUnitPrice: 79_900, standardTotalPrice: 79_900, source: 'manual', name: 'Promo 50%' },
      { fromMonth: 4, toMonth: null, unitPrice: 79_900, totalPrice: 79_900, standardUnitPrice: 79_900, standardTotalPrice: 79_900, source: 'list', name: null },
    ],
  }

  it('CPQ emits the merged fixed phases; the connector sends them in the create write', () => {
    const [payload] = mapItems([cpqItem('si-1', [internet], 79_900)], '2026-12-01')
    expect(payload).toMatchObject({
      sourceRef: 'cpq-sub-1-si-1-recurring',
      rateJson: { unit_price: 79_900 },
      phasesEnabled: true,
      phases: [
        { name: 'Free trial', durationUnit: 'month', durationCount: 1, priceType: 'fixed', value: 0 },
        { name: 'Promo 50%', durationUnit: 'month', durationCount: 2, priceType: 'fixed', value: 39_950 },
      ],
    })
    expect(payload.billingPeriodUnit).toBeUndefined()
  })

  it('invoices 1 Dec 0.00, 1 Jan 39,950, 1 Feb 39,950, 1 Mar 79,900', () => {
    const [payload] = mapItems([cpqItem('si-1', [internet], 79_900)], '2026-12-01')
    const runs = billRuns([{ state: engineState(payload) }], ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
    expect(runs.map((r) => r.total)).toEqual([0, 39_950, 39_950, 79_900])
    expect(runs.map((r) => r.lines.map((l) => [l.from, l.to, l.amount, l.phase]))).toEqual([
      [['2026-12-01', '2026-12-31', 0, 'Free trial']],
      [['2027-01-01', '2027-01-31', 39_950, 'Promo 50%']],
      [['2027-02-01', '2027-02-28', 39_950, 'Promo 50%']],
      [['2027-03-01', '2027-03-31', 79_900, null]],
    ])
  })
})

describe('CPQ → connector → billing: spec L yearly mobile plan on a monthly internet account', () => {
  const internet: StoredCharge = { chargeType: 'mrc', totalPrice: 79_900 }
  const mobile: StoredCharge = { chargeType: 'mrc', totalPrice: 480_000, billingPeriod: { unit: 'year', interval: 1 } }

  it('one CPQ item with a monthly and a yearly charge → two Billing Items, the monthly ref unchanged', () => {
    // Line MRC total = monthly equivalent: 79,900 + 480,000 / 12.
    const payloads = mapItems([cpqItem('si-1', [internet, mobile], 119_900)], '2026-12-10')
    expect(payloads.map((p) => [p.sourceRef, p.rateJson, p.billingPeriodUnit ?? null, p.billingPeriodInterval ?? null])).toEqual([
      ['cpq-sub-1-si-1-recurring', { unit_price: 79_900 }, null, null],
      ['cpq-sub-1-si-1-recurring-1y', { unit_price: 480_000 }, 'annually', 1],
    ])
  })

  it('invoices: Dec internet only; Jan internet + mobile 10 Dec – 9 Dec; Feb–Nov internet only; Dec again both', () => {
    const [internetItem] = mapItems([cpqItem('si-net', [internet], 79_900)], '2026-12-01')
    const [, mobileItem] = mapItems([cpqItem('si-mob', [internet, mobile], 119_900, 'Mobile')], '2026-12-10')
    expect(mobileItem.sourceRef).toBe('cpq-sub-1-si-mob-recurring-1y')
    const billDates = [
      '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01',
      '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01',
    ]
    const runs = billRuns(
      // The mobile plan is sold after the 1 Dec run ("Mobile doesn't exist yet").
      [{ state: engineState(internetItem) }, { state: engineState(mobileItem), from: '2026-12-02' }],
      billDates,
    )
    const shape = (r: (typeof runs)[number]) => r.lines.map((l) => [l.item.endsWith('-1y') ? 'mobile' : 'internet', l.from, l.to, l.amount])
    expect(shape(runs[0])).toEqual([['internet', '2026-12-01', '2026-12-31', 79_900]])
    expect(shape(runs[1])).toEqual([
      ['internet', '2027-01-01', '2027-01-31', 79_900],
      ['mobile', '2026-12-10', '2027-12-09', 480_000],
    ])
    for (const r of runs.slice(2, 12)) {
      expect(r.lines.map((l) => l.item)).toEqual(['cpq-sub-1-si-net-recurring'])
      expect(r.total).toBe(79_900)
    }
    expect(shape(runs[12])).toEqual([
      ['internet', '2027-12-01', '2027-12-31', 79_900],
      ['mobile', '2027-12-10', '2028-12-09', 480_000],
    ])
  })
})

describe('CPQ → connector → billing: pause, resume and terminate from the inventory', () => {
  const internet: StoredCharge = { chargeType: 'mrc', totalPrice: 79_900 }

  /** Applies a CPQ status event to the stored status periods, as the subscriber does. */
  function applyStatus(periods: ExistingStatusPeriod[], change: StatusChange): ExistingStatusPeriod[] {
    const plan = planStatusWrites([{ id: 'bi-1', type: 'recurring' }], periods, change)
    expect(plan.conflicts).toEqual([])
    let next = periods.map((p) => ({ ...p }))
    for (const write of plan.writes) {
      if (write.kind === 'create') {
        next.push({ id: `sp-${next.length + 1}`, billingItemId: 'bi-1', status: write.status, fromDate: write.fromDate, toDate: write.toDate })
      } else if (write.kind === 'update') {
        next = next.map((p) => (p.id === write.id ? { ...p, toDate: write.toDate } : p))
      } else {
        next = next.filter((p) => p.id !== write.id)
      }
    }
    return next
  }

  it('a January pause (no charge) is skipped, a replayed resume changes nothing, terminate prorates March', () => {
    const [payload] = mapItems([cpqItem('si-1', [internet], 79_900)], '2026-12-01')
    let periods = applyStatus([], { status: 'paused', fromDate: '2027-01-01', chargeBehavior: 'no_charge', reason: 'Holiday' })
    const resume: StatusChange = { status: 'active', fromDate: '2027-02-01' }
    periods = applyStatus(periods, resume)
    periods = applyStatus(periods, resume) // replayed delivery
    periods = applyStatus(periods, { status: 'paused', fromDate: '2027-01-01', chargeBehavior: 'no_charge', reason: 'Holiday' }) // replayed pause
    expect(periods.map((p) => [p.status, p.fromDate, p.toDate])).toEqual([['paused', '2027-01-01', '2027-01-31']])

    const [end] = buildTerminatedItemUpdates(
      [{ id: 'bi-1', billStartDate: payload.billStartDate, billEndDate: null }],
      { effectiveDate: '2027-03-15' },
    )
    expect(end.billEndDate).toBe('2027-03-14')

    const statusPeriods: ItemStatusPeriodState[] = periods.map((p) => ({
      id: p.id,
      status: p.status as ItemStatusPeriodState['status'],
      fromDate: p.fromDate,
      toDate: p.toDate ?? null,
      chargeBehavior: 'no_charge',
      appliedFrom: null,
      appliedTo: null,
    }))
    const runs = billRuns(
      [{ state: engineState(payload, { statusPeriods, billEndDate: d(String(end.billEndDate)) }) }],
      ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'],
    )
    expect(runs.map((r) => r.total)).toEqual([79_900, 0, 79_900, 36_083.87, 0])
    expect(runs[3].lines.map((l) => [l.from, l.to])).toEqual([['2027-03-01', '2027-03-14']])
  })
})
