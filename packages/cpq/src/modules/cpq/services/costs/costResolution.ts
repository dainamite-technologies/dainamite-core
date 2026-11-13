import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CostLineErrorCode } from '../../data/costs'
import {
  CpqChargeCostElement,
  CpqOrderConfiguration,
  CpqPricingTable,
  CpqPricingTableEntry,
  CpqProductCharge,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
  type CpqQuoteConfiguration,
  type CpqQuoteLineConfiguration,
} from '../../data/entities'
import { isArcCancelledLine } from '../arcLineRemoval'
import { isFrozenAmendMirrorLine } from '../arcPriceFreeze'
import { evaluateApplicability } from '../cpqPricingService'
import { ADJUSTMENT_MUTABLE_STATUSES } from '../../data/price-adjustments'
import type { TenantScope } from '../types'
import { lookupTablePrice, type LookupEntry, type LookupModel } from './costLookup'

/**
 * Catalog cost resolution on SAVED recalculations (App Spec §1.4.7 R1, R3, R4,
 * R11, R14). Instantiates one `catalog` cost line per applicable active cost
 * element of each line's charges, keyed by `cost_key` (= element code), and
 * resolves its value. It never touches `charges` or any price: cost-plus pricing
 * reads these rows in a later step.
 */

export const COST_NOTE_MAX = 500

export type CostResolutionLine = {
  lineConfig: CpqQuoteLineConfiguration
  /** The configuration the pricing service resolves against (quote context + design-time values + line configuration). */
  mergedConfig: Record<string, unknown>
}

export type CostResolutionStats = { skipped: 'disabled' | 'locked' | null; created: number; updated: number; dropped: number }

type ActiveCostLock = { order: boolean; status: string }

/**
 * Cost lock (R11 / R4): the same rule as the price adjustments: an order exists
 * for the quote, or its status is outside `new | incomplete | ready`. Locked
 * quotes keep their stored cost lines and values.
 */
export async function isQuoteCostLocked(em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id' | 'cpqStatus'>, scope: TenantScope): Promise<boolean> {
  const state = await loadCostLock(em, quote, scope)
  return state.order || !ADJUSTMENT_MUTABLE_STATUSES.includes(state.status)
}

async function loadCostLock(em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id' | 'cpqStatus'>, scope: TenantScope): Promise<ActiveCostLock> {
  const orders = await em.count(CpqOrderConfiguration, { sourceQuoteId: quote.id, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
  return { order: orders > 0, status: quote.cpqStatus }
}

const round4 = (value: number) => (Math.round((value + Number.EPSILON) * 10_000) / 10_000)
const money = (value: number) => String(round4(value))
const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })

type ResolvedValue = {
  valueStatus: 'none' | 'estimated' | 'confirmed'
  valueOrigin: 'catalog' | null
  unitAmount: string | null
  instanceAmount: string | null
  currencyCode: string | null
  errorCode: CostLineErrorCode | null
}

const NO_VALUE: ResolvedValue = { valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, currencyCode: null, errorCode: null }

/** Driver attributes of an element: its applicability attribute (table dimensions are added by the caller). */
function driverAttributes(element: CpqChargeCostElement, table: CpqPricingTable | null): string[] {
  const attributes = new Set<string>()
  const attribute = element.applicabilityCondition?.attribute
  if (typeof attribute === 'string' && attribute) attributes.add(attribute)
  for (const dimension of table?.dimensions ?? []) attributes.add(dimension.key)
  return [...attributes].sort()
}

function driverHash(attributes: string[], configuration: Record<string, unknown>): string {
  const values = Object.fromEntries(attributes.map((key) => [key, String(configuration[key] ?? '')]))
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}

function quantityOf(charge: CpqProductCharge, configuration: Record<string, unknown>): number {
  const quantity = Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0)
  return Number.isFinite(quantity) ? quantity : 0
}

