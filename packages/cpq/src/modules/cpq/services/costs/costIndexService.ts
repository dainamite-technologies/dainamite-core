import { randomUUID } from 'node:crypto'
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  cpqCostIndexCreateSchema,
  cpqCostIndexImportRowSchema,
  cpqCostIndexUpdateSchema,
  cpqCostIndexValueCreateSchema,
  type CostIndexCreateInput,
  type CostIndexRowErrorCode,
  type CostIndexUpdateInput,
  type CostIndexValueInput,
} from '../../data/cost-indices'
import { CpqChargeCostElement, CpqCostIndex, CpqCostIndexValue, CpqProductCharge } from '../../data/entities'
import { QuotingError } from '../cpqQuotingService'
import { loadValuesInForce, type IndexValueInForce } from './indexCostResolution'
import type { TenantScope } from '../types'

/**
 * Cost indices and their append-only, revisioned values (index-costs spec Q7 / Q8 / Q10). Registered in DI as
 * `cpqCostIndexService`.
 *
 * Concurrency (Q7): every value write runs in one transaction holding a PESSIMISTIC_WRITE lock on the parent index row
 * (bulk imports lock all touched indices in ascending id order), reads the highest revision per (index, date) under that
 * lock and inserts `max + 1`. The unique key (cost_index_id, effective_date, revision) is the backstop: a violation
 * becomes `409 CONCURRENT_INDEX_WRITE`. Value-in-force reads take no lock.
 */

/** A cost element that uses an index (the in-use rules read this; see `FindIndexReferences`). */
export type IndexReference = {
  costIndexId: string
  id: string
  code: string
  name: string
  role: string
  productChargeId: string
  chargeCode: string | null
  isActive: boolean
}

/**
 * Non-deleted cost elements referencing the given indices (inactive ones included: a delete or a currency change is
 * refused for any of them, a deactivation only for active ones). Injectable so tests can stub it; the default (and
 * `di.ts`) is `findIndexReferences`.
 */
export type FindIndexReferences = (em: EntityManager, indexIds: string[], scope: TenantScope) => Promise<IndexReference[]>

/** The real in-use query: tenant / organization scoped, `deleted_at IS NULL` on elements and on their charges. */
export const findIndexReferences: FindIndexReferences = async (em, indexIds, scope) => {
  if (indexIds.length === 0) return []
  const where = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  const elements = await em.find(CpqChargeCostElement, { ...where, costIndexId: { $in: indexIds } }, { orderBy: { code: 'asc' } })
  if (elements.length === 0) return []
  const charges = await em.find(CpqProductCharge, { ...where, id: { $in: [...new Set(elements.map((element) => element.productChargeId))] } })
  const chargeCodes = new Map(charges.map((charge) => [charge.id, charge.code]))
  return elements.map((element) => ({
    costIndexId: element.costIndexId as string,
    id: element.id,
    code: element.code,
    name: element.name,
    role: element.role,
    productChargeId: element.productChargeId,
    chargeCode: chargeCodes.get(element.productChargeId) ?? null,
    isActive: element.isActive,
  }))
}

export type { IndexValueInForce }

export type CostIndexView = ReturnType<typeof serializeCostIndex>
export type CostIndexValueView = ReturnType<typeof serializeCostIndexValue>

export type ImportRowResult = { row: number; indexCode: string; effectiveDate: string; status: 'created' | 'unchanged'; revision: number }
export type ImportRowError = { row: number; code: CostIndexRowErrorCode; indexCode?: string }

export type AppendOptions = { userId?: string | null; importBatchId?: string | null; skipUnchanged?: boolean }
export type AppendResult = { status: 'created' | 'unchanged'; effectiveDate: string; revision: number; value: CostIndexValueView | null }

type Dependencies = {
  em: EntityManager
  findReferences?: FindIndexReferences
  /** Server clock; tests inject a fixed instant. */
  now?: () => Date
  /** ISO 4217 membership; defaults to the runtime's currency list. */
  isKnownCurrency?: (code: string) => boolean
}

const IMPORT_INVALID = 'IMPORT_VALIDATION_FAILED'
const CONCURRENT = 'CONCURRENT_INDEX_WRITE'

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId })
const live = (scope: TenantScope) => ({ ...scoped(scope), deletedAt: null })
const decimal = (value: number) => value.toFixed(6)
const sameDecimal = (stored: string, entered: number) => Number(stored).toFixed(6) === decimal(entered)
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

