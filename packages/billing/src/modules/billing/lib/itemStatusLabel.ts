import { statusOn, defaultChargeBehavior, type ItemStatus, type StatusChargeBehavior } from './itemStatusPeriods'
import type { PhasePriceType, PhaseDurationUnit } from './pricePhases'

/**
 * Pure helpers behind the line status / phase / own-period pills of the
 * billing item UI (line-period-and-status spec §4.2–4.3, price-phases spec
 * §4.1). They take the `GET /api/billing/items` row projection (`statusPeriods[]`,
 * `phases[]` with computed dates, `billing_period_unit` / `_interval`) and say
 * WHAT to show; the components translate it. No i18n, no React.
 */

/** `statusPeriods[]` entry of the items list API. */
export type StatusPeriodRow = {
  id: string
  status: ItemStatus
  fromDate: string
  toDate: string | null
  chargeBehavior: StatusChargeBehavior
  reason: string | null
}

/** `phases[]` entry of the items list API (computed dates inclusive). */
export type PhaseRow = {
  id: string
  sequence: number
  name: string | null
  durationUnit: PhaseDurationUnit | null
  durationCount: number | null
  untilDate: string | null
  startDate: string | null
  endDate: string | null
  priceType: PhasePriceType
  value: number | null
}

export type ItemStatusPill = {
  status: ItemStatus
  /** Last day of the status, or null when open-ended. */
  until: string | null
  /** True when the status removes the recurring charge for its days. */
  noCharge: boolean
  periodId: string
}

function day(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

/** The status in force on `today` (YYYY-MM-DD), or null when the line is active. */
export function currentStatusPill(periods: readonly StatusPeriodRow[] | null | undefined, today: string): ItemStatusPill | null {
  if (!periods || periods.length === 0) return null
  const current = statusOn(periods, today)
  if (!current) return null
  const behavior = current.chargeBehavior ?? defaultChargeBehavior(current.status)
  return {
    status: current.status,
    until: day(current.toDate),
    noCharge: current.status !== 'grace' && behavior === 'no_charge',
    periodId: current.id,
  }
}

/** The next status period that starts after `today`, if any (for "Pauses from …" hints). */
export function upcomingStatusPeriod(
  periods: readonly StatusPeriodRow[] | null | undefined,
  today: string,
): StatusPeriodRow | null {
  if (!periods) return null
  const future = periods.filter((p) => day(p.fromDate)! > today).sort((a, b) => a.fromDate.localeCompare(b.fromDate))
  return future[0] ?? null
}

/**
 * Earliest "resumes on" date for a status period (the day after its start):
 * resuming sets `toDate` = the day before the chosen date, and `toDate` may not
 * be before `fromDate`. A period that starts today or later is removed instead.
 */
export function minResumeDate(period: Pick<StatusPeriodRow, 'fromDate'>): string {
  return shiftIsoDay(day(period.fromDate)!, 1)
}

/** `YYYY-MM-DD` ± `days` (UTC calendar arithmetic). */
export function shiftIsoDay(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type ItemPhasePill = {
  /** 0-based position in the schedule. */
  index: number
  name: string | null
  priceType: PhasePriceType
  value: number | null
  /** Last day of the phase (inclusive). */
  endDate: string
  /** True when the phase has not started yet (today is before the schedule). */
  upcoming: boolean
}

/**
 * The phase in force on `today`, else the first phase still to come, else null
 * (the schedule is over — the regular price applies).
 */
export function currentPhasePill(
  phases: readonly PhaseRow[] | null | undefined,
  phasesEnabled: boolean | null | undefined,
  today: string,
): ItemPhasePill | null {
  if (!phasesEnabled || !phases || phases.length === 0) return null
  const dated = phases
    .filter((p) => p.startDate && p.endDate)
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
  const current = dated.find((p) => day(p.startDate)! <= today && today <= day(p.endDate)!)
  const pick = current ?? dated.find((p) => day(p.startDate)! > today)
  if (!pick) return null
  return {
    index: dated.indexOf(pick),
    name: pick.name,
    priceType: pick.priceType,
    value: pick.value,
    endDate: day(pick.endDate)!,
    upcoming: !current,
  }
}

const CYCLE_TO_UNIT = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' } as const
export type OwnPeriodUnit = (typeof CYCLE_TO_UNIT)[keyof typeof CYCLE_TO_UNIT]

/** "every N <unit>" for an item with its own billing period, or null (follows the account). */
export function ownBillingPeriod(
  unit: string | null | undefined,
  interval: number | string | null | undefined,
): { unit: OwnPeriodUnit; count: number } | null {
  if (!unit || !(unit in CYCLE_TO_UNIT)) return null
  const n = interval === null || interval === undefined || interval === '' ? 1 : Number(interval)
  return { unit: CYCLE_TO_UNIT[unit as keyof typeof CYCLE_TO_UNIT], count: Number.isInteger(n) && n >= 1 ? n : 1 }
}

/**
 * D6: a CPQ line (with a subscription id) gets its status from the CPQ
 * subscription — billing shows it read-only.
 */
export function isStatusReadOnly(item: { subscription_id?: string | null }): boolean {
  return Boolean(item.subscription_id && item.subscription_id.trim())
}