function resolveValue(
  element: CpqChargeCostElement,
  charge: CpqProductCharge,
  table: { dimensions: Array<{ key: string }>; entries: CpqPricingTableEntry[] } | null,
  configuration: Record<string, unknown>,
  quoteCurrency: string,
): ResolvedValue {
  const quantity = element.costModel === 'flat' ? 1 : quantityOf(charge, configuration)
  const instanceOf = (unit: number) => (element.costModel === 'per_unit' ? unit * quantity : unit)

  if (element.source === 'fixed') {
    if (element.amount === null || element.amount === undefined) return NO_VALUE
    // No FX before the FX feature: never a silent 1:1 conversion (R3).
    if (element.currencyCode !== quoteCurrency) return { ...NO_VALUE, errorCode: 'CURRENCY_NO_RATE' }
    const unit = Number(element.amount)
    return { valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: money(unit), instanceAmount: money(instanceOf(unit)), currencyCode: quoteCurrency, errorCode: null }
  }

  if (element.source === 'table') {
    if (!table || !element.costColumnKey) return { ...NO_VALUE, errorCode: 'TABLE_NO_MATCH' }
    const lookupTable = { dimensions: table.dimensions, entries: table.entries as LookupEntry[] }
    const model = element.costModel as LookupModel
    const inQuoteCurrency = lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity, quoteCurrency)
    if (inQuoteCurrency.outcome === 'miss') {
      const anyCurrency = lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity)
      return { ...NO_VALUE, errorCode: anyCurrency.outcome === 'miss' ? 'TABLE_NO_MATCH' : 'CURRENCY_NO_RATE' }
    }
    if (inQuoteCurrency.outcome === 'zero_quantity') {
      return { valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: money(0), instanceAmount: money(0), currencyCode: quoteCurrency, errorCode: null }
    }
    return {
      valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: money(inQuoteCurrency.unitPrice),
      instanceAmount: money(inQuoteCurrency.totalPrice), currencyCode: quoteCurrency, errorCode: null,
    }
  }

  // on_request: the catalog estimate (Q-D2), else no value.
  if (element.estimateAmount === null || element.estimateAmount === undefined) return NO_VALUE
  if (element.currencyCode !== quoteCurrency) return { ...NO_VALUE, errorCode: 'CURRENCY_NO_RATE' }
  const estimate = Number(element.estimateAmount)
  return { valueStatus: 'estimated', valueOrigin: 'catalog', unitAmount: money(estimate), instanceAmount: money(instanceOf(estimate)), currencyCode: quoteCurrency, errorCode: null }
}

const truncate = (text: string) => (text.length > COST_NOTE_MAX ? text.slice(0, COST_NOTE_MAX) : text)

/** R1b: the previous value moves into the note (appended to any existing note). */
function resetNote(row: CpqQuoteLineCost, attributes: string[]): string {
  const previous = row.unitAmount === null ? 'no value' : `${row.unitAmount} ${row.currencyCode ?? ''}`.trim()
  const reason = `Reset: ${attributes.join(', ') || 'a driving attribute'} changed. Previous value ${previous} (${row.valueStatus}).`
  return truncate(row.note ? `${reason} ${row.note}` : reason)
}

export type CostResolutionParams = {
  em: EntityManager
  quote: Pick<CpqQuoteConfiguration, 'id' | 'quoteId' | 'cpqStatus' | 'quoteType' | 'currencyCode'>
  lines: CostResolutionLine[]
  scope: TenantScope
  /** `CpqCostService.enabled` (R14). */
  isEnabled: (tenantId: string) => Promise<boolean>
}

/** What cost-plus pricing reads from a cost line (plain values, safe to hand around without persisting). */
export type CostLineValue = {
  quoteLineId: string
  chargeCode: string | null
  costKey: string
  role: string
  valueStatus: string
  instanceAmount: string | null
  errorCode: string | null
}

export type MarkupOverrideValue = { markupRule: string; markupValue: string }

type RowPatch = Record<string, unknown>
type CostPlan = {
  stats: CostResolutionStats
  creates: Array<Record<string, unknown>>
  updates: Array<{ row: CpqQuoteLineCost; patch: RowPatch }>
  drops: CpqQuoteLineCost[]
  existing: CpqQuoteLineCost[]
}

const toCostLineValue = (source: Record<string, unknown>): CostLineValue => ({
  quoteLineId: source.quoteLineId as string,
  chargeCode: (source.chargeCode as string | null | undefined) ?? null,
  costKey: source.costKey as string,
  role: source.role as string,
  valueStatus: source.valueStatus as string,
  instanceAmount: (source.instanceAmount as string | null | undefined) ?? null,
  errorCode: (source.errorCode as string | null | undefined) ?? null,
})

export async function resolveQuoteCosts(params: CostResolutionParams): Promise<CostResolutionStats> {
  const { em, quote, scope } = params
  // R14: toggle off = no reads beyond the toggle check.
  if (!(await params.isEnabled(scope.tenantId))) return { skipped: 'disabled', created: 0, updated: 0, dropped: 0 }
  // R4 / R11: a locked quote keeps stored cost lines and values.
  if (await isQuoteCostLocked(em, quote, scope)) return { skipped: 'locked', created: 0, updated: 0, dropped: 0 }
  const plan = await planQuoteCosts(params)
  await applyCostPlan(em, plan)
  return plan.stats
}

export type CostPlusInputs = {
  enabled: boolean
  /** Cost lines per quote line: the values the pricing step reads. */
  costsByLine: Map<string, CostLineValue[]>
  /** Markup overrides keyed by `markupOverrideKey(lineId, chargeCode)`. */
  overrides: Map<string, MarkupOverrideValue>
}

