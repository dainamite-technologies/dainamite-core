import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import {
  CpqChargeCostElement, CpqOrderConfiguration, CpqPricingTable, CpqQuoteConfiguration, CpqQuoteLineConfiguration, CpqQuoteLineCost,
} from '../../data/entities'
import { COST_REQUEST_OVERDUE_DEFAULT_DAYS, COST_REQUEST_OVERDUE_TOGGLE } from '../../data/costs'
import type { CostRequestListQuery } from '../../data/costRequests'
import type { TenantScope } from '../types'
import { driverAttributes } from './costResolution'
import { isRequestOverdue, overdueCutoff, workingDaysBetween } from './costSourcing'

/**
 * Read model of the Cost requests queue (feature spec §API Contracts, Q7, Q10, Q13). A request is a state of a
 * cost line, so the queue reads `cpq_quote_line_costs` directly. Rows whose CPQ quote or sales quote is deleted
 * are hidden by a semi-join (`sales.quote.deleted` is not emitted by core, so this filter is the real protection).
 * No amount appears in the list; the detail adds the current value and the proposal for holders of
 * `cpq.costs.view` (both routes require it).
 */

type Dependencies = {
  em: EntityManager
  featureTogglesService: Pick<FeatureTogglesService, 'getNumberConfig'>
}

const scoped = (scope: TenantScope) => ({ organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null })
const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null)
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

/**
 * `SELECT id FROM cpq_quote_configurations WHERE <scope> AND quote_id IN (SELECT id FROM sales_quotes WHERE <scope>)`:
 * quotes alive on both sides, as a nested semi-join (no rows hydrated, no bound id list).
 */
export function liveQuoteConfigurationIds(em: EntityManager, scope: TenantScope) {
  const liveSalesQuotes = em.createQueryBuilder(SalesQuote, 'sq').select('sq.id').where(scoped(scope))
  return em.createQueryBuilder(CpqQuoteConfiguration, 'qc').select('qc.id').where({ ...scoped(scope), quoteId: { $in: liveSalesQuotes } })
}

export type CostRequestItem = {
  costId: string
  quoteId: string
  quoteConfigurationId: string
  quoteNumber: string | null
  customerName: string | null
  quoteLineId: string
  productName: string | null
  offeringId: string | null
  costKey: string
  costName: string
  chargeCode: string | null
  role: string
  origin: string
  keyAttributes: Record<string, unknown>
  sourcingStatus: string
  cancelReason: string | null
  costRequestId: string | null
  requestSeq: number | null
  requestedAt: string | null
  /** Working days since the request opened; `null` unless the request is open. */
  ageWorkingDays: number | null
  overdue: boolean
  requestSupplierId: string | null
  requestSupplierName: string | null
  valueStatus: string
  hasAnswerPending: boolean
  cpqStatus: string
  orderId: string | null
}

export type CostRequestDetail = CostRequestItem & {
  lineConfiguration: Record<string, unknown>
  note: string | null
  requestHistory: Array<Record<string, unknown>>
  current: {
    valueStatus: string; valueOrigin: string | null; unitAmount: string | null; currencyCode: string | null
    supplierId: string | null; supplierName: string | null; supplierQuoteRef: string | null; validUntil: string | null
  }
  proposedAnswer: Record<string, unknown> | null
}

/** Overdue threshold in working days (Q10); shared by the queue and the quote costs read. */
export async function resolveOverdueThreshold(featureTogglesService: Pick<FeatureTogglesService, 'getNumberConfig'>, tenantId: string): Promise<number> {
  const flag = await featureTogglesService.getNumberConfig(COST_REQUEST_OVERDUE_TOGGLE, tenantId)
  const value = flag.ok ? Number(flag.value) : NaN
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : COST_REQUEST_OVERDUE_DEFAULT_DAYS
}

export class CpqCostRequestQueueService {
  constructor(private readonly deps: Dependencies) {}

  /** Threshold in working days (Q10); a missing / invalid toggle falls back to the default. */
  overdueThreshold(tenantId: string): Promise<number> {
    return resolveOverdueThreshold(this.deps.featureTogglesService, tenantId)
  }