const defaultKnownCurrency = (code: string): boolean => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency').includes(code) ?? true
  } catch {
    return true
  }
}

const isUniqueViolation = (error: unknown): boolean => error instanceof UniqueConstraintViolationException
  || (!!error && typeof error === 'object' && ((error as { code?: unknown }).code === '23505'
    || (error as { constructor?: { name?: string } }).constructor?.name === 'UniqueConstraintViolationException'))

export function serializeCostIndex(row: CpqCostIndex) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    currencyCode: row.currencyCode,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function serializeCostIndexValue(row: CpqCostIndexValue) {
  return {
    id: row.id,
    costIndexId: row.costIndexId,
    effectiveDate: row.effectiveDate,
    value: row.value,
    revision: row.revision,
    sourceNote: row.sourceNote,
    importBatchId: row.importBatchId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  }
}

const todayUtc = (now: Date) => now.toISOString().slice(0, 10)
const referenceView = (ref: IndexReference) => ({ id: ref.id, code: ref.code, name: ref.name, role: ref.role, productChargeId: ref.productChargeId, chargeCode: ref.chargeCode, isActive: ref.isActive })

/** Highest-revision row per (date) of `rows`, which must belong to one index. */
function latestRevisionByDate(rows: CpqCostIndexValue[]): Map<string, CpqCostIndexValue> {
  const byDate = new Map<string, CpqCostIndexValue>()
  for (const row of rows) {
    const known = byDate.get(row.effectiveDate)
    if (!known || row.revision > known.revision) byDate.set(row.effectiveDate, row)
  }
  return byDate
}

export class CpqCostIndexService {
  constructor(private readonly deps: Dependencies) {}

  private get now(): Date {
    return this.deps.now ? this.deps.now() : new Date()
  }

  private get references(): FindIndexReferences {
    return this.deps.findReferences ?? findIndexReferences
  }

  private readEm(): EntityManager {
    return this.deps.em.fork({ clear: true, useContext: false })
  }

  // ─── Reads ─────────────────────────────────────────────────────

