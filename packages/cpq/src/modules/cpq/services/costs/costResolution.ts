import { createHash, randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { CostLineErrorCode } from '../../data/costs'
import {
  CpqChargeCostElement,
  CpqCostIndex,
  CpqOrderConfiguration,
  CpqPricingTable,
  CpqPricingTableEntry,
  CpqProductCharge,
  CpqQuoteLineCost,
  CpqQuoteMarkupOverride,
  CpqQuoteTargetSubscription,
  type CpqQuoteConfiguration,
  type CpqQuoteLineConfiguration,
} from '../../data/entities'
import { isArcCancelledLine } from '../arcLineRemoval'
import { isArcMirrorLine, isArcReconfigured, isCostManagedRenewLine } from '../arcPriceFreeze'
import { reconcileRenewLine, type ReevaluateCarriedIndexCosts, type RenewCostRow } from './arcCostCarry'
import { evaluateApplicability } from '../cpqPricingService'
import { ADJUSTMENT_MUTABLE_STATUSES } from '../../data/price-adjustments'
import type { TenantScope } from '../types'
import { lookupTablePrice, type LookupEntry, type LookupModel } from './costLookup'
import { shouldAutoOpenRequest, type CancelReason } from './costSourcing'
import { cancelRequestPatch, isRequestOpen, openRequestPatch, type RequestRowState } from './costRequestState'
import { sourcingCostRef, type SourcingSignal } from './sourcingSignals'
import type { CpqFxRateResolver } from './fxRateResolver'
import { loadValuesInForce, resolveIndexCost, type IndexCostResult, type IndexSnapshot } from './indexCostResolution'

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

/** The FX snapshot columns of a cost line: all null or all set (FX spec §Data Model invariants). */
type FxFields = { fxRate: string | null; fxRateDate: string | null; fxRateSource: string | null; fxRateDerivation: string | null }
const NO_FX: FxFields = { fxRate: null, fxRateDate: null, fxRateSource: null, fxRateDerivation: null }
/** Rate for one cost currency into the quote currency, or `null` when none is available (never a 1:1 conversion). */
type FxLookup = (currency: string) => Promise<FxFields | typeof FX_ERROR | null>
/** A transient resolver failure (`reason: 'error'`): distinct from "no rate", so a stored snapshot is not demoted. */
const FX_ERROR = Symbol('cpq.fx.error')

type ResolvedValue = FxFields & {
  valueStatus: 'none' | 'estimated' | 'confirmed'
  valueOrigin: 'catalog' | null
  unitAmount: string | null
  instanceAmount: string | null
  currencyCode: string | null
  errorCode: CostLineErrorCode | null
  /** Set by `index` elements only (`null` = no value in force); `undefined` for every other source. */
  indexSnapshot?: IndexSnapshot | null
}

/** A value that is not the catalog's: entered by a user, answered by a supplier, or carried from the subscription item (it survives a recalculation until a driving attribute changes). */
const isEnteredOrigin = (origin: string | null | undefined): boolean => origin === 'manual' || origin === 'supplier' || origin === 'carried'

const NO_VALUE: ResolvedValue = { valueStatus: 'none', valueOrigin: null, unitAmount: null, instanceAmount: null, currencyCode: null, errorCode: null, ...NO_FX }

/** Driver attributes of an element: its applicability attribute (table dimensions are added by the caller). */
export function driverAttributes(element: CpqChargeCostElement, table: CpqPricingTable | null): string[] {
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

async function resolveValue(
  element: CpqChargeCostElement,
  charge: CpqProductCharge,
  table: { dimensions: Array<{ key: string }>; entries: CpqPricingTableEntry[] } | null,
  configuration: Record<string, unknown>,
  quoteCurrency: string,
  lookup: FxLookup,
  indexCost: IndexCostResult | null,
): Promise<ResolvedValue> {
  const quantity = element.costModel === 'flat' ? 1 : quantityOf(charge, configuration)
  const instanceOf = (unit: number) => (element.costModel === 'per_unit' ? unit * quantity : unit)
  const inQuote = (status: 'confirmed' | 'estimated', unit: number, instance: number): ResolvedValue => ({
    valueStatus: status, valueOrigin: 'catalog', unitAmount: money(unit), instanceAmount: money(instance), currencyCode: quoteCurrency, errorCode: null, ...NO_FX,
  })
  // A cost in another currency keeps its own amount and currency; the rate is a snapshot beside it (FX spec §Proposed Solution).
  // No rate: `none` + CURRENCY_NO_RATE with the unit amount and currency kept, never a 1:1 conversion (R3).
  const foreign = async (status: 'confirmed' | 'estimated', currency: string, unit: number, instance: number): Promise<ResolvedValue> => {
    const fx = await lookup(currency)
    if (!fx || fx === FX_ERROR) {
      return { valueStatus: 'none', valueOrigin: 'catalog', unitAmount: money(unit), instanceAmount: null, currencyCode: currency, errorCode: 'CURRENCY_NO_RATE', ...NO_FX }
    }
    return { valueStatus: status, valueOrigin: 'catalog', unitAmount: money(unit), instanceAmount: money(instance), currencyCode: currency, errorCode: null, ...fx }
  }

  if (element.source === 'index') {
    // No value in force (or no index): none + INDEX_NO_VALUE, no snapshot; the line is not ready (R4).
    if (!indexCost || !indexCost.ok) return { ...NO_VALUE, errorCode: 'INDEX_NO_VALUE', indexSnapshot: null }
    const unit = Number(indexCost.unitAmount)
    const instance = instanceOf(unit)
    // R3: the index currency is the cost currency; another currency than the quote's goes through the FX resolver (never 1:1).
    const resolved = indexCost.currencyCode === quoteCurrency
      ? inQuote('confirmed', unit, instance)
      : await foreign('confirmed', indexCost.currencyCode, unit, instance)
    return { ...resolved, indexSnapshot: indexCost.snapshot }
  }

  if (element.source === 'fixed') {
    if (element.amount === null || element.amount === undefined) return NO_VALUE
    const unit = Number(element.amount)
    if (element.currencyCode === quoteCurrency) return inQuote('confirmed', unit, instanceOf(unit))
    if (!element.currencyCode) return { ...NO_VALUE, errorCode: 'CURRENCY_NO_RATE' }
    return foreign('confirmed', element.currencyCode, unit, instanceOf(unit))
  }

  if (element.source === 'table') {
    if (!table || !element.costColumnKey) return { ...NO_VALUE, errorCode: 'TABLE_NO_MATCH' }
    const lookupTable = { dimensions: table.dimensions, entries: table.entries as LookupEntry[] }
    const model = element.costModel as LookupModel
    // R5: a matching row without the element's cost column is an unknown cost, never a confirmed 0.
    const strict = { requireColumn: true }
    // Q10 precedence: an entry in the quote currency always wins (no FX columns).
    const inQuoteCurrency = lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity, quoteCurrency, strict)
    if (inQuoteCurrency.outcome === 'miss') {
      // Otherwise the element's currency is the fallback table currency, converted.
      const rowInQuoteCurrency = lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity, quoteCurrency).outcome !== 'miss'
      const fallbackCurrency = element.currencyCode && element.currencyCode !== quoteCurrency ? element.currencyCode : null
      if (!rowInQuoteCurrency && fallbackCurrency) {
        const inFallback = lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity, fallbackCurrency, strict)
        // A zero cost converts to zero at any rate, so it needs no rate: confirmed 0 in the cost currency, no snapshot.
        if (inFallback.outcome === 'zero_quantity') return { valueStatus: 'confirmed', valueOrigin: 'catalog', unitAmount: money(0), instanceAmount: money(0), currencyCode: fallbackCurrency, errorCode: null, ...NO_FX }
        if (inFallback.outcome !== 'miss') return foreign('confirmed', fallbackCurrency, inFallback.unitPrice, inFallback.totalPrice)
      }
      // CURRENCY_NO_RATE only when the quote currency has no matching row at all and another currency prices it.
      const anyCurrency = rowInQuoteCurrency ? null : lookupTablePrice(lookupTable, element.costColumnKey, model, configuration, quantity, undefined, strict)
      return { ...NO_VALUE, errorCode: !anyCurrency || anyCurrency.outcome === 'miss' ? 'TABLE_NO_MATCH' : 'CURRENCY_NO_RATE' }
    }
    if (inQuoteCurrency.outcome === 'zero_quantity') return inQuote('confirmed', 0, 0)
    return inQuote('confirmed', inQuoteCurrency.unitPrice, inQuoteCurrency.totalPrice)
  }

  // on_request: the catalog estimate (Q-D2), else no value.
  if (element.estimateAmount === null || element.estimateAmount === undefined) return NO_VALUE
  const estimate = Number(element.estimateAmount)
  if (element.currencyCode === quoteCurrency) return inQuote('estimated', estimate, instanceOf(estimate))
  if (!element.currencyCode) return { ...NO_VALUE, errorCode: 'CURRENCY_NO_RATE' }
  return foreign('estimated', element.currencyCode, estimate, instanceOf(estimate))
}