  async list(scope: TenantScope, query: CostRequestListQuery, now = new Date()) {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const threshold = await this.overdueThreshold(scope.tenantId)
    const base = { page: query.page, pageSize: query.pageSize, overdueThresholdWorkingDays: threshold }
    const empty = { items: [] as CostRequestItem[], total: 0, totalPages: 0, ...base }

    const conditions: FilterQuery<CpqQuoteLineCost>[] = [{ quoteConfigurationId: { $in: liveQuoteConfigurationIds(em, scope) } }]
    if (query.overdue) {
      // Overdue is a property of open requests only.
      if (query.status !== 'requested' && query.status !== 'all') return empty
      conditions.push({ sourcingStatus: 'requested', requestedAt: { $lt: overdueCutoff(now, threshold) } })
    } else if (query.status !== 'all') {
      conditions.push({ sourcingStatus: query.status })
    }
    if (query.cancelReason) conditions.push({ cancelReason: query.cancelReason })
    if (query.supplierId) conditions.push({ requestSupplierId: query.supplierId })
    // The id of the sales quote or of the CPQ quote (the notification links carry the CPQ one).
    if (query.quoteId) conditions.push({ $or: [{ quoteId: query.quoteId }, { quoteConfigurationId: query.quoteId }] })
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`
      const numbered = em.createQueryBuilder(SalesQuote, 'sq').select('sq.id').where({ ...scoped(scope), quoteNumber: { $ilike: pattern } })
      const customers = em.createQueryBuilder(CustomerEntity, 'ce').select('ce.id').where({ ...scoped(scope), displayName: { $ilike: pattern } })
      const ofCustomers = em.createQueryBuilder(CpqQuoteConfiguration, 'qc').select('qc.id').where({ ...scoped(scope), customerId: { $in: customers } })
      conditions.push({ $or: [{ name: { $ilike: pattern } }, { quoteId: { $in: numbered } }, { quoteConfigurationId: { $in: ofCustomers } }] })
    }

    const [rows, total] = await em.findAndCount(CpqQuoteLineCost, { ...scoped(scope), $and: conditions }, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      orderBy: { requestedAt: query.sortDir, id: 'asc' },
    })
    const items = await this.project(em, scope, rows, threshold, now)
    return { items: items.map((entry) => entry.item), total, totalPages: Math.ceil(total / query.pageSize), ...base }
  }

  /** `null` when the cost line does not exist, is not in scope or its quote is deleted. */
  async detail(costId: string, scope: TenantScope, now = new Date()): Promise<CostRequestDetail | null> {
    const em = this.deps.em.fork({ clear: true, useContext: false })
    const row = await em.findOne(CpqQuoteLineCost, {
      ...scoped(scope), id: costId, quoteConfigurationId: { $in: liveQuoteConfigurationIds(em, scope) },
    })
    if (!row) return null
    const threshold = await this.overdueThreshold(scope.tenantId)
    const [entry] = await this.project(em, scope, [row], threshold, now)
    return {
      ...entry.item,
      lineConfiguration: entry.attributes,
      note: row.note ?? null,
      requestHistory: row.requestHistory ?? [],
      current: {
        valueStatus: row.valueStatus, valueOrigin: row.valueOrigin ?? null, unitAmount: row.unitAmount ?? null,
        currencyCode: row.currencyCode ?? null, supplierId: row.supplierId ?? null, supplierName: row.supplierName ?? null,
        supplierQuoteRef: row.supplierQuoteRef ?? null, validUntil: row.validUntil ?? null,
      },
      proposedAnswer: row.proposedAnswer ?? null,
    }
  }

  /** Batch-loads quote, sales quote, customer, line, element and order data for a page of rows (no N+1). */
  private async project(em: EntityManager, scope: TenantScope, rows: CpqQuoteLineCost[], threshold: number, now: Date) {
    if (rows.length === 0) return []
    const unique = <T>(values: Array<T | null | undefined>) => [...new Set(values.filter((value): value is T => value !== null && value !== undefined))]
    const configIds = unique(rows.map((row) => row.quoteConfigurationId))
    const lineIds = unique(rows.map((row) => row.quoteLineId))
    const elementIds = unique(rows.map((row) => row.costElementId))

    const [configs, lineConfigs, salesLines, elements, orders] = await Promise.all([
      em.find(CpqQuoteConfiguration, { ...scoped(scope), id: { $in: configIds } }),
      em.find(CpqQuoteLineConfiguration, { ...scoped(scope), quoteLineId: { $in: lineIds } }),
      em.find(SalesQuoteLine, { ...scoped(scope), id: { $in: lineIds } }),
      elementIds.length ? em.find(CpqChargeCostElement, { ...scoped(scope), id: { $in: elementIds } }) : Promise.resolve([]),
      em.find(CpqOrderConfiguration, { ...scoped(scope), sourceQuoteId: { $in: configIds } }),
    ])
    const tableIds = unique(elements.map((element) => element.costTableId))
    const [salesQuotes, customers, tables] = await Promise.all([
      em.find(SalesQuote, { ...scoped(scope), id: { $in: unique(configs.map((config) => config.quoteId)) } }),
      em.find(CustomerEntity, { ...scoped(scope), id: { $in: unique(configs.map((config) => config.customerId)) } }),
      tableIds.length ? em.find(CpqPricingTable, { ...scoped(scope), id: { $in: tableIds } }) : Promise.resolve([]),
    ])
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((entry) => [entry.id, entry]))
    const configById = byId(configs), salesQuoteById = byId(salesQuotes), customerById = byId(customers)
    const salesLineById = byId(salesLines), elementById = byId(elements), tableById = byId(tables)
    const lineConfigByLine = new Map(lineConfigs.map((line) => [line.quoteLineId, line]))
    const orderByQuote = new Map<string, string>()
    for (const order of orders) if (order.sourceQuoteId && !orderByQuote.has(order.sourceQuoteId)) orderByQuote.set(order.sourceQuoteId, order.id)

    return rows.map((row) => {
      const config = configById.get(row.quoteConfigurationId)
      const lineConfig = lineConfigByLine.get(row.quoteLineId)
      const element = row.costElementId ? elementById.get(row.costElementId) : undefined
      const table = element?.costTableId ? tableById.get(element.costTableId) ?? null : null
      const configuration = (lineConfig?.configuration ?? {}) as Record<string, unknown>
      const attributes = element
        ? Object.fromEntries(driverAttributes(element, table).map((key) => [key, configuration[key] ?? null]))
        : {}
      const open = row.sourcingStatus === 'requested' && !!row.requestedAt
      const age = open ? workingDaysBetween(new Date(row.requestedAt as Date), now) : null
      const item: CostRequestItem = {
        costId: row.id,
        quoteId: row.quoteId,
        quoteConfigurationId: row.quoteConfigurationId,
        quoteNumber: config ? salesQuoteById.get(config.quoteId)?.quoteNumber ?? null : null,
        customerName: config ? customerById.get(config.customerId)?.displayName ?? null : null,
        quoteLineId: row.quoteLineId,
        productName: salesLineById.get(row.quoteLineId)?.name ?? null,
        offeringId: lineConfig?.offeringId ?? null,
        costKey: row.costKey,
        costName: row.name,
        chargeCode: row.chargeCode ?? null,
        role: row.role,
        origin: row.origin,
        keyAttributes: attributes,
        sourcingStatus: row.sourcingStatus,
        cancelReason: row.sourcingStatus === 'cancelled' ? row.cancelReason ?? null : null,
        costRequestId: row.costRequestId ?? null,
        requestSeq: row.requestSeq ?? null,
        requestedAt: iso(row.requestedAt),
        ageWorkingDays: age,
        overdue: age !== null && isRequestOverdue(age, threshold),
        requestSupplierId: row.requestSupplierId ?? null,
        requestSupplierName: row.requestSupplierName ?? null,
        valueStatus: row.valueStatus,
        hasAnswerPending: row.proposedAmount !== null && row.proposedAmount !== undefined,
        cpqStatus: config?.cpqStatus ?? 'unknown',
        orderId: orderByQuote.get(row.quoteConfigurationId) ?? null,
      }
      return { item, attributes }
    })
  }
}
