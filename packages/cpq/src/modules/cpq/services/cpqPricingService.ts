import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqProductCharge, CpqPricingTable, CpqPricingTableEntry, CpqPriceRule } from '../data/entities'
import type { ResolvedCharge, RuleAdjustment, TierBreakdown } from './types'
import { getBaseCurrencyCode } from './types'

export type { ResolvedCharge, RuleAdjustment, TierBreakdown }

export interface QuotePricingSummary {
  lines: Array<{
    lineId: string
    productId: string
    charges: ResolvedCharge[]
  }>
  totals: {
    nrcTotal: number
    mrcTotal: number
    usageCharges: Array<{ chargeCode: string; unitPrice: number; note: string }>
  }
  currencyCode: string
}

interface ApplicabilityCondition {
  attribute: string
  operator: 'eq' | 'neq'
  value: string
}

function evaluateApplicability(
  condition: Record<string, unknown> | null | undefined,
  configuration: Record<string, unknown>,
): boolean {
  if (!condition) return true
  const cond = condition as unknown as ApplicabilityCondition
  if (!cond.attribute || !cond.operator) return true
  const configValue = String(configuration[cond.attribute] ?? '')
  const conditionValue = String(cond.value ?? '')
  if (cond.operator === 'eq') return configValue === conditionValue
  if (cond.operator === 'neq') return configValue !== conditionValue
  return true
}

function entryMatchesDimensions(
  entry: CpqPricingTableEntry,
  dimensions: Array<{ key: string }>,
  configuration: Record<string, unknown>,
): boolean {
  return dimensions.every((dim) => {
    const configVal = String(configuration[dim.key] ?? '')
    const entryVal = String(entry.dimensionValues[dim.key] ?? '')
    return configVal.toLowerCase() === entryVal.toLowerCase()
  })
}

function matchEntry(
  entries: CpqPricingTableEntry[],
  dimensions: Array<{ key: string }>,
  configuration: Record<string, unknown>,
): CpqPricingTableEntry | null {
  return entries.find((entry) => entryMatchesDimensions(entry, dimensions, configuration)) ?? null
}

export class DefaultCpqPricingService {
  private em: EntityManager

  constructor(em: EntityManager) {
    this.em = em
  }

  /**
   * Resolve charges for an offering (v2) or product (v1 fallback).
   * When offeringId is provided, charges are loaded by offeringId.
   * When only productId is provided, falls back to loading by productId.
   */
  async resolveProductCharges(params: {
    offeringId?: string | null
    productId?: string | null
    configuration: Record<string, unknown>
    currencyCode?: string
    tenantId: string
    organizationId: string
  }): Promise<ResolvedCharge[]> {
    const { offeringId, productId, configuration, tenantId, organizationId, currencyCode } = params

    const chargeFilter: Record<string, unknown> = {
      tenantId,
      organizationId,
      isActive: true,
      deletedAt: null,
    }

    if (offeringId) {
      chargeFilter.offeringId = offeringId
    } else if (productId) {
      chargeFilter.productId = productId
    } else {
      return []
    }

    const charges = await this.em.find(CpqProductCharge, chargeFilter, {
      orderBy: { sortOrder: 'asc' },
    })

    const applicableCharges = charges.filter((charge) =>
      evaluateApplicability(charge.applicabilityCondition, configuration),
    )

    const results: ResolvedCharge[] = []
    for (const charge of applicableCharges) {
      const resolved = await this.calculateCharge({
        charge,
        configuration,
        tenantId,
        organizationId,
        currencyCode,
      })
      // R-CPRICE-8: quote-level currency overrides entry-level currency for consistency.
      // Entry filtering by currencyCode (line 274) ensures price values already match.
      if (currencyCode) {
        resolved.currencyCode = currencyCode
      }
      resolved.adjustments = []
      results.push(resolved)
    }

    const rules = await this.loadPriceRules({
      offeringId: offeringId ?? null,
      tenantId,
      organizationId,
    })

    if (rules.length > 0) {
      this.applyPriceRules(results, rules, configuration)
    }

    return results
  }

  private async loadPriceRules(params: {
    offeringId: string | null | undefined
    tenantId: string
    organizationId: string
  }): Promise<CpqPriceRule[]> {
    const { offeringId, tenantId, organizationId } = params

    const rules = await this.em.find(
      CpqPriceRule,
      {
        tenantId,
        organizationId,
        isActive: true,
        deletedAt: null,
        $or: [
          { productOfferingId: null },
          ...(offeringId ? [{ productOfferingId: offeringId }] : []),
        ],
      },
      { orderBy: { sortOrder: 'asc' } },
    )

    return rules
  }

