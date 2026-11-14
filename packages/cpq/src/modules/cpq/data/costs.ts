import { z } from 'zod'

/**
 * Cost-plus pricing (App Spec `2026-11-11-app-spec-cpq-cost-plus-pricing.md`).
 * Pure constants and schemas shared by services, routes, setup and the UI.
 */

/** Tenant feature toggle (R14): boolean, default off, per-tenant override. */
export const COST_PLUS_TOGGLE = 'cpq.cost_plus'

/** See cost values, suppliers, markup and margin (App Spec §1.4.10). */
export const COSTS_VIEW_FEATURE = 'cpq.costs.view'
/** Add / edit manual costs, enter or confirm costs, markup overrides. */
export const COSTS_MANAGE_FEATURE = 'cpq.costs.manage'

/** `CpqPricingTable.purpose`: `cost` tables are readable only with `cpq.costs.view`. */
export const PRICING_TABLE_PURPOSES = ['price', 'cost'] as const
export type PricingTablePurpose = (typeof PRICING_TABLE_PURPOSES)[number]
export const isCostTable = (table: { purpose?: string | null }): boolean => table.purpose === 'cost'

// ─── Quote line costs (App Spec §1.4.6) ─────────────────────────

/** `carried` arrives with the ARC feature. */
export const COST_LINE_ORIGINS = ['catalog', 'manual'] as const
export const COST_VALUE_STATUSES = ['none', 'estimated', 'confirmed'] as const
/** `supplier` / `carried` arrive with the sourcing / ARC features. */
export const COST_VALUE_ORIGINS = ['catalog', 'manual'] as const
export const COST_SOURCING_STATUSES = ['not_requested', 'requested', 'answered', 'declined', 'cancelled'] as const
export const COST_LINE_ERROR_CODES = ['TABLE_NO_MATCH', 'CURRENCY_NO_RATE', 'INDEX_NO_VALUE', 'CHARGE_NOT_FOUND', 'COST_PLUS_DISABLED'] as const
export type CostValueStatus = (typeof COST_VALUE_STATUSES)[number]
export type CostLineErrorCode = (typeof COST_LINE_ERROR_CODES)[number]

// ─── Order line and inventory costs (feature 2, App Spec §1.4.6) ─

/**
 * `CpqInventoryCost.status`. A cost is *open* when it is `active` and its owner
 * is live (feature spec Q6); `ended` is set by Cancel / item removal (Q8).
 */
export const INVENTORY_COST_STATUSES = ['active', 'ended'] as const
export type InventoryCostStatus = (typeof INVENTORY_COST_STATUSES)[number]
/** The record that owns an inventory cost: exactly one of `subscription_item_id` / `asset_id` (Q2). */
export const INVENTORY_COST_OWNER_TYPES = ['subscription_item', 'asset'] as const
export type InventoryCostOwnerType = (typeof INVENTORY_COST_OWNER_TYPES)[number]

// ─── Charge cost elements (App Spec §1.4.4) ─────────────────────

export const COST_ROLES = ['price_basis', 'margin_only'] as const
export const COST_TYPES = ['nrc', 'mrc'] as const
/** `index` is declared for the contract but refused until the index-costs feature ships. */
export const COST_SOURCES = ['fixed', 'table', 'index', 'on_request'] as const
export const AVAILABLE_COST_SOURCES = ['fixed', 'table', 'on_request'] as const
export const COST_MODELS = ['flat', 'per_unit', 'tiered', 'volume'] as const

// numeric(18,4): never silently round an entered amount.
export const costAmount = z.number().finite().min(0).max(99_999_999_999_999).multipleOf(0.0001)
const elementFields = {
  name: z.string().trim().min(1).max(255),
  role: z.enum(COST_ROLES),
  costType: z.enum(COST_TYPES),
  source: z.enum(COST_SOURCES),
  costModel: z.enum(COST_MODELS),
  amount: costAmount.nullish(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullish(),
  costTableId: z.string().uuid().nullish(),
  costColumnKey: z.string().trim().min(1).max(255).nullish(),
  estimateAmount: costAmount.nullish(),
  defaultSupplierId: z.string().uuid().nullish(),
  defaultSupplierName: z.string().trim().max(255).nullish(),
  defaultValidityDays: z.number().int().min(1).max(3650).nullish(),
  requiresSourcing: z.boolean().optional(),
  applicabilityCondition: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
}

export const cpqChargeCostElementCreateSchema = z.object({
  productChargeId: z.string().uuid(),
  // Becomes the cost key on quote / order / inventory costs; immutable.
  code: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/, 'Letters, digits, _ . - only'),
  ...elementFields,
}).strict()