/**
 * FX snapshot of a value a person entered or a supplier answered (origin `manual` / `supplier`), which stays in its own
 * currency (spec Q6 / Q13). Rate found: the snapshot is stored; a value that had no rate (`none` + CURRENCY_NO_RATE, the PR #95
 * supplier answer or a manual foreign value) becomes `estimated` with a note, because the status entered is not kept
 * (it was stored as `none`) and nobody has seen the converted price: a pricing manager confirms it (R7). No rate: `none` +
 * CURRENCY_NO_RATE, the entered amount and currency kept. A value in the quote currency carries no FX columns.
 */
async function enteredFxPatch(row: CpqQuoteLineCost, quoteCurrency: string, lookup: FxLookup): Promise<RowPatch> {
  if (row.unitAmount === null || row.unitAmount === undefined || !row.currencyCode) return {}
  if (row.currencyCode === quoteCurrency) return row.fxRate === null || row.fxRate === undefined ? {} : { ...NO_FX }
  const fx = await lookup(row.currencyCode)
  if (fx === FX_ERROR && row.fxRate !== null && row.fxRate !== undefined && row.valueStatus !== 'none') {
    // Transient lookup failure: keep the stored snapshot and status (no demotion); the next recalculation retries.
    console.warn(`[cpq.fx] rate lookup ${row.currencyCode}>${quoteCurrency} failed; kept the stored snapshot of a cost line`)
    return {}
  }
  // Like every other no-rate write the instance amount is cleared, so no stored row can ever be read 1:1.
  if (!fx || fx === FX_ERROR) return { ...NO_FX, valueStatus: 'none', errorCode: 'CURRENCY_NO_RATE', instanceAmount: null }
  const patch: RowPatch = { ...fx }
  if (row.valueStatus === 'none' && row.errorCode === 'CURRENCY_NO_RATE') {
    patch.valueStatus = 'estimated'
    patch.errorCode = null
    patch.note = truncate(row.note ? `${RATE_APPLIED_NOTE} ${row.note}` : RATE_APPLIED_NOTE)
  }
  return patch
}