  private applyPriceRules(
    charges: ResolvedCharge[],
    rules: CpqPriceRule[],
    configuration: Record<string, unknown>,
  ): void {
    for (const rule of rules) {
      if (!evaluateApplicability(rule.applicabilityCondition, configuration)) continue

      for (const charge of charges) {
        if (rule.chargeCodeFilter && rule.chargeCodeFilter !== charge.chargeCode) continue
        if (rule.chargeTypeFilter && rule.chargeTypeFilter !== charge.chargeType) continue

        const unitPriceBefore = charge.unitPrice
        const ruleValue = Number(rule.value)
        let unitPriceAfter: number
        let totalPriceOverride: number | undefined

        switch (rule.ruleType) {
          case 'discount_percent':
            unitPriceAfter = Math.max(0, unitPriceBefore * (1 - ruleValue / 100))
            break
          case 'discount_absolute': {
            const currentTotal = charge.totalPrice ?? unitPriceBefore
            totalPriceOverride = Math.max(0, currentTotal - ruleValue)
            const qty = charge.quantity && charge.quantity > 0 ? charge.quantity : 1
            unitPriceAfter = totalPriceOverride / qty
            break
          }
          case 'surcharge_percent':
            unitPriceAfter = unitPriceBefore * (1 + ruleValue / 100)
            break
          case 'surcharge_absolute': {
            const currentTotal = charge.totalPrice ?? unitPriceBefore
            totalPriceOverride = currentTotal + ruleValue
            const qty = charge.quantity && charge.quantity > 0 ? charge.quantity : 1
            unitPriceAfter = totalPriceOverride / qty
            break
          }
          case 'price_override':
            unitPriceAfter = ruleValue
            break
          default:
            continue
        }

        charge.unitPrice = unitPriceAfter

        if (charge.chargeType === 'usage') {
          // totalPrice stays null for usage charges
        } else if (totalPriceOverride !== undefined) {
          charge.totalPrice = totalPriceOverride
        } else if (charge.quantity !== null) {
          charge.totalPrice = unitPriceAfter * charge.quantity
        } else {
          charge.totalPrice = unitPriceAfter
        }

        const adjustment: RuleAdjustment = {
          ruleCode: rule.code,
          ruleName: rule.name,
          ruleType: rule.ruleType,
          value: ruleValue,
          unitPriceBefore,
          unitPriceAfter,
          delta: unitPriceAfter - unitPriceBefore,
        }

        if (!charge.adjustments) {
          charge.adjustments = [adjustment]
        } else {
          charge.adjustments.push(adjustment)
        }
      }
    }
  }

  async calculateCharge(params: {
    charge: CpqProductCharge
    configuration: Record<string, unknown>
    tenantId: string
    organizationId: string
    currencyCode?: string
  }): Promise<ResolvedCharge> {
    const { charge, configuration, tenantId, organizationId, currencyCode } = params

    // `fixed` is a legacy alias for `flat` — older seeds emit it directly
    // and ~30+ rows in prod still carry it. Treat them identically.
    const method = charge.pricingMethod === 'fixed' ? 'flat' : charge.pricingMethod

    // If charge has a fixed price and no pricing table, use fixed price directly
    if (charge.fixedPrice && !charge.pricingTableId) {
      const unitPrice = Number(charge.fixedPrice)
      return {
        chargeCode: charge.code,
        chargeName: charge.name,
        chargeType: charge.chargeType as ResolvedCharge['chargeType'],
        pricingMethod: method as ResolvedCharge['pricingMethod'],
        unitPrice,
        quantity: 1,
        totalPrice: unitPrice,
        currencyCode: charge.currencyCode ?? await getBaseCurrencyCode(this.em, { tenantId, organizationId }),
      }
    }

    const fallbackCurrency = currencyCode ?? charge.currencyCode ?? await getBaseCurrencyCode(this.em, { tenantId, organizationId })
    const base: ResolvedCharge = {
      chargeCode: charge.code,
      chargeName: charge.name,
      chargeType: charge.chargeType as ResolvedCharge['chargeType'],
      pricingMethod: method as ResolvedCharge['pricingMethod'],
      unitPrice: 0,
      quantity: 1,
      totalPrice: 0,
      currencyCode: fallbackCurrency,
    }

    if (!charge.pricingTableId) return base

    const table = await this.em.findOne(CpqPricingTable, {
      id: charge.pricingTableId,
      tenantId,
      organizationId,
    })
    if (!table) return base

    const entryFilters: Record<string, unknown> = {
      pricingTableId: table.id,
      tenantId,
      organizationId,
      isActive: true,
      deletedAt: null,
    }
    if (currencyCode) {
      entryFilters.currencyCode = currencyCode
    }

    const entries = await this.em.find(CpqPricingTableEntry, entryFilters)

    const priceKey = charge.priceColumnKey ?? ''

    if (method === 'flat') {
      return this.calculateFlat(base, charge, entries, table.dimensions, configuration, priceKey)
    }
    if (method === 'per_unit') {
      return this.calculatePerUnit(base, charge, entries, table.dimensions, configuration, priceKey)
    }
    if (method === 'tiered') {
      return this.calculateTiered(base, charge, entries, table.dimensions, configuration, priceKey)
    }

    return base
  }

