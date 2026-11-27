import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingItemPhase, BillingItemStatusPeriod, type BillingItem } from '../data/entities'
import type { ItemBillingPeriod, ItemStatusPeriodState } from './servicePeriods'
import { resolvePhases, type PhaseDefinition, type ResolvedPhase } from './pricePhases'
import { toIsoDate } from './dateOnly'
import type { BillCycle } from './billCycle'

/**
 * Storage side of price phases and status periods: loading them for the
 * engines / reads, and building phase rows for the item commands. The pure
 * rules live in `pricePhases.ts`, `itemStatusPeriods.ts` and `servicePeriods.ts`.
 */

type Scope = { tenantId: string; organizationId: string }

export async function loadPhasesByItem(
  em: EntityManager,
  scope: Scope,
  itemIds: readonly string[],
): Promise<Map<string, BillingItemPhase[]>> {
  const map = new Map<string, BillingItemPhase[]>()
  if (itemIds.length === 0) return map
  const rows = (await em.find(
    BillingItemPhase,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, billingItemId: { $in: [...itemIds] }, deletedAt: null } as never,
    { orderBy: { sequence: 'asc' } } as never,
  )) as BillingItemPhase[]
  for (const row of rows) {
    const list = map.get(row.billingItemId) ?? []
    list.push(row)
    map.set(row.billingItemId, list)
  }
  return map
}

/** Status periods INCLUDING soft-deleted rows that still carry an applied range (the engine re-charges them). */
export async function loadStatusPeriodsByItem(
  em: EntityManager,
  scope: Scope,
  itemIds: readonly string[],
  options: { includeDeletedApplied?: boolean } = {},
): Promise<Map<string, BillingItemStatusPeriod[]>> {
  const map = new Map<string, BillingItemStatusPeriod[]>()
  if (itemIds.length === 0) return map
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    billingItemId: { $in: [...itemIds] },
  }
  if (options.includeDeletedApplied) where.$or = [{ deletedAt: null }, { appliedFrom: { $ne: null } }]
  else where.deletedAt = null
  const rows = (await em.find(BillingItemStatusPeriod, where as never, { orderBy: { fromDate: 'asc' } } as never)) as BillingItemStatusPeriod[]
  for (const row of rows) {
    const list = map.get(row.billingItemId) ?? []
    list.push(row)
    map.set(row.billingItemId, list)
  }
  return map
}

export function phaseRowToDefinition(row: BillingItemPhase): PhaseDefinition {
  return {
    id: row.id,
    name: row.name ?? null,
    durationUnit: row.durationUnit ?? null,
    durationCount: row.durationCount ?? null,
    endDate: row.endDate ? toIsoDate(row.endDate) : null,
    priceType: row.priceType,
    value: row.value ?? null,
  }
}

/** The item's resolved schedule as the engine sees it (empty when the switch is off). */
export function itemResolvedPhases(
  item: Pick<BillingItem, 'billStartDate' | 'phasesEnabled'>,
  rows: readonly BillingItemPhase[] | undefined,
): ResolvedPhase[] {
  if (!item.phasesEnabled || !rows || rows.length === 0) return []
  return resolvePhases(item.billStartDate, rows.map(phaseRowToDefinition))
}

export function itemBillingPeriod(item: Pick<BillingItem, 'billingPeriodUnit' | 'billingPeriodInterval'>): ItemBillingPeriod | null {
  if (!item.billingPeriodUnit) return null
  return { unit: item.billingPeriodUnit as BillCycle, interval: item.billingPeriodInterval ?? 1 }
}

export function statusRowToState(row: BillingItemStatusPeriod): ItemStatusPeriodState {
  return {
    id: row.id,
    status: row.status,
    fromDate: row.fromDate,
    toDate: row.toDate ?? null,
    chargeBehavior: row.chargeBehavior,
    reason: row.reason ?? null,
    appliedFrom: row.appliedFrom ?? null,
    appliedTo: row.appliedTo ?? null,
    deletedAt: row.deletedAt ?? null,
  }
}

/** New phase rows for `itemId` (ids assigned here so item + phases go in one flush). */
export function createPhaseRows(
  em: EntityManager,
  item: { id: string; tenantId: string; organizationId: string },
  phases: readonly PhaseDefinition[],
  now: Date = new Date(),
): BillingItemPhase[] {
  return phases.map((phase, sequence) => {
    const row = em.create(BillingItemPhase, {
      id: randomUUID(),
      organizationId: item.organizationId,
      tenantId: item.tenantId,
      billingItemId: item.id,
      sequence,
      name: phase.name?.trim() ? phase.name.trim() : null,
      durationUnit: phase.endDate ? null : (phase.durationUnit ?? null),
      durationCount: phase.endDate ? null : (phase.durationCount ?? null),
      endDate: phase.endDate ? toIsoDate(phase.endDate) : null,
      priceType: phase.priceType,
      value: phase.priceType === 'free' || phase.value === null || phase.value === undefined ? null : String(phase.value),
      createdAt: now,
      updatedAt: now,
    })
    em.persist(row)
    return row
  })
}

/** API projection of an item's phases with their computed dates (contract C1). */
export function serializePhases(
  item: Pick<BillingItem, 'billStartDate'>,
  rows: readonly BillingItemPhase[],
): Array<Record<string, unknown>> {
  const resolved = resolvePhases(item.billStartDate, rows.map(phaseRowToDefinition))
  return rows.map((row, index) => {
    const dates = resolved.find((p) => p.index === index)
    return {
      id: row.id,
      sequence: row.sequence,
      name: row.name ?? null,
      durationUnit: row.durationUnit ?? null,
      durationCount: row.durationCount ?? null,
      endDate: dates ? toIsoDate(dates.end) : row.endDate ? toIsoDate(row.endDate) : null,
      startDate: dates ? toIsoDate(dates.start) : null,
      untilDate: row.endDate ? toIsoDate(row.endDate) : null,
      priceType: row.priceType,
      value: row.value === null || row.value === undefined ? null : Number(row.value),
    }
  })
}

export function serializeStatusPeriod(row: BillingItemStatusPeriod): Record<string, unknown> {
  return {
    id: row.id,
    billingItemId: row.billingItemId,
    status: row.status,
    fromDate: toIsoDate(row.fromDate),
    toDate: row.toDate ? toIsoDate(row.toDate) : null,
    chargeBehavior: row.chargeBehavior,
    reason: row.reason ?? null,
    appliedFrom: row.appliedFrom ? toIsoDate(row.appliedFrom) : null,
    appliedTo: row.appliedTo ? toIsoDate(row.appliedTo) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
}