const RATE_APPLIED_NOTE = 'Rate applied after entry.'

const truncate = (text: string) => (text.length > COST_NOTE_MAX ? text.slice(0, COST_NOTE_MAX) : text)

/** R1b: the previous value moves into the note (appended to any existing note). */
function resetNote(row: CpqQuoteLineCost, attributes: string[]): string {
  const previous = row.unitAmount === null ? 'no value' : `${row.unitAmount} ${row.currencyCode ?? ''}`.trim()
  const reason = `Reset: ${attributes.join(', ') || 'a driving attribute'} changed. Previous value ${previous} (${row.valueStatus}).`
  return truncate(row.note ? `${reason} ${row.note}` : reason)
}

export type CostResolutionParams = {
  /** Dated FX rates for foreign-currency costs (FX spec); absent = none (every foreign cost is CURRENCY_NO_RATE). */
  fxResolver?: CpqFxRateResolver
  em: EntityManager
  quote: Pick<CpqQuoteConfiguration, 'id' | 'quoteId' | 'cpqStatus' | 'quoteType' | 'currencyCode'>
  lines: CostResolutionLine[]
  scope: TenantScope
  /** `CpqCostService.enabled` (R14). */
  isEnabled: (tenantId: string) => Promise<boolean>
  /** The user behind a saved recalculation: recorded as `requested_by_user_id` of an auto-opened request (Q5). */
  actorUserId?: string | null
  /** Receives one signal per request opened / cancelled by a SAVED recalculation (seam of the sourcing events, step 12). */
  signals?: SourcingSignal[]
  /**
   * Q12 auto-open on this saved recalculation (default true). A clone's first recalculation passes `false`: the copy
   * re-resolves its catalog costs but opens no request (spec "Clone": the cloned tail is `not_requested`, R16).
   */
  autoOpen?: boolean
  /**
   * Date of the recalculation (`YYYY-MM-DD`, UTC): the day index values are read at (index-costs spec Q6). Absent = today
   * (UTC).
   */
  asOfDate?: string
  /**
   * Whether this recalculation may store resolved values / snapshots: a SAVED recalculation of an unlocked quote
   * (no order, status `new | incomplete | ready`). Computed by the caller from the same lock predicate as the resolver.
   * Only `false` is acted on: it forbids writing even a computed plan (absent = the `save` flag decides, as before).
   */
  persist?: boolean
  /** Test seam / the index-costs feature: the second step of Renew reconciliation (default: the no-op `reevaluateCarriedIndexCosts`). */
  reevaluateCarriedIndexCosts?: ReevaluateCarriedIndexCosts
}