export const markupOverrideKey = (quoteLineId: string, chargeCode: string) => `${quoteLineId}\u0000${chargeCode}`

/**
 * The cost inputs of cost-plus pricing for one recalculation. Previews and saves
 * see the same values: unlocked quotes resolve catalog costs (persisted only
 * when `save`; a preview computes the same plan in memory and writes nothing),
 * locked quotes read the stored lines (R4: values frozen). Toggle off (R14):
 * nothing is read and `enabled` is false.
 */
export async function resolveCostPlusInputs(params: CostResolutionParams & { save: boolean }): Promise<CostPlusInputs> {
  const { em, quote, scope } = params
  const empty: CostPlusInputs = { enabled: false, costsByLine: new Map(), overrides: new Map() }
  if (!(await params.isEnabled(scope.tenantId))) return empty

  const costsByLine = new Map<string, CostLineValue[]>()
  const add = (value: CostLineValue) => costsByLine.set(value.quoteLineId, [...(costsByLine.get(value.quoteLineId) ?? []), value])
  if (await isQuoteCostLocked(em, quote, scope)) {
    const stored = await em.find(CpqQuoteLineCost, { ...scoped(scope), quoteConfigurationId: quote.id })
    for (const row of stored) add(toCostLineValue(row as unknown as Record<string, unknown>))
  } else {
    const plan = await planQuoteCosts(params)
    if (params.save) await applyCostPlan(em, plan)
    const patchByRow = new Map(plan.updates.map(({ row, patch }) => [row, patch]))
    const dropped = new Set(plan.drops)
    for (const row of plan.existing) {
      if (dropped.has(row)) continue
      add(toCostLineValue({ ...(row as unknown as Record<string, unknown>), ...(patchByRow.get(row) ?? {}) }))
    }
    for (const data of plan.creates) add(toCostLineValue(data))
  }

  const overrides = new Map<string, MarkupOverrideValue>()
  const rows = await em.find(CpqQuoteMarkupOverride, { ...scoped(scope), quoteConfigurationId: quote.id })
  for (const row of rows) overrides.set(markupOverrideKey(row.quoteLineId, row.chargeCode), { markupRule: row.markupRule, markupValue: row.markupValue })
  return { enabled: true, costsByLine, overrides }
}

async function applyCostPlan(em: EntityManager, plan: CostPlan): Promise<void> {
  const { creates, updates, drops } = plan
  if (creates.length === 0 && updates.length === 0 && drops.length === 0) return
  const now = new Date()
  await withAtomicFlush(em, [
    () => {
      for (const data of creates) em.persist(em.create(CpqQuoteLineCost, data as never))
      for (const { row, patch } of updates) Object.assign(row, patch)
      for (const row of drops) row.deletedAt = now
    },
  ])
}

