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

export const ALLOWED_TRANSITIONS: Record<CpqStatus, CpqStatus[]> = {
  new: ['incomplete', 'ready', 'cancelled'],
  incomplete: ['ready', 'incomplete', 'cancelled'],
  ready: ['incomplete', 'in_approval', 'pre_approved', 'with_customer', 'cancelled'],
  in_approval: ['approved', 'rejected', 'cancelled'],
  pre_approved: ['with_customer'],
  approved: ['with_customer'],
  with_customer: ['accepted', 'rejected', 'cancelled'],
  accepted: [],
  rejected: [],
  cancelled: [],
}

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
}

export interface ValidationError {
  type?: 'attribute' | 'relationship'
  attribute?: string
  relationshipType?: string
  sourceSpec?: string
  targetSpec?: string
  message: string
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
  cpqStatus: string
  version: number
  parentQuoteId: string | null
  currencyCode: string
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

export interface ResolvedCharge {
  chargeCode: string
  chargeName: string
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod: 'flat' | 'tiered' | 'per_unit'
  unitPrice: number
  quantity: number | null
  totalPrice: number | null
  currencyCode: string
  breakdown?: TierBreakdown | null
  note?: string | null
  adjustments?: RuleAdjustment[] | null
}

// ─── Inventory status constants ──────────────────────────────────

export const INVENTORY_SUBSCRIPTION_STATUSES = ['pending', 'active', 'suspended', 'terminated', 'expired'] as const
export type InventorySubscriptionStatus = (typeof INVENTORY_SUBSCRIPTION_STATUSES)[number]

export const INVENTORY_SUBSCRIPTION_TRANSITIONS: Record<InventorySubscriptionStatus, InventorySubscriptionStatus[]> = {
  pending: ['active', 'terminated'],
  active: ['suspended', 'terminated', 'expired'],
  suspended: ['active', 'terminated'],
  terminated: [],
  expired: [],
}

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