/** What cost-plus pricing reads from a cost line (plain values, safe to hand around without persisting). */
export type CostLineValue = {
  quoteLineId: string
  chargeCode: string | null
  costKey: string
  role: string
  valueStatus: string
  instanceAmount: string | null
  /** FX snapshot (cost currency into the quote currency); null for a cost in the quote currency. */
  fxRate: string | null
  errorCode: string | null
}

export type MarkupOverrideValue = { markupRule: string; markupValue: string }

type RowPatch = Record<string, unknown>
type CostPlan = {
  stats: CostResolutionStats
  creates: Array<Record<string, unknown>>
  updates: Array<{ row: CpqQuoteLineCost; patch: RowPatch }>
  drops: CpqQuoteLineCost[]
  /** Open requests cancelled by a drop (R1a / line removal), applied with the drop. */
  dropCancels: Array<{ row: CpqQuoteLineCost; patch: RowPatch }>
  /** Request opened / cancelled by this plan, published only when the plan is applied. */
  signals: SourcingSignal[]
  existing: CpqQuoteLineCost[]
}

const toCostLineValue = (source: Record<string, unknown>): CostLineValue => ({
  quoteLineId: source.quoteLineId as string,
  chargeCode: (source.chargeCode as string | null | undefined) ?? null,
  costKey: source.costKey as string,
  role: source.role as string,
  valueStatus: source.valueStatus as string,
  instanceAmount: (source.instanceAmount as string | null | undefined) ?? null,
  fxRate: (source.fxRate as string | null | undefined) ?? null,
  errorCode: (source.errorCode as string | null | undefined) ?? null,
})