/** Reads and computes only: nothing is persisted or mutated here. */
async function planQuoteCosts(params: CostResolutionParams): Promise<CostPlan> {
  const { em, quote, scope } = params
  const stats: CostResolutionStats = { skipped: null, created: 0, updated: 0, dropped: 0 }

  // R1c: cancelled lines and frozen Amend mirror lines (unreconfigured) are never re-instantiated from the catalog.
  const lines = params.lines.filter(({ lineConfig }) => (lineConfig.offeringId || lineConfig.productId)
    && !isArcCancelledLine(lineConfig, quote.quoteType)
    && !isFrozenAmendMirrorLine(lineConfig.configuration, quote.quoteType))

  // ── Reads first (no mutation before the last query) ──
  const existing = await em.find(CpqQuoteLineCost, { ...scoped(scope), quoteConfigurationId: quote.id })
  if (lines.length === 0) return { stats, creates: [], updates: [], drops: [], existing }
  const existingByLine = new Map<string, CpqQuoteLineCost[]>()
  for (const row of existing) existingByLine.set(row.quoteLineId, [...(existingByLine.get(row.quoteLineId) ?? []), row])

  const chargesByOwner = new Map<string, CpqProductCharge[]>()
  for (const { lineConfig } of lines) {
    const ownerKey = lineConfig.offeringId ? `o:${lineConfig.offeringId}` : `p:${lineConfig.productId}`
    if (chargesByOwner.has(ownerKey)) continue
    chargesByOwner.set(ownerKey, await em.find(CpqProductCharge, {
      ...scoped(scope), isActive: true,
      ...(lineConfig.offeringId ? { offeringId: lineConfig.offeringId } : { productId: lineConfig.productId }),
    }, { orderBy: { sortOrder: 'asc' } }))
  }
  const chargeIds = [...new Set([...chargesByOwner.values()].flat().map((charge) => charge.id))]
  const elements = chargeIds.length
    ? await em.find(CpqChargeCostElement, { ...scoped(scope), isActive: true, productChargeId: { $in: chargeIds } }, { orderBy: { sortOrder: 'asc', code: 'asc' } })
    : []
  const elementsByCharge = new Map<string, CpqChargeCostElement[]>()
  for (const element of elements) elementsByCharge.set(element.productChargeId, [...(elementsByCharge.get(element.productChargeId) ?? []), element])

  const tableIds = [...new Set(elements.filter((element) => element.source === 'table' && element.costTableId).map((element) => element.costTableId as string))]
  const tables = tableIds.length ? await em.find(CpqPricingTable, { ...scoped(scope), id: { $in: tableIds } }) : []
  const entries = tableIds.length
    ? await em.find(CpqPricingTableEntry, { ...scoped(scope), isActive: true, pricingTableId: { $in: tableIds } })
    : []
  const tableById = new Map(tables.map((table) => [table.id, {
    table, dimensions: table.dimensions, entries: entries.filter((entry) => entry.pricingTableId === table.id),
  }]))

  // ── Compute ──
  const creates: CostPlan['creates'] = []
  const updates: CostPlan['updates'] = []
  const drops: CostPlan['drops'] = []
  for (const { lineConfig, mergedConfig } of lines) {
    const rows = existingByLine.get(lineConfig.quoteLineId) ?? []
    const rowByKey = new Map(rows.map((row) => [row.costKey, row]))
    const desiredKeys = new Set<string>()
    const ownerCharges = chargesByOwner.get(lineConfig.offeringId ? `o:${lineConfig.offeringId}` : `p:${lineConfig.productId}`) ?? []

    for (const charge of ownerCharges) {
      if (!evaluateApplicability(charge.applicabilityCondition, mergedConfig)) continue
      for (const element of elementsByCharge.get(charge.id) ?? []) {
        if (!evaluateApplicability(element.applicabilityCondition, mergedConfig)) continue
        // I-1: one cost line per cost key on a line. Element codes are unique across the charges
        // priced together (DUPLICATE_CODE at catalog write); should a concurrent write slip a
        // duplicate through, the first element in charge / sort order wins deterministically.
        if (desiredKeys.has(element.code)) continue
        desiredKeys.add(element.code)
        const row = rowByKey.get(element.code)
        // Manual lines are never touched, even when a catalog element later claims their key.
        if (row?.origin === 'manual') continue

        const tableEntry = element.costTableId ? tableById.get(element.costTableId) ?? null : null
        const attributes = driverAttributes(element, tableEntry?.table ?? null)
        const hash = driverHash(attributes, mergedConfig)
        const resolved = resolveValue(element, charge, tableEntry, mergedConfig, quote.currencyCode)
        const structure = {
          chargeCode: charge.code, costElementId: element.id, name: element.name, role: element.role,
          costType: element.costType, source: element.source, costModel: element.costModel,
        }

        if (!row) {
          creates.push({
            ...scope, quoteConfigurationId: quote.id, quoteId: quote.quoteId, quoteLineId: lineConfig.quoteLineId,
            costKey: element.code, origin: 'catalog', ...structure, ...toFields(resolved), driverHash: hash, sourcingStatus: 'not_requested',
          })
          stats.created += 1
          continue
        }

        const patch: RowPatch = { ...structure }
        if (element.source === 'on_request') {
          // R1b: a driving attribute changed since the value was set: reset it, keep the old value in the note.
          const driversChanged = row.driverHash !== null && row.driverHash !== hash
          if (driversChanged && row.valueStatus !== 'none') patch.note = resetNote(row, attributes)
          // Entered values (manual) survive unless a driver changed; catalog estimates follow the catalog.
          if (driversChanged || row.valueOrigin !== 'manual') Object.assign(patch, toFields(resolved))
        } else {
          // fixed / table values come from the catalog on every saved recalculation while unlocked (R4).
          Object.assign(patch, toFields(resolved))
        }
        patch.driverHash = hash
        updates.push({ row, patch })
        stats.updated += 1
      }
    }

    // R1a: catalog lines whose element is gone / inactive / no longer applicable are dropped (manual lines untouched).
    for (const row of rows) {
      if (row.origin !== 'catalog' || desiredKeys.has(row.costKey)) continue
      drops.push(row)
      stats.dropped += 1
    }
  }
  return { stats, creates, updates, drops, existing }
}

function toFields(value: ResolvedValue) {
  return {
    valueStatus: value.valueStatus, valueOrigin: value.valueOrigin, unitAmount: value.unitAmount,
    instanceAmount: value.instanceAmount, currencyCode: value.currencyCode, errorCode: value.errorCode,
  }
}