  async list(scope: TenantScope, query: { page: number; pageSize: number; search?: string; isActive?: boolean; sortField?: 'code' | 'name' | 'currencyCode' | 'createdAt'; sortDir?: 'asc' | 'desc' }) {
    const em = this.readEm()
    const search = query.search?.trim()
    const where = {
      ...live(scope),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(search ? { $or: [{ code: { $ilike: `%${escapeLike(search)}%` } }, { name: { $ilike: `%${escapeLike(search)}%` } }] } : {}),
    }
    const [rows, total] = await em.findAndCount(CpqCostIndex, where, {
      limit: query.pageSize, offset: (query.page - 1) * query.pageSize,
      orderBy: { [query.sortField ?? 'code']: query.sortDir ?? 'asc' },
    })
    const ids = rows.map((row) => row.id)
    const [current, references] = await Promise.all([
      this.valuesInForce(ids, todayUtc(this.now), scope, em),
      ids.length ? this.references(em, ids, scope) : Promise.resolve([] as IndexReference[]),
    ])
    const items = rows.map((row) => ({
      ...serializeCostIndex(row),
      current: this.currentView(current.get(row.id)),
      elementCount: references.filter((ref) => ref.costIndexId === row.id).length,
    }))
    return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }
  }

  async get(indexId: string, scope: TenantScope) {
    const em = this.readEm()
    const row = await this.requireIndex(em, indexId, scope)
    const today = todayUtc(this.now)
    const [current, future, references] = await Promise.all([
      this.valuesInForce([row.id], today, scope, em),
      em.find(CpqCostIndexValue, { ...scoped(scope), costIndexId: row.id, effectiveDate: { $gt: today } }),
      this.references(em, [row.id], scope),
    ])
    return {
      item: serializeCostIndex(row),
      current: this.currentView(current.get(row.id)),
      futureValueCount: latestRevisionByDate(future).size,
      elements: references.filter((ref) => ref.costIndexId === row.id).map(referenceView),
    }
  }

  /**
   * Values of one index, newest first (`effectiveDate desc, revision desc`). `superseded` = a higher revision exists for
   * the same date; `inForceToday` = the value the engine would use today; `future` = dated after today.
   * Superseded rows are hidden unless `includeSuperseded`. Flags are computed over the filtered series in memory (an
   * index series is a few thousand rows at most).
   */
  async listValues(indexId: string, scope: TenantScope, query: { page: number; pageSize: number; from?: string; to?: string; includeSuperseded?: boolean }) {
    const em = this.readEm()
    await this.requireIndex(em, indexId, scope)
    const today = todayUtc(this.now)
    const range = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) }
    const rows = await em.find(CpqCostIndexValue, {
      ...scoped(scope), costIndexId: indexId, ...(Object.keys(range).length ? { effectiveDate: range } : {}),
    }, { orderBy: { effectiveDate: 'desc', revision: 'desc' } })
    const latest = latestRevisionByDate(rows)
    const inForce = [...latest.values()].filter((row) => row.effectiveDate <= today).sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))[0]
    const flagged = rows.map((row) => ({
      ...serializeCostIndexValue(row),
      superseded: latest.get(row.effectiveDate)?.id !== row.id,
      future: row.effectiveDate > today,
      // The range filter can hide the true in-force row; the flag is only reported for rows inside the range.
      inForceToday: inForce?.id === row.id,
    }))
    const visible = query.includeSuperseded ? flagged : flagged.filter((row) => !row.superseded)
    const start = (query.page - 1) * query.pageSize
    return { items: visible.slice(start, start + query.pageSize), total: visible.length, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(visible.length / query.pageSize) }
  }

  /** Value in force for one index at `asOfDate` (YYYY-MM-DD), or null: highest revision at the latest date on or before it. */
  async valueInForce(indexId: string, asOfDate: string, scope: TenantScope, em: EntityManager = this.readEm()): Promise<IndexValueInForce | null> {
    return (await this.valuesInForce([indexId], asOfDate, scope, em)).get(indexId) ?? null
  }

  /** One query for many indices (one per recalculation, not per line). Indices without a value in force are absent. */
  async valuesInForce(indexIds: string[], asOfDate: string, scope: TenantScope, em: EntityManager = this.readEm()): Promise<Map<string, IndexValueInForce>> {
    return loadValuesInForce(em, indexIds, asOfDate, scope)
  }

  /** Non-deleted elements that use the index. */
  async referencingElements(indexId: string, scope: TenantScope, em: EntityManager = this.readEm()): Promise<IndexReference[]> {
    return (await this.references(em, [indexId], scope)).filter((ref) => ref.costIndexId === indexId)
  }

  // ─── Master data writes ────────────────────────────────────────

  async create(input: CostIndexCreateInput, scope: TenantScope): Promise<CostIndexView> {
    const parsed = cpqCostIndexCreateSchema.parse(input)
    if (!(this.deps.isKnownCurrency ?? defaultKnownCurrency)(parsed.currencyCode)) throw new QuotingError(422, 'UNKNOWN_CURRENCY')
    const em = this.readEm()
    // Unique per tenant (not per organization): the partial unique index in the migration is the backstop.
    const duplicate = await em.findOne(CpqCostIndex, { tenantId: scope.tenantId, code: parsed.code, deletedAt: null })
    if (duplicate) throw new QuotingError(422, 'DUPLICATE_CODE')
    const row = em.create(CpqCostIndex, {
      ...scope, code: parsed.code, name: parsed.name, unit: parsed.unit, currencyCode: parsed.currencyCode,
      description: parsed.description ?? null, isActive: parsed.isActive ?? true,
    })
    em.persist(row)
    try {
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) throw new QuotingError(422, 'DUPLICATE_CODE')
      throw error
    }
    return serializeCostIndex(row)
  }

  /**
   * `code` is immutable (`422 CODE_IMMUTABLE` when it differs). The currency can change only while the index has no
   * values and no referencing element (`INDEX_CURRENCY_LOCKED`); deactivating is refused while an active element
   * references it (`INDEX_IN_USE`, listing the elements). Runs under the index row lock so a racing element write
   * (which reads the index FOR SHARE) is serialized with it.
   */
  async update(indexId: string, input: CostIndexUpdateInput, scope: TenantScope): Promise<CostIndexView> {
    const patch = cpqCostIndexUpdateSchema.parse(input)
    return this.inIndexLock(indexId, scope, async (tx, row) => {
      if (patch.code !== undefined && patch.code !== row.code) throw new QuotingError(422, 'CODE_IMMUTABLE')
      if (patch.currencyCode !== undefined && patch.currencyCode !== row.currencyCode) {
        if (!(this.deps.isKnownCurrency ?? defaultKnownCurrency)(patch.currencyCode)) throw new QuotingError(422, 'UNKNOWN_CURRENCY')
        const [values, references] = await Promise.all([
          tx.count(CpqCostIndexValue, { ...scoped(scope), costIndexId: row.id }),
          this.references(tx, [row.id], scope),
        ])
        if (values > 0 || references.some((ref) => ref.costIndexId === row.id)) throw new QuotingError(422, 'INDEX_CURRENCY_LOCKED')
        row.currencyCode = patch.currencyCode
      }
      if (patch.isActive === false && row.isActive) await this.assertNoActiveReferences(tx, row, scope)
      if (patch.name !== undefined) row.name = patch.name
      if (patch.unit !== undefined) row.unit = patch.unit
      if (patch.description !== undefined) row.description = patch.description ?? null
      if (patch.isActive !== undefined) row.isActive = patch.isActive
      await tx.flush()
      return serializeCostIndex(row)
    })
  }

  setActive(indexId: string, isActive: boolean, scope: TenantScope): Promise<CostIndexView> {
    return this.update(indexId, { isActive }, scope)
  }

  /** Soft delete; the values stay (quote snapshots name them). Refused while any non-deleted element references it. */
  async softDelete(indexId: string, scope: TenantScope): Promise<void> {
    await this.inIndexLock(indexId, scope, async (tx, row) => {
      const references = (await this.references(tx, [row.id], scope)).filter((ref) => ref.costIndexId === row.id)
      if (references.length > 0) throw new QuotingError(422, 'INDEX_IN_USE', undefined, { elements: references.map(referenceView) })
      row.deletedAt = this.now
      await tx.flush()
    })
  }

  // ─── Values ────────────────────────────────────────────────────

  /**
   * Appends values to one index in one transaction (see class comment). Each row gets `max revision for its date + 1`
   * (1 when none). With `skipUnchanged` a row equal to the current highest revision of its date is reported
   * `unchanged` and not stored. `422 INDEX_INACTIVE` for an inactive index; `409 CONCURRENT_INDEX_WRITE` when the
   * unique key fires.
   */
  async appendValues(indexId: string, rows: CostIndexValueInput[], scope: TenantScope, options: AppendOptions = {}): Promise<AppendResult[]> {
    const parsed = rows.map((row) => cpqCostIndexValueCreateSchema.parse(row))
    try {
      return await this.deps.em.fork({ clear: true, useContext: false }).transactional(async (tx) => {
        const index = await tx.findOne(CpqCostIndex, { ...live(scope), id: indexId }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!index) throw new QuotingError(404, 'Cost index not found')
        if (!index.isActive) throw new QuotingError(422, 'INDEX_INACTIVE')
        const state = await this.loadRevisionState(tx, [{ index, rows: parsed }], scope)
        const results = parsed.map((row) => this.appendOne(tx, index, row, state, scope, options))
        await tx.flush()
        return results
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new QuotingError(409, CONCURRENT)
      throw error
    }
  }

  /** One value, as `POST /cost-indices/{id}/values`. Never skipped as unchanged: a correction is explicit. */
  async appendValue(indexId: string, input: CostIndexValueInput, scope: TenantScope, options: Omit<AppendOptions, 'skipUnchanged'> = {}): Promise<CostIndexValueView> {
    const [result] = await this.appendValues(indexId, [input], scope, { ...options, skipUnchanged: false })
    if (!result?.value) throw new Error('Value append did not return a row')
    return result.value
  }

  /**
   * Bulk import (Q8): up to 1000 rows addressed by `indexCode`, all-or-nothing. Any invalid row (`UNKNOWN_INDEX`,
   * `INDEX_INACTIVE`, `INVALID_VALUE`, `DUPLICATE_ROW`) fails the whole call with `422 { errors: [{ row, code }] }` and
   * nothing is written; `row` is the 1-based position in the request. A row equal to the current highest revision of its
   * date is `unchanged` (re-running a feed adds no revisions). `dryRun` validates and reports without writing (and
   * without locks). Written rows share one `batchId` (null on a dry run). Touched indices are locked in ascending id order.
   */
  async importValues(rawRows: unknown[], scope: TenantScope, options: { userId?: string | null; dryRun?: boolean } = {}): Promise<{ batchId: string | null; dryRun: boolean; results: ImportRowResult[] }> {
    const dryRun = options.dryRun === true
    const { valid, errors } = this.validateImportRows(rawRows)
    const readEm = this.readEm()
    const indices = await this.loadIndicesByCode(readEm, [...new Set(valid.map((row) => row.indexCode))], scope)
    this.checkIndices(valid, indices, errors)
    if (errors.length) throw this.importError(errors)
    if (dryRun) {
      const state = await this.loadRevisionState(readEm, this.groupByIndex(valid, indices), scope)
      return { batchId: null, dryRun, results: this.planImport(valid, indices, state) }
    }
    const batchId = randomUUID()
    try {
      return await this.deps.em.fork({ clear: true, useContext: false }).transactional(async (tx) => {
        // Lock in ascending id order (two imports touching the same indices cannot deadlock), then re-check under the lock.
        const locked = new Map<string, CpqCostIndex>()
        for (const id of [...new Set([...indices.values()].map((index) => index.id))].sort()) {
          const index = await tx.findOne(CpqCostIndex, { ...live(scope), id }, { lockMode: LockMode.PESSIMISTIC_WRITE })
          if (index) locked.set(index.code, index)
        }
        const underLock: ImportRowError[] = []
        this.checkIndices(valid, locked, underLock)
        if (underLock.length) throw this.importError(underLock)
        const state = await this.loadRevisionState(tx, this.groupByIndex(valid, locked), scope)
        const results: ImportRowResult[] = valid.map((row) => {
          const appended = this.appendOne(tx, locked.get(row.indexCode)!, row, state, scope, { userId: options.userId, importBatchId: batchId, skipUnchanged: true })
          return { row: row.position, indexCode: row.indexCode, effectiveDate: row.effectiveDate, status: appended.status, revision: appended.revision }
        })
        await tx.flush()
        return { batchId, dryRun, results }
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new QuotingError(409, CONCURRENT)
      throw error
    }
  }

  // ─── Internals ─────────────────────────────────────────────────

  private currentView(value: IndexValueInForce | undefined) {
    return value ? { effectiveDate: value.effectiveDate, value: value.value, revision: value.revision } : null
  }

  private async requireIndex(em: EntityManager, indexId: string, scope: TenantScope): Promise<CpqCostIndex> {
    const row = await em.findOne(CpqCostIndex, { ...live(scope), id: indexId })
    if (!row) throw new QuotingError(404, 'Cost index not found')
    return row
  }

  private async inIndexLock<T>(indexId: string, scope: TenantScope, execute: (tx: EntityManager, row: CpqCostIndex) => Promise<T>): Promise<T> {
    return this.deps.em.fork({ clear: true, useContext: false }).transactional(async (tx) => {
      const row = await tx.findOne(CpqCostIndex, { ...live(scope), id: indexId }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!row) throw new QuotingError(404, 'Cost index not found')
      return execute(tx, row)
    })
  }

  private async assertNoActiveReferences(tx: EntityManager, row: CpqCostIndex, scope: TenantScope): Promise<void> {
    const active = (await this.references(tx, [row.id], scope)).filter((ref) => ref.costIndexId === row.id && ref.isActive)
    if (active.length > 0) throw new QuotingError(422, 'INDEX_IN_USE', undefined, { elements: active.map(referenceView) })
  }

  private validateImportRows(rawRows: unknown[]) {
    const valid: Array<{ position: number; indexCode: string; effectiveDate: string; value: number; sourceNote?: string | null }> = []
    const errors: ImportRowError[] = []
    const seen = new Set<string>()
    rawRows.forEach((raw, offset) => {
      const position = offset + 1
      const parsed = cpqCostIndexImportRowSchema.safeParse(raw)
      if (!parsed.success) {
        const code = raw && typeof raw === 'object' ? (raw as { indexCode?: unknown }).indexCode : undefined
        errors.push({ row: position, code: 'INVALID_VALUE', ...(typeof code === 'string' ? { indexCode: code } : {}) })
        return
      }
      const key = `${parsed.data.indexCode}|${parsed.data.effectiveDate}`
      if (seen.has(key)) {
        errors.push({ row: position, code: 'DUPLICATE_ROW', indexCode: parsed.data.indexCode })
        return
      }
      seen.add(key)
      valid.push({ position, ...parsed.data })
    })
    return { valid, errors }
  }

  private async loadIndicesByCode(em: EntityManager, codes: string[], scope: TenantScope): Promise<Map<string, CpqCostIndex>> {
    if (codes.length === 0) return new Map()
    const rows = await em.find(CpqCostIndex, { ...live(scope), code: { $in: codes } })
    return new Map(rows.map((row) => [row.code, row]))
  }

  private checkIndices(rows: Array<{ position: number; indexCode: string }>, indices: Map<string, CpqCostIndex>, errors: ImportRowError[]): void {
    for (const row of rows) {
      const index = indices.get(row.indexCode)
      if (!index) errors.push({ row: row.position, code: 'UNKNOWN_INDEX', indexCode: row.indexCode })
      else if (!index.isActive) errors.push({ row: row.position, code: 'INDEX_INACTIVE', indexCode: row.indexCode })
    }
    errors.sort((a, b) => a.row - b.row)
  }

  private importError(errors: ImportRowError[]): QuotingError {
    return new QuotingError(422, IMPORT_INVALID, undefined, { errors })
  }

  private groupByIndex(rows: Array<{ indexCode: string; effectiveDate: string }>, indices: Map<string, CpqCostIndex>) {
    const grouped = new Map<string, { index: CpqCostIndex; rows: Array<{ effectiveDate: string }> }>()
    for (const row of rows) {
      const index = indices.get(row.indexCode)
      if (!index) continue
      const entry = grouped.get(index.id) ?? { index, rows: [] }
      entry.rows.push(row)
      grouped.set(index.id, entry)
    }
    return [...grouped.values()]
  }

  /** Highest stored revision (and its value) per `${indexId}|${date}` for the dates the writes touch. */
  private async loadRevisionState(em: EntityManager, groups: Array<{ index: CpqCostIndex; rows: Array<{ effectiveDate: string }> }>, scope: TenantScope) {
    const state = new Map<string, { revision: number; value: string }>()
    const ids = groups.map((group) => group.index.id)
    const dates = [...new Set(groups.flatMap((group) => group.rows.map((row) => row.effectiveDate)))]
    if (ids.length === 0 || dates.length === 0) return state
    const stored = await em.find(CpqCostIndexValue, { ...scoped(scope), costIndexId: { $in: ids }, effectiveDate: { $in: dates } })
    for (const row of stored) {
      const key = `${row.costIndexId}|${row.effectiveDate}`
      const known = state.get(key)
      if (!known || row.revision > known.revision) state.set(key, { revision: row.revision, value: row.value })
    }
    return state
  }

  /** Dry-run twin of `appendOne`: same revision / unchanged arithmetic, nothing persisted. */
  private planImport(rows: Array<{ position: number; indexCode: string; effectiveDate: string; value: number }>, indices: Map<string, CpqCostIndex>, state: Map<string, { revision: number; value: string }>): ImportRowResult[] {
    return rows.map((row) => {
      const key = `${indices.get(row.indexCode)!.id}|${row.effectiveDate}`
      const known = state.get(key)
      if (known && sameDecimal(known.value, row.value)) return { row: row.position, indexCode: row.indexCode, effectiveDate: row.effectiveDate, status: 'unchanged' as const, revision: known.revision }
      const revision = (known?.revision ?? 0) + 1
      state.set(key, { revision, value: decimal(row.value) })
      return { row: row.position, indexCode: row.indexCode, effectiveDate: row.effectiveDate, status: 'created' as const, revision }
    })
  }

  private appendOne(
    tx: EntityManager,
    index: CpqCostIndex,
    row: { effectiveDate: string; value: number; sourceNote?: string | null },
    state: Map<string, { revision: number; value: string }>,
    scope: TenantScope,
    options: AppendOptions,
  ): AppendResult {
    const key = `${index.id}|${row.effectiveDate}`
    const known = state.get(key)
    if (options.skipUnchanged && known && sameDecimal(known.value, row.value)) {
      return { status: 'unchanged', effectiveDate: row.effectiveDate, revision: known.revision, value: null }
    }
    const revision = (known?.revision ?? 0) + 1
    const created = tx.create(CpqCostIndexValue, {
      ...scope,
      costIndexId: index.id,
      effectiveDate: row.effectiveDate,
      value: decimal(row.value),
      revision,
      sourceNote: row.sourceNote ?? null,
      importBatchId: options.importBatchId ?? null,
      createdByUserId: options.userId ?? null,
    })
    tx.persist(created)
    state.set(key, { revision, value: decimal(row.value) })
    return { status: 'created', effectiveDate: row.effectiveDate, revision, value: serializeCostIndexValue(created) }
  }
}
