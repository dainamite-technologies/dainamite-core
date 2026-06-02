import type { EntityManager } from '@mikro-orm/postgresql'

// ─── Shared types for CPQ Quoting v2 ─────────────────────────────

export interface TenantScope {
  organizationId: string
  tenantId: string
}

const DEFAULT_CURRENCY = 'USD'

/**
 * Returns the base currency code for a given tenant scope.
 * Falls back to 'USD' if no base currency is found.
 */
export async function getBaseCurrencyCode(
  em: EntityManager,
  scope: TenantScope,
): Promise<string> {
  try {
    const { Currency } = await import(
      '@open-mercato/core/modules/currencies/data/entities'
    )
    const base = await em.findOne(Currency, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isBase: true,
      deletedAt: null,
    })
    return base?.code ?? DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

// ─── Quote lifecycle ─────────────────────────────────────────────

export const CPQ_STATUSES = [
  'new',
  'incomplete',
  'ready',
  'in_approval',
  'pre_approved',
  'approved',
  'with_customer',
  'accepted',
  'rejected',
  'cancelled',
] as const

export type CpqStatus = (typeof CPQ_STATUSES)[number]

export const TERMINAL_STATUSES: CpqStatus[] = ['accepted', 'rejected', 'cancelled']

// Per product decision: the CPQ status path is operator-driven and can
// jump between any pair of statuses. Self-transitions are excluded
// because they're no-ops. ARC-specific guards (`validateArcQuote`,
// concurrent-ARC checks) still run inside `transitionStatus` and are
// the real safety net — this table only enforces the "no self loop"
// invariant.
export const ALLOWED_TRANSITIONS: Record<CpqStatus, CpqStatus[]> = Object.fromEntries(
  CPQ_STATUSES.map((from) => [from, CPQ_STATUSES.filter((to) => to !== from)]),
) as Record<CpqStatus, CpqStatus[]>

// ─── Service input/output types ──────────────────────────────────

export interface CreateQuoteInput {
  customerId: string
  quoteId?: string                      // Link to existing SalesQuote instead of creating a new one
  dealId?: string
  currencyCode?: string
  quoteContext?: Record<string, string | number | boolean>
}

export interface QuoteItemInput {
  offeringId?: string
  productId?: string
  configuration: Record<string, unknown>
  quantity?: number
  usageEstimates?: Array<{ chargeCode: string; estimatedQuantity: number }>
  action?: 'add' | 'modify' | 'cancel'
  parentLineId?: string
  startDate?: string
  termMonths?: number
  endDate?: string
  /** XD-250 ARC: target subscription this line acts on. Auto-inherited from
   * the quote's single attached target when omitted. Required when the ARC
   * quote has multiple non-merge targets (operator must pick). */
  targetSubscriptionId?: string | null
}

export interface ValidationError {
  type?: 'attribute' | 'relationship'
  attribute?: string
  relationshipType?: string
  sourceSpec?: string
  targetSpec?: string
  message: string
}

/** XD-250 ARC: snapshot of the source subscription item's *current* state.
 * Surfaced on quote / order lines so the operator can compare "before" (this
 * snapshot) vs "after" (the line's current configuration). Null for lines
 * that aren't ARC-mirrored (e.g. a fresh `add` line on an amend quote). */
export interface ArcLineSource {
  subscriptionItemId: string
  name: string
  mrcAmount: number
  nrcAmount: number
  quantity: number
}

export interface QuoteLineResult {
  lineId: string
  offeringId: string | null
  offeringName: string
  offeringType: string | null
  productId: string | null
  action: string
  parentLineId: string | null
  quantity: number
  configuration: Record<string, unknown>
  startDate: string | null
  termMonths: number | null
  endDate: string | null
  nrcTotal: number
  mrcTotal: number
  usageEstimates: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null
  usageTotalEstimated: number | null
  charges: ResolvedCharge[]
  isConfigured: boolean
  validationErrors: ValidationError[] | null
  arcSource: ArcLineSource | null
  /** XD-250 multi-target ARC: which target subscription this line acts on. */
  targetSubscriptionId: string | null
}

export interface PricingSummary {
  nrcTotal: number
  mrcTotal: number
  usageCharges: Array<{
    chargeCode: string
    chargeName: string
    unitPrice: number
    note: string | null
  }>
  usageTotalEstimated: number | null
  discountTotal: number
  surchargeTotal: number
  currencyCode: string
}

export interface QuoteResult {
  id: string
  quoteId: string
  quoteNumber: string
  customerId: string
  /** Resolved customer display name (CustomerEntity.displayName). */
  customerName: string | null
  cpqStatus: string
  version: number
  parentQuoteId: string | null
  currencyCode: string
  /**
   * Set when this quote has been converted to a CPQ order. UI uses this
   * to lock editing and surface a "Go to order" entry point instead of
   * the Convert button. Backed by `CpqOrderConfiguration.sourceQuoteId`.
   */
  convertedOrderId: string | null
  validationResult: {
    valid: boolean
    errors: ValidationError[]
  }
  pricingSummary: PricingSummary
  lines: QuoteLineResult[]
}

// ─── Resolved charge (extended for v2) ───────────────────────────

export interface RuleAdjustment {
  ruleCode: string
  ruleName: string
  ruleType: string
  value: number
  unitPriceBefore: number
  unitPriceAfter: number
  delta: number
}

export interface TierBreakdown {
  tiers: Array<{
    tier: number
    from: number
    to: number
    pricePerUnit: number
    quantity: number
    subtotal: number
  }>
}

// ─── Charge model / pricing source (XD-297) ──────────────────────
// The charge "shape" is two orthogonal axes:
//   ChargeModel   — how quantity drives the charge.
//   PricingSource — where the unit price comes from.
export type ChargeModel = 'flat' | 'per_unit' | 'volume' | 'tiered'
export type PricingSource = 'fixed' | 'table'

/**
 * Resolve a charge's (chargeModel, pricingSource) from either the new split
 * columns or a legacy combined `pricingMethod` value (flat | per_unit | tiered).
 * Keeps the engine working for rows that predate the split / haven't been
 * migrated, and tolerates new clients that send the legacy value by mistake.
 */
export function normalizeChargePricing(charge: {
  chargeModel?: string | null
  pricingMethod?: string | null
  fixedPrice?: string | null
  pricingTableId?: string | null
}): { model: ChargeModel; source: PricingSource } {
  const pm = (charge.pricingMethod ?? '').toLowerCase()
  // Anything that historically meant "comes from a table" maps to source=table.
  const tableLike = pm === 'table' || pm === 'per_unit' || pm === 'tiered' || pm === 'volume'
  const source: PricingSource = tableLike
    ? 'table'
    : pm === 'fixed'
      ? 'fixed'
      // Legacy 'flat' (which could be fixed OR a flat table lookup), empty, or
      // unknown: infer from the presence of a pricing table.
      : charge.pricingTableId
        ? 'table'
        : 'fixed'

  const rawModel = (charge.chargeModel ?? '').toLowerCase()
  const model: ChargeModel =
    rawModel === 'flat' || rawModel === 'per_unit' || rawModel === 'volume' || rawModel === 'tiered'
      ? (rawModel as ChargeModel)
      // No explicit model → derive from the legacy combined pricingMethod.
      : pm === 'per_unit'
        ? 'per_unit'
        : pm === 'tiered'
          ? 'tiered'
          : 'flat'

  return { model, source }
}

export interface ResolvedCharge {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  // Display axis — the charge model (flat | per_unit | volume | tiered).
  pricingMethod: ChargeModel
  unitPrice: number
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  breakdown?: TierBreakdown | null
  note?: string | null
  adjustments?: RuleAdjustment[] | null
}

// ─── Inventory status constants ──────────────────────────────────

export const INVENTORY_SUBSCRIPTION_STATUSES = [
  'pending',
  'active',
  'suspended',
  'terminated',
  'expired',
  'superseded',
] as const
export type InventorySubscriptionStatus = (typeof INVENTORY_SUBSCRIPTION_STATUSES)[number]

export const INVENTORY_SUBSCRIPTION_TRANSITIONS: Record<InventorySubscriptionStatus, InventorySubscriptionStatus[]> = {
  pending: ['active', 'terminated'],
  active: ['suspended', 'terminated', 'expired', 'superseded'],
  suspended: ['active', 'terminated', 'superseded'],
  terminated: [],
  expired: [],
  superseded: [],
}

export const INVENTORY_SUBSCRIPTION_ITEM_STATUSES = [
  'pending',
  'active',
  'suspended',
  'terminated',
  'expired',
  'superseded',
] as const
export type InventorySubscriptionItemStatus = (typeof INVENTORY_SUBSCRIPTION_ITEM_STATUSES)[number]

export const INVENTORY_ASSET_STATUSES = ['pending', 'delivered', 'active', 'returned', 'cancelled'] as const
export type InventoryAssetStatus = (typeof INVENTORY_ASSET_STATUSES)[number]

export const INVENTORY_ASSET_TRANSITIONS: Record<InventoryAssetStatus, InventoryAssetStatus[]> = {
  pending: ['delivered', 'active', 'cancelled'],
  delivered: ['active', 'returned'],
  active: ['returned'],
  returned: [],
  cancelled: [],
}

// ─── Order status constants ─────────────────────────────────────

export const CPQ_ORDER_STATUSES = ['draft', 'pending_activation', 'active', 'cancelled', 'fulfilled'] as const
export type CpqOrderStatus = (typeof CPQ_ORDER_STATUSES)[number]

export const CPQ_ORDER_TRANSITIONS: Record<CpqOrderStatus, CpqOrderStatus[]> = {
  draft: ['pending_activation', 'active', 'cancelled'],
  pending_activation: ['active', 'cancelled'],
  active: ['fulfilled', 'cancelled'],
  cancelled: [],
  fulfilled: [],
}

// ─── ARC (Amend / Renew / Cancel) constants ─────────────────────

export const CPQ_QUOTE_TYPES = ['new', 'amend', 'renew', 'cancel'] as const
export type CpqQuoteType = (typeof CPQ_QUOTE_TYPES)[number]

export const ARC_QUOTE_TYPES: ReadonlyArray<Exclude<CpqQuoteType, 'new'>> = ['amend', 'renew', 'cancel']

export const CHANGE_LOG_TYPES = [
  'created',
  'amend',
  'renew',
  'cancel',
  'merge-result',
  'merge-source',
] as const
export type ChangeLogType = (typeof CHANGE_LOG_TYPES)[number]

export const MERGE_ACTIONS = ['standalone', 'absorb'] as const
export type MergeAction = (typeof MERGE_ACTIONS)[number]

export const ARC_REASON_CODES = [
  'upgrade',
  'downgrade',
  'config-change',
  'price-adjustment',
  'term-extension',
  'term-reduction',
  'consolidation',
  'customer-request',
  'non-payment',
  'contract-breach',
  'other',
] as const
export type ArcReasonCode = (typeof ARC_REASON_CODES)[number]