export async function resolveQuoteCosts(params: CostResolutionParams): Promise<CostResolutionStats> {
  const { em, quote, scope } = params
  // R14: toggle off = no reads beyond the toggle check.
  if (!(await params.isEnabled(scope.tenantId))) return { skipped: 'disabled', created: 0, updated: 0, dropped: 0 }
  // R4 / R11: a locked quote keeps stored cost lines and values.
  if (await isQuoteCostLocked(em, quote, scope)) return { skipped: 'locked', created: 0, updated: 0, dropped: 0 }
  const plan = await planQuoteCosts({ ...params, save: true })
  await applyCostPlan(em, plan, params.signals)
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
    if (params.save && params.persist !== false) await applyCostPlan(em, plan, params.signals)
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

/**
 * Catalog cost lines a configuration WOULD get, computed in memory (cost preview):
 * nothing is read from or written to a quote, no toggle or lock check.
 */
export async function previewCatalogCosts(params: Omit<CostResolutionParams, 'isEnabled'>): Promise<Array<Record<string, unknown>>> {
  const plan = await planQuoteCosts({ ...params, isEnabled: async () => true })
  return plan.creates
}

async function applyCostPlan(em: EntityManager, plan: CostPlan, signals?: SourcingSignal[]): Promise<void> {
  const { creates, updates, drops, dropCancels } = plan
  if (creates.length === 0 && updates.length === 0 && drops.length === 0) return
  const now = new Date()
  await withAtomicFlush(em, [
    () => {
      for (const data of creates) em.persist(em.create(CpqQuoteLineCost, data as never))
      for (const { row, patch } of updates) Object.assign(row, patch)
      for (const { row, patch } of dropCancels) Object.assign(row, patch)
      for (const row of drops) row.deletedAt = now
    },
  ])
  signals?.push(...plan.signals)
}

/** Reads and computes only: nothing is persisted or mutated here. */
async function planQuoteCosts(params: CostResolutionParams & { save?: boolean }): Promise<CostPlan> {
  const { em, quote, scope } = params
  const stats: CostResolutionStats = { skipped: null, created: 0, updated: 0, dropped: 0 }
  // Sourcing requests are opened / cancelled by SAVED recalculations only (Q12); a preview computes values alone.
  const saved = params.save === true
  const now = new Date()
  const actor = params.actorUserId ?? null
  const signals: SourcingSignal[] = []
  const dropCancels: CostPlan['dropCancels'] = []
  const cancelOnDrop = (row: CpqQuoteLineCost, reason: CancelReason) => {
    if (!saved || !isRequestOpen(row)) return
    dropCancels.push({ row, patch: cancelRequestPatch(row, { reason, now, closedByUserId: actor }) })
    signals.push({ ...sourcingCostRef(row), kind: 'request_cancelled', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq ?? 1, reason })
  }

  // R1c: cancelled lines never get cost lines, and unreconfigured ARC mirror lines get no CATALOG cost lines (Q13).
  // ARC costs spec: an unreconfigured Amend mirror keeps its `carried` lines (the subscription's costs), nothing else;
  // a reconfigured mirror instantiates catalog lines for the elements that apply and keeps carried values whose
  // cost key matches (unless a driving attribute changed, R1b).
  const lines = params.lines.filter(({ lineConfig }) => (lineConfig.offeringId || lineConfig.productId)
    && !isArcCancelledLine(lineConfig, quote.quoteType)
    && (!isArcMirrorLine(lineConfig.configuration, quote.quoteType) || isArcReconfigured(lineConfig.configuration)
      || isCostManagedRenewLine(lineConfig.configuration, quote.quoteType)))
  // An item removed on an Amend / Renew quote leaves the subscription: its line keeps no cost
  // (catalog, manual or carried). Line removal already drops them; this also cleans rows stored before.
  // Non-carried rows stored on an unreconfigured mirror line before Q13 (a Renew mirror re-priced at standard) are dropped
  // too: nothing could confirm them (cost PATCH refuses such a line), so they would block conversion forever.
  const removedLineIds = new Set(params.lines
    .filter(({ lineConfig }) => isArcCancelledLine(lineConfig, quote.quoteType))
    .map(({ lineConfig }) => lineConfig.quoteLineId))
  const unreconfiguredMirrorIds = new Set(params.lines
    .filter(({ lineConfig }) => !isArcCancelledLine(lineConfig, quote.quoteType)
      && isArcMirrorLine(lineConfig.configuration, quote.quoteType) && !isArcReconfigured(lineConfig.configuration)
      && !isCostManagedRenewLine(lineConfig.configuration, quote.quoteType))
    .map(({ lineConfig }) => lineConfig.quoteLineId))
  const dropsOnRecalc = (row: CpqQuoteLineCost) => removedLineIds.has(row.quoteLineId)
    || (unreconfiguredMirrorIds.has(row.quoteLineId) && row.origin !== 'carried')

  // FX snapshot policy (spec §Proposed Solution, R4). This plan only runs for an UNLOCKED quote (locked / ordered
  // quotes reuse the stored rows and never reach it) and is only persisted by a SAVED recalculation; a preview resolves
  // the same rates in memory and writes nothing. Lines carried from a subscription item or belonging to an ARC mirror
  // line (Q6) keep their stored snapshot: no rate is read for them while one is stored. The resolver memoizes per
  // currency pair, so one recalculation costs one lookup per pair.
  const lookupFor = (row: CpqQuoteLineCost | undefined, lineConfig: CpqQuoteLineConfiguration): FxLookup => async (currency) => {
    const frozen = row !== undefined && (row.origin === 'carried' || isArcMirrorLine(lineConfig.configuration, quote.quoteType))
    if (frozen && row.fxRate !== null && row.fxRate !== undefined && row.currencyCode === currency) {
      return { fxRate: row.fxRate, fxRateDate: row.fxRateDate ?? null, fxRateSource: row.fxRateSource ?? null, fxRateDerivation: row.fxRateDerivation ?? null }
    }
    if (!params.fxResolver) return null
    const result = await params.fxResolver.resolve({ from: currency, to: quote.currencyCode, scope })
    if (!result.ok && result.reason === 'error') return FX_ERROR
    return result.ok ? { fxRate: result.rate, fxRateDate: result.rateDate, fxRateSource: result.source, fxRateDerivation: result.derivation } : null
  }

  // ── Reads first (no mutation before the last query) ──
  const existing = await em.find(CpqQuoteLineCost, { ...scoped(scope), quoteConfigurationId: quote.id })
  const cancelledDrops = existing.filter(dropsOnRecalc)
  stats.dropped += cancelledDrops.length
  // R1a, line removal: an ARC removal / unreconfigured mirror drops its cost lines with their open requests.
  for (const row of cancelledDrops) cancelOnDrop(row, 'line_removed')
  if (lines.length === 0) return { stats, creates: [], updates: [], drops: cancelledDrops, dropCancels, signals, existing }
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
  // R1a reason: a dropped line whose element is inactive / deleted is `element_deactivated`, an element that merely
  // stopped applying (the configuration changed) is `reconfigured`. Only needed for open requests, so one query at most.
  const activeElementIds = new Set(elements.map((element) => element.id))
  const droppedWithRequest = [...existingByLine.values()].flat()
    .filter((row) => saved && row.origin === 'catalog' && isRequestOpen(row) && row.costElementId && !activeElementIds.has(row.costElementId))
  const orphaned = droppedWithRequest.length
    ? await em.find(CpqChargeCostElement, { ...scoped(scope), isActive: true, id: { $in: [...new Set(droppedWithRequest.map((row) => row.costElementId as string))] } })
    : []
  const stillActive = new Set(orphaned.map((element) => element.id))
  const elementGone = new Set(droppedWithRequest.map((row) => row.costElementId as string).filter((id) => !stillActive.has(id)))
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

  // Index costs (R4): ONE value-in-force query for every index the applicable elements use, at the recalculation date.
  // Reads only: a preview computes the same values in memory, a locked quote never reaches this plan.
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10)
  const indexIds = [...new Set(elements.filter((element) => element.source === 'index' && element.costIndexId).map((element) => element.costIndexId as string))]
  const indexById = new Map<string, { id: string; currencyCode: string }>()
  let valuesInForce: Awaited<ReturnType<typeof loadValuesInForce>> = new Map()
  if (indexIds.length > 0) {
    const indices = await em.find(CpqCostIndex, { ...scoped(scope), id: { $in: indexIds } })
    for (const index of indices) indexById.set(index.id, { id: index.id, currencyCode: index.currencyCode })
    valuesInForce = await loadValuesInForce(em, [...indexById.keys()], asOfDate, scope)
  }

  // R1c / R13: the new term end of each cost-managed standalone Renew line's target (due flags are computed against it).
  const managedRenew = lines.filter(({ lineConfig }) => isCostManagedRenewLine(lineConfig.configuration, quote.quoteType))
  const newTermEndByTarget = new Map<string, Date | null>()
  if (managedRenew.length > 0) {
    const targets = await em.find(CpqQuoteTargetSubscription, { ...scoped(scope), quoteId: quote.id })
    for (const target of targets ?? []) newTermEndByTarget.set(target.subscriptionId, target.newTermEnd ?? null)
  }

  // ── Compute ──
  const creates: CostPlan['creates'] = []
  const updates: CostPlan['updates'] = []
  const drops: CostPlan['drops'] = [...cancelledDrops]
  // One update entry per row: later patches (due flags, index values, FX) merge into it, so previews that key by row see them all.
  const addPatch = (row: CpqQuoteLineCost, patch: RowPatch) => {
    const entry = updates.find((candidate) => candidate.row === row)
    if (entry) Object.assign(entry.patch, patch)
    else { updates.push({ row, patch }); stats.updated += 1 }
  }
  const droppedAtRenewal = new Set<CpqQuoteLineCost>()
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
        const lookup = lookupFor(row, lineConfig)
        const indexCost = element.source === 'index'
          ? resolveIndexCost({ element, index: element.costIndexId ? indexById.get(element.costIndexId) ?? null : null, valuesInForce, asOfDate })
          : null
        const resolved = await resolveValue(element, charge, tableEntry, mergedConfig, quote.currencyCode, lookup, indexCost)
        const structure = {
          chargeCode: charge.code, costElementId: element.id, name: element.name, role: element.role,
          costType: element.costType, source: element.source, costModel: element.costModel,
        }

        const autoOpen = (state: { sourcingStatus: string; valueStatus: string }, reset: boolean) => saved && params.autoOpen !== false && shouldAutoOpenRequest({
          enabled: true, saved, locked: false, quoteType: quote.quoteType, line: lineConfig,
          cost: { origin: 'catalog', role: element.role, source: element.source, ...state },
          requiresSourcing: element.requiresSourcing === true, resetByReconfiguration: reset,
        })

        if (!row) {
          const data: Record<string, unknown> = {
            id: randomUUID(), ...scope, quoteConfigurationId: quote.id, quoteId: quote.quoteId, quoteLineId: lineConfig.quoteLineId,
            costKey: element.code, origin: 'catalog', ...structure, ...toFields(resolved), driverHash: hash, sourcingStatus: 'not_requested',
          }
          // Q12: a new on_request cost of a requires_sourcing element opens its request with the line.
          if (autoOpen({ sourcingStatus: 'not_requested', valueStatus: resolved.valueStatus }, false)) {
            Object.assign(data, openRequestPatch({ requestSeq: null }, {
              now, requestedByUserId: actor, supplierId: element.defaultSupplierId, supplierName: element.defaultSupplierName,
            }))
            signals.push({
              ...sourcingCostRef(data as never), kind: 'requested', costRequestId: data.costRequestId as string, requestSeq: 1,
              supplierId: (data.requestSupplierId as string | null) ?? null, requestedByUserId: actor, auto: true,
            })
          }
          creates.push(data)
          stats.created += 1
          continue
        }

        // A carried line keeps the subscription's own structure (role, type, model, source, name); only the element link is set.
        const patch: RowPatch = row.origin === 'carried' ? { costElementId: element.id } : { ...structure }
        // R1b: a driving attribute changed since the value was set. On a catalog `on_request` value, or on a value a
        // pricing manager entered / confirmed (origin `manual`), that resets it and keeps the old value in the note.
        const driversChanged = row.driverHash !== null && row.driverHash !== hash
        const valueReset = driversChanged && row.valueStatus !== 'none' && (element.source === 'on_request' || isEnteredOrigin(row.valueOrigin))
        if (valueReset) {
          patch.note = resetNote(row, attributes)
        }
        if (driversChanged || !isEnteredOrigin(row.valueOrigin)) {
          // Catalog values follow the catalog on every saved recalculation while unlocked (R4). An index line follows the
          // value in force (Q11: only `value_origin = catalog` lines get here; a manual overwrite is kept, below).
          Object.assign(patch, toFields(resolved))
          // The element no longer uses an index: the old snapshot goes with the value.
          if (resolved.indexSnapshot === undefined && row.indexSnapshot) patch.indexSnapshot = null
        } else if (row.unitAmount !== null && row.unitAmount !== undefined) {
          // An entered / confirmed value survives, but its per-instance amount follows the quantity.
          const unit = Number(row.unitAmount)
          patch.instanceAmount = money(element.costModel === 'per_unit' ? unit * quantityOf(charge, mergedConfig) : unit)
          // Q6 / Q13: a foreign value keeps its currency and amount; its rate snapshot is refreshed (or kept for a carried / mirror line).
          Object.assign(patch, await enteredFxPatch(row, quote.currencyCode, lookup))
        }
        patch.driverHash = hash
        // R1b (sourcing part): a reconfiguration that resets an on_request / entered value makes the open request
        // meaningless: cancel it in this write and, per Q12, open a fresh one for requires_sourcing elements.
        const reset = driversChanged && (element.source === 'on_request' || isEnteredOrigin(row.valueOrigin))
        let state: RequestRowState = row
        if (saved && reset && isRequestOpen(row)) {
          const cancel = cancelRequestPatch(row, { reason: 'reconfigured', now, closedByUserId: actor })
          Object.assign(patch, cancel)
          state = { ...row, ...cancel } as RequestRowState
          signals.push({ ...sourcingCostRef(row), kind: 'request_cancelled', costRequestId: row.costRequestId as string, requestSeq: row.requestSeq ?? 1, reason: 'reconfigured' })
        }
        if (autoOpen({ sourcingStatus: state.sourcingStatus, valueStatus: String(patch.valueStatus ?? row.valueStatus) }, reset)) {
          const open = openRequestPatch(state, { now, requestedByUserId: actor, supplierId: element.defaultSupplierId, supplierName: element.defaultSupplierName })
          Object.assign(patch, open)
          signals.push({
            ...sourcingCostRef(row), kind: 'requested', costRequestId: open.costRequestId as string, requestSeq: open.requestSeq as number,
            supplierId: (open.requestSupplierId as string | null) ?? null, requestedByUserId: actor, auto: true,
          })
        }
        // Q11: an R1b reset of a value is a sourcing-relevant value change (amount-free `cost_valued`, cause `reset`).
        // Whether the line is still priceable is approximated by the reset value's own status (the validation of the
        // finished recalculation is not available here).
        if (saved && valueReset) {
          const status = String(patch.valueStatus ?? row.valueStatus)
          const errorCode = (patch.errorCode as string | null | undefined) ?? row.errorCode ?? null
          signals.push({
            ...sourcingCostRef(row), kind: 'valued', cause: 'reset', costRequestId: (patch.costRequestId as string | undefined) ?? row.costRequestId ?? null,
            requestSeq: (patch.requestSeq as number | undefined) ?? row.requestSeq ?? null, valueStatus: status, previousValueStatus: row.valueStatus,
            sourcingStatus: String(patch.sourcingStatus ?? row.sourcingStatus), valueChanged: true, answerPending: false, errorCode,
            lineReady: status !== 'none' && !errorCode, leadTimeHours: null,
            requestedByUserId: ('requestedByUserId' in patch ? (patch.requestedByUserId as string | null) : row.requestedByUserId) ?? null,
          })
        }
        updates.push({ row, patch })
        stats.updated += 1
      }
    }

    // R1a: catalog lines whose element is gone / inactive / no longer applicable are dropped (manual lines untouched).
    for (const row of rows) {
      if (row.origin !== 'catalog' || desiredKeys.has(row.costKey)) continue
      drops.push(row)
      cancelOnDrop(row, elementGone.has(row.costElementId ?? '') ? 'element_deactivated' : 'reconfigured')
      stats.dropped += 1
    }

    // R1c, standalone Renew: reconciliation (carried rows: match / keep / drop, due flags), THEN index re-evaluation.
    if (isCostManagedRenewLine(lineConfig.configuration, quote.quoteType)) {
      const effective = (row: RenewCostRow) => ({ ...row, ...(updates.find((candidate) => candidate.row === (row as unknown as CpqQuoteLineCost))?.patch ?? {}) }) as RenewCostRow
      const outcome = await reconcileRenewLine({
        rows: rows as unknown as RenewCostRow[],
        applicableKeys: desiredKeys,
        chargeCodes: new Set(ownerCharges.map((charge) => charge.code)),
        newTermEnd: (lineConfig.targetSubscriptionId ? newTermEndByTarget.get(lineConfig.targetSubscriptionId) : null) ?? null,
        asOf: now.toISOString().slice(0, 10),
        effective,
      }, { reevaluateCarriedIndexCosts: params.reevaluateCarriedIndexCosts })
      for (const row of outcome.dropped as unknown as CpqQuoteLineCost[]) {
        drops.push(row)
        droppedAtRenewal.add(row)
        cancelOnDrop(row, 'reconfigured')
        stats.dropped += 1
      }
      for (const { row, patch } of outcome.due) addPatch(row as unknown as CpqQuoteLineCost, patch)
      for (const { row, patch } of outcome.indexPatches) addPatch(row as unknown as CpqQuoteLineCost, patch as RowPatch)
    }

    // A manual cost, and a carried one no element claims, keeps its entered unit amount (and currency); a `per_unit` one's per-instance amount follows the
    // charge quantity, so a reconfigured quantity re-prices from the right cost. A foreign-currency value also gets its
    // FX snapshot refreshed (Q6; a carried / mirror line keeps its stored one) and the Q13 status on rate arrival.
    for (const row of rows) {
      if (droppedAtRenewal.has(row)) continue
      if ((row.origin !== 'manual' && !(row.origin === 'carried' && !desiredKeys.has(row.costKey))) || row.unitAmount === null || row.unitAmount === undefined) continue
      const charge = ownerCharges.find((candidate) => candidate.code === row.chargeCode)
      const patch: RowPatch = {}
      if (row.costModel === 'per_unit' && charge) patch.instanceAmount = money(Number(row.unitAmount) * quantityOf(charge, mergedConfig))
      Object.assign(patch, await enteredFxPatch(row, quote.currencyCode, lookupFor(row, lineConfig)))
      // A foreign value stored without a per-instance amount (a PR #95 supplier answer without a rate) gets it with its rate.
      if (patch.instanceAmount === undefined && (row.instanceAmount === null || row.instanceAmount === undefined) && patch.fxRate) patch.instanceAmount = money(Number(row.unitAmount))
      const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => (row as unknown as Record<string, unknown>)[key] !== value))
      if (Object.keys(changed).length === 0) continue
      addPatch(row, changed)
    }
  }
  return { stats, creates, updates, drops, dropCancels, signals, existing }
}

function toFields(value: ResolvedValue) {
  return {
    valueStatus: value.valueStatus, valueOrigin: value.valueOrigin, unitAmount: value.unitAmount,
    instanceAmount: value.instanceAmount, currencyCode: value.currencyCode, errorCode: value.errorCode,
    fxRate: value.fxRate, fxRateDate: value.fxRateDate, fxRateSource: value.fxRateSource, fxRateDerivation: value.fxRateDerivation,
    ...(value.indexSnapshot === undefined ? {} : { indexSnapshot: value.indexSnapshot }),
  }
}
