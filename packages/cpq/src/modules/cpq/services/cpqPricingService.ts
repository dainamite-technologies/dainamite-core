import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqProductCharge, CpqPricingTable, CpqPricingTableEntry, CpqPriceRule } from '../data/entities'
import type { ResolvedCharge, RuleAdjustment, TierBreakdown } from './types'
import { getBaseCurrencyCode } from './types'
import { normalizeChargePricing } from '../data/charge-pricing'
import { lookupTablePrice, type LookupModel, type LookupTable, type TableLookupResult } from './costs/costLookup'

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

type PricedLookup = Extract<TableLookupResult, { outcome: 'priced' }>

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
      resolved.listUnitPrice = resolved.unitPrice
      resolved.listTotalPrice = resolved.totalPrice
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

    for (const resolved of results) {
      resolved.standardUnitPrice = resolved.unitPrice
      resolved.standardTotalPrice = resolved.totalPrice
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
          origin: 'rule',
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

    // Resolve the two axes (chargeModel × pricingSource), tolerating legacy
    // rows that still carry a combined pricingMethod (flat | per_unit | tiered).
    const { model, source } = normalizeChargePricing(charge)

    const fallbackCurrency = currencyCode ?? charge.currencyCode ?? await getBaseCurrencyCode(this.em, { tenantId, organizationId })
    const base: ResolvedCharge = {
      chargeCode: charge.code,
      chargeName: charge.name,
      chargeType: charge.chargeType as ResolvedCharge['chargeType'],
      pricingMethod: model,
      unitPrice: 0,
      quantity: 1,
      totalPrice: 0,
      currencyCode: fallbackCurrency,
    }

    // ── Fixed price: unit price is the charge's own fixedPrice. Also the
    // fallback when a table-sourced charge has no table configured yet. ──
    if (source === 'fixed' || !charge.pricingTableId) {
      const unitPrice = Number(charge.fixedPrice ?? 0)
      if (model === 'per_unit') {
        const quantity = Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0)
        return { ...base, unitPrice, quantity, totalPrice: unitPrice * quantity }
      }
      // flat (volume/tiered without a table degrade to a single flat price).
      return { ...base, unitPrice, quantity: 1, totalPrice: unitPrice }
    }

    // ── Table lookup ──
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
    const lookupModel: LookupModel = model
    const quantity = Number(configuration[charge.quantityAttributeCode ?? ''] ?? 0)
    const lookup = lookupTablePrice(
      { dimensions: table.dimensions, entries } as LookupTable,
      priceKey,
      lookupModel,
      configuration,
      quantity,
      currencyCode,
    )
    if (lookup.outcome === 'miss') return base
    if (lookup.outcome === 'zero_quantity') return { ...base, quantity: 0, totalPrice: 0 }

    if (model === 'flat') return this.applyFlat(base, charge, lookup)
    if (model === 'per_unit') return this.applyPerUnit(base, charge, lookup)
    if (model === 'volume') return this.applyVolume(base, lookup)
    if (model === 'tiered') return this.applyTiered(base, lookup)

    return base
  }

  private applyFlat(base: ResolvedCharge, charge: CpqProductCharge, lookup: PricedLookup): ResolvedCharge {
    if (charge.chargeType === 'usage') return this.usageResult(base, charge, lookup)
    return { ...base, unitPrice: lookup.unitPrice, quantity: 1, totalPrice: lookup.unitPrice, currencyCode: lookup.currencyCode ?? base.currencyCode }
  }

  private applyPerUnit(base: ResolvedCharge, charge: CpqProductCharge, lookup: PricedLookup): ResolvedCharge {
    if (charge.chargeType === 'usage') return this.usageResult(base, charge, lookup)
    return {
      ...base,
      unitPrice: lookup.unitPrice,
      quantity: lookup.quantity,
      totalPrice: lookup.totalPrice,
      currencyCode: lookup.currencyCode ?? base.currencyCode,
    }
  }

  private usageResult(base: ResolvedCharge, charge: CpqProductCharge, lookup: PricedLookup): ResolvedCharge {
    return {
      ...base,
      unitPrice: lookup.unitPrice,
      quantity: null,
      totalPrice: null,
      currencyCode: lookup.currencyCode ?? base.currencyCode,
      note: charge.description ?? 'Usage-based charge — billed on actual consumption.',
    }
  }

  private applyTiered(base: ResolvedCharge, lookup: PricedLookup): ResolvedCharge {
    return {
      ...base,
      unitPrice: lookup.unitPrice,
      quantity: lookup.quantity,
      totalPrice: lookup.totalPrice,
      breakdown: { tiers: lookup.tiers ?? [] },
      currencyCode: lookup.currencyCode ?? base.currencyCode,
    }
  }

  // Volume: whole quantity at one tier's rate (see lookupTablePrice).
  private applyVolume(base: ResolvedCharge, lookup: PricedLookup): ResolvedCharge {
    return {
      ...base,
      unitPrice: lookup.unitPrice,
      quantity: lookup.quantity,
      totalPrice: lookup.totalPrice,
      currencyCode: lookup.currencyCode ?? base.currencyCode,
    }
  }
}