/** `productChargeId` and `code` are immutable: not accepted on update. */
export const cpqChargeCostElementUpdateSchema = z.object({ id: z.string().uuid(), ...elementFields }).partial({
  name: true, role: true, costType: true, source: true, costModel: true,
}).strict()

export type ChargeCostElementInput = z.infer<typeof cpqChargeCostElementCreateSchema>
export type ChargeCostElementPatch = z.infer<typeof cpqChargeCostElementUpdateSchema>

/** The fields the §1.4.4 combination rules look at (numbers or numeric strings). */
export type CostElementShape = {
  role: string
  costType: string
  source: string
  costModel: string
  amount?: number | string | null
  currencyCode?: string | null
  costTableId?: string | null
  costColumnKey?: string | null
  estimateAmount?: number | string | null
}

const present = (value: unknown) => value !== undefined && value !== null && value !== ''

/**
 * Field-only combination rules (App Spec §1.4.4). Returns the first violated
 * rule code, or null. Codes are returned as `422 { error: CODE }`.
 */
export function costElementShapeError(element: CostElementShape): string | null {
  if (!(AVAILABLE_COST_SOURCES as readonly string[]).includes(element.source)) return 'SOURCE_NOT_AVAILABLE'
  if ((element.costModel === 'tiered' || element.costModel === 'volume') && element.source !== 'table') return 'MODEL_REQUIRES_TABLE'
  if (element.source === 'fixed') {
    if (!present(element.amount)) return 'AMOUNT_REQUIRED'
    if (!present(element.currencyCode)) return 'CURRENCY_REQUIRED'
    if (present(element.costTableId) || present(element.costColumnKey) || present(element.estimateAmount)) return 'FIELD_NOT_ALLOWED'
    return null
  }
  if (element.source === 'table') {
    if (!present(element.costTableId) || !present(element.costColumnKey)) return 'TABLE_REQUIRED'
    if (present(element.amount) || present(element.estimateAmount)) return 'FIELD_NOT_ALLOWED'
    return null
  }
  // on_request: an optional catalog estimate, instantiated as `estimated` (Q-D2).
  if (present(element.amount) || present(element.costTableId) || present(element.costColumnKey)) return 'FIELD_NOT_ALLOWED'
  if (present(element.estimateAmount) && !present(element.currencyCode)) return 'CURRENCY_REQUIRED'
  return null
}

/**
 * Rules against the owning charge and the referenced cost table. Returns the
 * first violated rule code, or null.
 */
export function costElementContextError(
  element: CostElementShape,
  charge: { pricingMethod: string; chargeType: string; quantityAttributeCode?: string | null },
  table: { purpose: string; priceColumns: Array<{ key: string }> } | null,
): string | null {
  if (element.role === 'price_basis') {
    if (charge.pricingMethod !== 'cost_plus') return 'PRICE_BASIS_REQUIRES_COST_PLUS'
    if (element.costType !== charge.chargeType) return 'COST_TYPE_MISMATCH'
  }
  if (element.costModel !== 'flat' && !present(charge.quantityAttributeCode)) return 'QUANTITY_ATTRIBUTE_REQUIRED'
  if (element.source === 'table') {
    if (!table) return 'COST_TABLE_NOT_FOUND'
    if (table.purpose !== 'cost') return 'WRONG_TABLE_PURPOSE'
    if (!table.priceColumns.some((column) => column.key === element.costColumnKey)) return 'COLUMN_NOT_FOUND'
  }
  return null
}
