import { toIsoDate } from './orderSetupResolution'

/**
 * CPQ item status → billing line status periods (spec
 * `2026-11-26-billing-line-period-and-status.md` §4.3, contract C3). Pure.
 *
 * `cpq.subscription_item.status_changed` carries the CPQ status of the
 * affected items from `fromDate`. CPQ owns the status of its lines (D6), so
 * billing's periods on a CPQ line follow CPQ's one-status-at-a-time model:
 *
 *   - **paused / suspended / grace** → a status period from `fromDate` (to
 *     `toDate`, or open). A period of another status still running on
 *     `fromDate` (e.g. grace → suspended) is closed at `fromDate − 1` first,
 *     so the two never overlap.
 *   - **active** (resume) → the item runs again from `fromDate`: the period
 *     in force on `fromDate` gets `toDate = fromDate − 1` (one starting on
 *     `fromDate` itself is removed — it never took effect). A period starting
 *     after `fromDate` is a later change and is never touched; with no period
 *     covering `fromDate` the resume is a no-op.
 *
 * Idempotent on replay: a period with the same status and `fromDate` already
 * there is the earlier delivery's, so nothing is written; after a resume no
 * period covers `fromDate`, so a replayed resume writes nothing either — even
 * when a later pause has been recorded since. A
 * period that cannot be reconciled (a different status already starting
 * inside the new period) is reported as a conflict instead of failing the
 * event on billing's overlap check.
 *
 * One-time items carry no status; items that ended before `fromDate` are
 * left alone.
 */

export type CpqItemStatus = 'paused' | 'suspended' | 'grace' | 'active'
export type StopStatus = Exclude<CpqItemStatus, 'active'>
export type ChargeBehavior = 'charge' | 'no_charge'

export type StatusChange = {
  status: CpqItemStatus
  fromDate: string
  toDate?: string | null
  chargeBehavior?: ChargeBehavior
  reason?: string | null
}

export type StatusTargetItem = {
  id: string
  type: string
  billEndDate?: Date | string | null
}

export type ExistingStatusPeriod = {
  id: string
  billingItemId: string
  status: string
  fromDate: Date | string
  toDate?: Date | string | null
  deletedAt?: Date | string | null
}

export type StatusWrite =
  | {
      kind: 'create'
      billingItemId: string
      status: StopStatus
      fromDate: string
      toDate: string | null
      chargeBehavior?: ChargeBehavior
      reason?: string | null
    }
  | { kind: 'update'; id: string; billingItemId: string; toDate: string }
  | { kind: 'delete'; id: string; billingItemId: string }

export type StatusConflict = {
  billingItemId: string
  periodId: string
  status: string
  fromDate: string
}

export type StatusPlan = { writes: StatusWrite[]; conflicts: StatusConflict[] }

function minusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const iso = (value: Date | string): string => toIsoDate(value) ?? String(value).slice(0, 10)
const isoOrNull = (value: Date | string | null | undefined): string | null => (value ? iso(value) : null)

/** The period still covers `day` or a later day (open, or ending on / after it). */
function reaches(period: ExistingStatusPeriod, day: string): boolean {
  const to = isoOrNull(period.toDate)
  return to === null || to >= day
}

function planItem(item: StatusTargetItem, periods: ExistingStatusPeriod[], change: StatusChange, plan: StatusPlan): void {
  const from = change.fromDate.slice(0, 10)
  const live = periods.filter((p) => p.billingItemId === item.id && !p.deletedAt)

  if (change.status === 'active') {
    // Only the period in force on `fromDate` is superseded. A period starting
    // after `fromDate` is a later status change (a late / replayed resume must
    // never undo it), so it is left alone.
    for (const period of live) {
      const pFrom = iso(period.fromDate)
      if (pFrom > from || !reaches(period, from)) continue
      if (pFrom < from) plan.writes.push({ kind: 'update', id: period.id, billingItemId: item.id, toDate: minusOneDay(from) })
      // Starts on `fromDate` itself: resumed the day it began, it never took effect.
      else plan.writes.push({ kind: 'delete', id: period.id, billingItemId: item.id })
    }
    return
  }

  const end = isoOrNull(item.billEndDate)
  if (end && end < from) return
  // Replay: the earlier delivery already wrote this period.
  if (live.some((p) => p.status === change.status && iso(p.fromDate) === from)) return

  const to = change.toDate ? change.toDate.slice(0, 10) : null
  const writes: StatusWrite[] = []
  for (const period of live) {
    const pFrom = iso(period.fromDate)
    if (pFrom < from) {
      // Another status still running on `fromDate`: it ends the day before.
      if (reaches(period, from)) writes.push({ kind: 'update', id: period.id, billingItemId: item.id, toDate: minusOneDay(from) })
      continue
    }
    // Starts on / after `fromDate`: a clash unless it lies after the new period.
    if (to === null || pFrom <= to) {
      plan.conflicts.push({ billingItemId: item.id, periodId: period.id, status: period.status, fromDate: pFrom })
      return
    }
  }
  plan.writes.push(...writes, {
    kind: 'create',
    billingItemId: item.id,
    status: change.status,
    fromDate: from,
    toDate: to,
    ...(change.chargeBehavior ? { chargeBehavior: change.chargeBehavior } : {}),
    reason: change.reason ?? null,
  })
}

/** The status-period writes that bring `items` to `change`. */
export function planStatusWrites(
  items: StatusTargetItem[],
  periods: ExistingStatusPeriod[],
  change: StatusChange,
): StatusPlan {
  const plan: StatusPlan = { writes: [], conflicts: [] }
  for (const item of items) {
    if (item.type === 'one_time') continue
    planItem(item, periods, change, plan)
  }
  return plan
}