  private calculateFlat(
    base: ResolvedCharge,
    charge: CpqProductCharge,
    entries: CpqPricingTableEntry[],
    dimensions: Array<{ key: string }>,
    configuration: Record<string, unknown>,
    priceKey: string,
  ): ResolvedCharge {
    const entry = matchEntry(entries, dimensions, configuration)
    if (!entry) return base
    const unitPrice = entry.prices[priceKey] ?? 0

    if (charge.chargeType === 'usage') {
      return {
        ...base,
        unitPrice,
        quantity: null,
        totalPrice: null,
        currencyCode: entry.currencyCode,
        note: charge.description ?? 'Usage-based charge — billed on actual consumption.',
      }
    }

    return { ...base, unitPrice, quantity: 1, totalPrice: unitPrice, currencyCode: entry.currencyCode }
  }

  private calculatePerUnit(
    base: ResolvedCharge,
    charge: CpqProductCharge,
    entries: CpqPricingTableEntry[],
    dimensions: Array<{ key: string }>,
    configuration: Record<string, unknown>,
    priceKey: string,
  ): ResolvedCharge {
    const entry = matchEntry(entries, dimensions, configuration)
    if (!entry) return base
    const unitPrice = entry.prices[priceKey] ?? 0
    const entryCurrency = entry.currencyCode

    if (charge.chargeType === 'usage') {
      return {
        ...base,
        unitPrice,
        quantity: null,
        totalPrice: null,
        currencyCode: entryCurrency,
        note: charge.description ?? 'Usage-based charge — billed on actual consumption.',
      }
    }

    const quantity = Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0)
    return { ...base, unitPrice, quantity, totalPrice: unitPrice * quantity, currencyCode: entryCurrency }
  }

  private calculateTiered(
    base: ResolvedCharge,
    charge: CpqProductCharge,
    entries: CpqPricingTableEntry[],
    dimensions: Array<{ key: string }>,
    configuration: Record<string, unknown>,
    priceKey: string,
  ): ResolvedCharge {
    const quantity = Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0)
    if (quantity <= 0) return { ...base, quantity: 0, totalPrice: 0 }

    // Restrict to the dimension-matched slice (e.g. tier = enterprise) before
    // allocating across tier ranges. Without this, ranges that belong to other
    // dimension values (tier = starter / pro) leak into the allocation and the
    // lookup returns a wrong or zero price. flat / per_unit already filter via
    // matchEntry; tiered must do the same.
    const matched = dimensions.length
      ? entries.filter((entry) => entryMatchesDimensions(entry, dimensions, configuration))
      : entries

    const sorted = [...matched].sort((a, b) => (a.tierNumber ?? 0) - (b.tierNumber ?? 0))

    let allocated = 0
    let total = 0
    const tiers: TierBreakdown['tiers'] = []
    let entryCurrency = base.currencyCode

    for (const entry of sorted) {
      if (allocated >= quantity) break
      const to = entry.rangeTo ? Number(entry.rangeTo) : Infinity
      const tierCeil = to === Infinity ? quantity : Math.min(to, quantity)
      const qty = tierCeil - allocated
      if (qty <= 0) continue
      const price = entry.prices[priceKey] ?? 0
      entryCurrency = entry.currencyCode
      tiers.push({
        tier: entry.tierNumber ?? 0,
        from: allocated + 1,
        to: allocated + qty,
        pricePerUnit: price,
        quantity: qty,
        subtotal: qty * price,
      })
      total += qty * price
      allocated += qty
    }

    return {
      ...base,
      unitPrice: quantity > 0 ? total / quantity : 0,
      quantity,
      totalPrice: total,
      breakdown: { tiers },
      currencyCode: entryCurrency,
    }
  }
}
