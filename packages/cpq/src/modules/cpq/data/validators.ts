import { z } from 'zod'
import { normalizeChargePricing } from '../services/types'

// ─── Product Specification ───────────────────────────────────────

export const cpqProductSpecificationCreateSchema = z.object({
  productId: z.string().uuid().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  specType: z.enum(['simple', 'bundle']).optional().default('simple'),
  isAssetizable: z.boolean().optional().default(false),
  // `retired` was merged into `deprecated` — see migration
  // `<timestamp>-merge-spec-retired-into-deprecated.ts`. Offerings still have
  // four states because the user-facing semantics there are different
  // (a retired offering can't be re-sold; a deprecated one can but is
  // discouraged).
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated']).optional().default('draft'),
  version: z.number().int().optional().default(1),
  effectiveFrom: z.string().datetime().nullish(),
  effectiveTo: z.string().datetime().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean().optional().default(true),
})

export const cpqProductSpecificationUpdateSchema = cpqProductSpecificationCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// ─── Product Offering ────────────────────────────────────────────

export const cpqProductOfferingCreateSchema = z.object({
  specId: z.string().uuid(),
  catalogOfferId: z.string().uuid().nullish(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  offeringType: z.enum(['simple', 'bundle']).optional().default('simple'),
  designTimeValues: z.record(z.string(), z.unknown()).optional().default({}),
  // `retired` was merged into `deprecated` — see migration
  // `<timestamp>-merge-offering-retired-into-deprecated.ts`. Aligned with
  // specifications: a single 3-state lifecycle keeps the UX uniform.
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated']).optional().default('draft'),
  effectiveFrom: z.string().datetime().nullish(),
  effectiveTo: z.string().datetime().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean().optional().default(true),
})

export const cpqProductOfferingUpdateSchema = cpqProductOfferingCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// ─── Bundle Slot ─────────────────────────────────────────────────

export const cpqBundleSlotCreateSchema = z.object({
  specId: z.string().uuid(),
  targetSpecId: z.string().uuid(),
  componentGroup: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  cardinalityMin: z.number().int().min(0).optional().default(0),
  cardinalityMax: z.number().int().min(0).nullish(),
  sortOrder: z.number().int().optional().default(0),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const cpqBundleSlotUpdateSchema = z.object({
  id: z.string().uuid(),
  componentGroup: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  cardinalityMin: z.number().int().min(0).optional(),
  cardinalityMax: z.number().int().min(0).nullish(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

// ─── Offering Component ─────────────────────────────────────────

export const cpqOfferingComponentCreateSchema = z.object({
  offeringId: z.string().uuid(),
  slotId: z.string().uuid(),
  childOfferingId: z.string().uuid(),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const cpqOfferingComponentUpdateSchema = z.object({
  id: z.string().uuid(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

// ─── Product Relationship ────────────────────────────────────────

export const cpqProductRelationshipCreateSchema = z.object({
  sourceSpecId: z.string().uuid(),
  targetSpecId: z.string().uuid(),
  relationshipType: z.enum(['parent_child', 'requires', 'excludes']),
  cardinalityMin: z.number().int().optional().default(0),
  cardinalityMax: z.number().int().nullish(),
  condition: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  isActive: z.boolean().optional().default(true),
})

export const cpqProductRelationshipUpdateSchema = cpqProductRelationshipCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// ─── Product Attribute ───────────────────────────────────────────

export const cpqProductAttributeCreateSchema = z.object({
  productId: z.string().uuid().optional(),
  specId: z.string().uuid().nullish(),
  code: z.string().min(1),
  name: z.string().min(1),
  attributeType: z.enum(['enum', 'number', 'text', 'boolean', 'select', 'multi-select', 'reference']),
  resolutionTime: z.enum(['design_time', 'run_time']).optional().default('run_time'),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullish(),
  constraints: z.record(z.string(), z.unknown()).nullish(),
  referenceEntity: z.string().nullish(),
  referenceFilter: z.record(z.string(), z.unknown()).nullish(),
  dependsOn: z.record(z.string(), z.unknown()).nullish(),
  defaultValue: z.unknown().nullish(),
  helpText: z.string().nullish(),
  sortOrder: z.number().int().optional().default(0),
  isRequired: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
})

export const cpqProductAttributeUpdateSchema = cpqProductAttributeCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// `fixed` is a legacy alias for `flat` — older seeds (`demo_puffin`,
// `demo_gix`) emit it directly and ~30+ rows in prod use it. The pricing
// service treats them identically (fixedPrice + currencyCode, no table
// lookup). XD-297 splits the charge "shape" into two axes — chargeModel
// (flat | per_unit | volume | tiered) and pricingMethod (fixed | table).
// Input accepts either the new split OR a legacy combined pricingMethod
// (flat | per_unit | tiered); normalizeChargePricing() collapses both to a
// canonical {model, source} that the route persists.
const cpqChargeModelEnum = z.enum(['flat', 'per_unit', 'volume', 'tiered'])
// New sources (fixed | table) plus the legacy combined values for back-compat.
const cpqChargePricingMethodEnum = z.enum(['fixed', 'table', 'flat', 'tiered', 'per_unit'])

const requireField = (
  ctx: z.RefinementCtx,
  value: unknown,
  path: string,
  msg: string,
) => {
  if (value === undefined || value === null || value === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg })
  }
}

const forbidField = (
  ctx: z.RefinementCtx,
  value: unknown,
  path: string,
  msg: string,
) => {
  if (value !== undefined && value !== null && value !== '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg })
  }
}

// Shared shape between create/update so the refinement logic stays in one
// place. Update is `.partial()` so its refinement runs only when fields
// are present.
const cpqProductChargeBase = z.object({
  productId: z.string().uuid().optional(),
  offeringId: z.string().uuid().nullish(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  chargeType: z.enum(['nrc', 'mrc', 'usage']),
  chargeModel: cpqChargeModelEnum.optional(),
  pricingMethod: cpqChargePricingMethodEnum,
  pricingTableId: z.string().uuid().nullish(),
  priceColumnKey: z.string().nullish(),
  fixedPrice: z.union([z.string(), z.number().transform(String)]).nullish(),
  currencyCode: z.string().nullish(),
  quantityAttributeCode: z.string().nullish(),
  applicabilityCondition: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
})

// V-CHG-1: the (chargeModel × pricingMethod) combination must match the fields.
//  fixed  → fixedPrice + currencyCode required; table fields forbidden.
//           flat: no quantity attr; per_unit: quantity attr required.
//           volume / tiered + fixed is not a valid combination.
//  table  → pricingTableId + priceColumnKey required; fixedPrice forbidden.
//           flat: no quantity attr; per_unit / volume / tiered: quantity attr required.
const refineChargePricingShape = (
  ctx: z.RefinementCtx,
  charge: {
    chargeModel?: 'flat' | 'per_unit' | 'volume' | 'tiered'
    pricingMethod?: 'fixed' | 'table' | 'flat' | 'tiered' | 'per_unit'
    pricingTableId?: string | null
    priceColumnKey?: string | null
    fixedPrice?: string | null
    currencyCode?: string | null
    quantityAttributeCode?: string | null
  },
) => {
  if (charge.pricingMethod === undefined && charge.chargeModel === undefined) return
  const { model, source } = normalizeChargePricing(charge)

  if (source === 'fixed') {
    if (model === 'volume' || model === 'tiered') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pricingMethod'],
        message: `V-CHG-1: ${model} pricing requires Table Lookup, not a fixed price`,
      })
      return
    }
    requireField(ctx, charge.fixedPrice, 'fixedPrice', 'V-CHG-1: fixedPrice is required for a fixed price')
    requireField(ctx, charge.currencyCode, 'currencyCode', 'V-CHG-1: currencyCode is required for a fixed price')
    forbidField(ctx, charge.pricingTableId, 'pricingTableId', 'V-CHG-1: pricingTableId must be empty for a fixed price')
    forbidField(ctx, charge.priceColumnKey, 'priceColumnKey', 'V-CHG-1: priceColumnKey must be empty for a fixed price')
    if (model === 'per_unit') {
      requireField(ctx, charge.quantityAttributeCode, 'quantityAttributeCode', 'V-CHG-1: quantityAttributeCode is required for per-unit pricing')
    } else {
      forbidField(ctx, charge.quantityAttributeCode, 'quantityAttributeCode', 'V-CHG-1: quantityAttributeCode must be empty for a flat fixed price')
    }
    return
  }

  // source === 'table'
  requireField(ctx, charge.pricingTableId, 'pricingTableId', 'V-CHG-1: pricingTableId is required for table lookup')
  requireField(ctx, charge.priceColumnKey, 'priceColumnKey', 'V-CHG-1: priceColumnKey is required for table lookup')
  forbidField(ctx, charge.fixedPrice, 'fixedPrice', 'V-CHG-1: fixedPrice must be empty for table lookup — price comes from the table')
  if (model === 'flat') {
    forbidField(ctx, charge.quantityAttributeCode, 'quantityAttributeCode', 'V-CHG-1: quantityAttributeCode must be empty for a flat table price')
  } else {
    requireField(ctx, charge.quantityAttributeCode, 'quantityAttributeCode', `V-CHG-1: quantityAttributeCode is required for ${model} pricing`)
  }
}

export const cpqProductChargeCreateSchema = cpqProductChargeBase.superRefine((data, ctx) => {
  refineChargePricingShape(ctx, data)
})

export const cpqProductChargeUpdateSchema = cpqProductChargeBase.partial().extend({
  id: z.string().uuid(),
}).superRefine((data, ctx) => {
  // On update, only enforce shape if pricingMethod is present in payload
  // (PATCH semantics — service merges with the persisted row).
  if (data.pricingMethod !== undefined) refineChargePricingShape(ctx, data)
})

// ─── Price Rule ──────────────────────────────────────────────────

export const cpqPriceRuleCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  productOfferingId: z.string().uuid().nullish(),
  ruleType: z.enum(['discount_percent', 'discount_absolute', 'surcharge_percent', 'surcharge_absolute', 'price_override']),
  value: z.number().min(0),
  chargeCodeFilter: z.string().nullish(),
  chargeTypeFilter: z.enum(['nrc', 'mrc', 'usage']).nullish(),
  applicabilityCondition: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
})

export const cpqPriceRuleUpdateSchema = cpqPriceRuleCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// ─── Pricing Table ───────────────────────────────────────────────

// V-PT-1: every dimension / price column needs a non-empty key + label,
// and keys must be unique within their list (charges reference them by
// key — duplicates would make lookup ambiguous).
const keyLabelItem = z.object({
  key: z.string().min(1, 'Key is required'),
  label: z.string().min(1, 'Label is required'),
})

const uniqueKeys = (label: string) =>
  (items: Array<{ key: string }>, ctx: z.RefinementCtx) => {
    const seen = new Set<string>()
    items.forEach((item, idx) => {
      if (seen.has(item.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [idx, 'key'],
          message: `V-PT-1: duplicate ${label} key "${item.key}"`,
        })
      }
      seen.add(item.key)
    })
  }

export const cpqPricingTableCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  dimensions: z.array(keyLabelItem).superRefine(uniqueKeys('dimension')),
  priceColumns: z.array(keyLabelItem).superRefine(uniqueKeys('price column')),
  currencyCodeList: z.array(z.string().min(1)).min(1),
  isActive: z.boolean().optional().default(true),
})

export const cpqPricingTableUpdateSchema = cpqPricingTableCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const cpqPricingTableEntryCreateSchema = z.object({
  pricingTableId: z.string().uuid(),
  dimensionValues: z.record(z.string(), z.string()),
  tierNumber: z.number().int().nullish(),
  rangeFrom: z.number().nullish(),
  rangeTo: z.number().nullish(),
  currencyCode: z.string().min(1).optional().default('USD'),
  prices: z.record(z.string(), z.number()),
  isActive: z.boolean().optional().default(true),
})

export const cpqPricingTableEntryUpdateSchema = cpqPricingTableEntryCreateSchema.partial().extend({
  id: z.string().uuid(),
})

// ─── Quoting v2 ─────────────────────────────────────────────────

export const cpqQuoteTypeEnum = z.enum(['new', 'amend', 'renew', 'cancel'])
export const cpqArcQuoteTypeEnum = z.enum(['amend', 'renew', 'cancel'])
export const cpqMergeActionEnum = z.enum(['standalone', 'absorb'])
export const cpqArcReasonCodeEnum = z.enum([
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
])

export const cpqCreateQuoteSchema = z.object({
  customerId: z.string().uuid(),
  quoteId: z.string().uuid().optional(),      // Link to existing SalesQuote
  dealId: z.string().uuid().optional(),
  currencyCode: z.string().min(1).optional(),
  quoteType: cpqQuoteTypeEnum.optional().default('new'),
})

// Server enforces the one-way rule (new → amend|renew|cancel only) in the
// service layer; the schema just shapes the body.
export const cpqUpdateQuoteSchema = z.object({
  quoteType: cpqQuoteTypeEnum.optional(),
})

const cpqPricePreviewItemSchema = z.object({
  offeringId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  configuration: z.record(z.string(), z.unknown()),
}).refine(
  (item) => item.offeringId || item.productId,
  { message: 'One of offeringId or productId is required' },
)

export const cpqPricePreviewSchema = z.object({
  primaryItem: cpqPricePreviewItemSchema.nullish(),
  childItems: z.array(cpqPricePreviewItemSchema),
  currencyCode: z.string().min(1).optional(),
})

export const cpqAddQuoteItemSchema = z.object({
  offeringId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
  quantity: z.number().int().min(1).optional().default(1),
  usageEstimates: z
    .array(
      z.object({
        chargeCode: z.string().min(1),
        estimatedQuantity: z.number().min(0),
      }),
    )
    .optional(),
  action: z.enum(['add', 'modify', 'cancel']).optional().default('add'),
  parentLineId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  termMonths: z.number().int().min(1).optional(),
  endDate: z.string().optional(),
  // ARC (XD-250): per-line target sub for amend / renew (standalone) / cancel.
  targetSubscriptionId: z.string().uuid().nullish(),
  // ARC (XD-250): existing item being changed by cancel/modify lines.
  sourceSubscriptionItemId: z.string().uuid().nullish(),
})

export const cpqUpdateQuoteItemSchema = z.object({
  configuration: z.record(z.string(), z.unknown()),
  quantity: z.number().int().min(1).optional(),
  usageEstimates: z
    .array(
      z.object({
        chargeCode: z.string().min(1),
        estimatedQuantity: z.number().min(0),
      }),
    )
    .optional(),
  startDate: z.string().optional(),
  termMonths: z.number().int().min(1).optional(),
  endDate: z.string().optional(),
  targetSubscriptionId: z.string().uuid().nullish(),
  sourceSubscriptionItemId: z.string().uuid().nullish(),
})

// ─── ARC (Amend / Renew / Cancel) — XD-250 ──────────────────────

export const cpqCreateQuoteFromSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  type: cpqArcQuoteTypeEnum,
  renewTerm: z
    .object({
      newTermStart: z.string().min(1),
      newTermEnd: z.string().min(1),
      newTermMonths: z.number().int().min(1).optional(),
    })
    .optional(),
})

export const cpqAttachTargetSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  quoteType: cpqArcQuoteTypeEnum,
  mergeAction: cpqMergeActionEnum.optional(),
  newTermStart: z.string().min(1).optional(),
  newTermEnd: z.string().min(1).optional(),
  newTermMonths: z.number().int().min(1).optional(),
})

export const cpqUpdateTargetSubscriptionSchema = z.object({
  mergeAction: cpqMergeActionEnum.optional(),
  newTermStart: z.string().min(1).nullish(),
  newTermEnd: z.string().min(1).nullish(),
  newTermMonths: z.number().int().min(1).nullish(),
})

export const cpqCancelMetaSchema = z.object({
  reasonCode: cpqArcReasonCodeEnum,
  reasonText: z.string().nullish(),
  etfAmount: z
    .union([z.string(), z.number().transform(String)])
    .nullish(),
  etfCurrency: z.string().min(1).max(3).nullish(),
})

export const cpqMergeMetaSchema = z.object({
  newTermStart: z.string().min(1),
  newTermEnd: z.string().min(1),
  newTermMonths: z.number().int().min(1).optional(),
  newSubCode: z.string().min(1).nullish(),
  newSubName: z.string().min(1).nullish(),
})

export const cpqExpiringSubscriptionsQuerySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).optional().default(30),
  customerId: z.string().uuid().optional(),
  billingCycle: z.enum(['monthly', 'quarterly', 'annually']).optional(),
  status: z.string().optional().default('active'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const cpqChangeLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export const cpqRecalculateSchema = z.object({
  save: z.boolean(),
})

export const cpqTransitionStatusSchema = z.object({
  targetStatus: z.string().min(1),
})

export const cpqValidateRelationshipsSchema = z.object({
  offeringIds: z.array(z.string().uuid()),
  parentChildPairs: z
    .array(
      z.object({
        parentOfferingId: z.string().uuid(),
        childOfferingId: z.string().uuid(),
      }),
    )
    .optional()
})

// ─── Wizard ─────────────────────────────────────────────────────

const wizardTransitionConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'exists', 'not_exists', 'in']),
  value: z.unknown().optional(),
})

const wizardTransitionSchema = z.object({
  targetStepId: z.string().min(1),
  condition: wizardTransitionConditionSchema.optional(),
  isDefault: z.boolean().optional(),
  label: z.string().optional(),
})

const wizardStepValidationSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'exists', 'not_exists']),
  value: z.unknown().optional(),
  message: z.string().min(1),
})

const wizardStepDefinitionSchema = z.object({
  stepId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  config: z.record(z.string(), z.unknown()).default({}),
  transitions: z.array(wizardTransitionSchema).default([]),
  isOptional: z.boolean().optional().default(false),
  validationRules: z.array(wizardStepValidationSchema).optional(),
})

const wizardApplicabilitySchema = z.object({
  specCodes: z.array(z.string()).optional(),
  offeringCodes: z.array(z.string()).optional(),
  customerSegments: z.array(z.string()).optional(),
  surface: z.enum(['backend', 'portal']).optional(),
  priority: z.number().int().optional().default(0),
})

export const cpqWizardDefinitionCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  steps: z.array(wizardStepDefinitionSchema).min(1),
  applicability: wizardApplicabilitySchema.nullish(),
  paramsSchema: z.record(z.string(), z.unknown()).nullish(),
  surface: z.enum(['backend', 'portal', 'any']).optional().default('backend'),
  isActive: z.boolean().optional().default(true),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const cpqWizardDefinitionUpdateSchema = cpqWizardDefinitionCreateSchema.partial().extend({
  id: z.string().uuid(),
})
// ─── Inventory Subscription ──────────────────────────────────────

const cpqInventorySubscriptionItemInputSchema = z.object({
  parentItemId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  offeringId: z.string().uuid().nullish(),
  specId: z.string().uuid().nullish(),
  name: z.string().min(1),
  configuration: z.record(z.string(), z.unknown()).optional().default({}),
  charges: z.array(z.record(z.string(), z.unknown())).nullish(),
  mrcAmount: z.number().optional().default(0),
  nrcAmount: z.number().optional().default(0),
  currencyCode: z.string().min(1).optional(),
  quantity: z.number().int().min(1).optional().default(1),
  capacityTotal: z.number().nullish(),
  capacityUnit: z.string().nullish(),
  sourceQuoteLineId: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional().default(0),
})

export const cpqInventorySubscriptionCreateSchema = z.object({
  customerId: z.string().uuid(),
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().nullish(),
  billingCycle: z.enum(['monthly', 'quarterly', 'annually']).optional().default('monthly'),
  currencyCode: z.string().min(1).optional(),
  startDate: z.string().nullish(),
  termMonths: z.number().int().min(1).nullish(),
  autoRenew: z.boolean().optional().default(true),
  sourceQuoteId: z.string().uuid().nullish(),
  sourceOrderId: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  items: z.array(cpqInventorySubscriptionItemInputSchema).min(1),
})

export const cpqInventorySubscriptionUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  billingCycle: z.enum(['monthly', 'quarterly', 'annually']).optional(),
  autoRenew: z.boolean().optional(),
  termMonths: z.number().int().min(1).nullish(),
  currentTermEnd: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const cpqInventoryStatusTransitionSchema = z.object({
  id: z.string().uuid(),
  targetStatus: z.string().min(1),
})

// ─── Inventory Subscription Item ─────────────────────────────────

export const cpqInventorySubscriptionItemCreateSchema = z.object({
  subscriptionId: z.string().uuid(),
  parentItemId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  offeringId: z.string().uuid().nullish(),
  specId: z.string().uuid().nullish(),
  name: z.string().min(1),
  configuration: z.record(z.string(), z.unknown()).optional().default({}),
  charges: z.array(z.record(z.string(), z.unknown())).nullish(),
  mrcAmount: z.number().optional().default(0),
  nrcAmount: z.number().optional().default(0),
  currencyCode: z.string().min(1).optional(),
  quantity: z.number().int().min(1).optional().default(1),
  capacityTotal: z.number().nullish(),
  capacityUnit: z.string().nullish(),
  sourceQuoteLineId: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional().default(0),
})

export const cpqInventorySubscriptionItemUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  capacityTotal: z.number().nullish(),
  capacityUsed: z.number().nullish(),
  capacityUnit: z.string().nullish(),
  sortOrder: z.number().int().optional(),
})

// ─── Inventory Asset ─────────────────────────────────────────────

export const cpqInventoryAssetCreateSchema = z.object({
  customerId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullish(),
  subscriptionItemId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  offeringId: z.string().uuid().nullish(),
  specId: z.string().uuid().nullish(),
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().nullish(),
  assetType: z.enum(['one_time', 'license', 'physical', 'logical']).optional().default('one_time'),
  currencyCode: z.string().min(1).optional(),
  purchasePrice: z.number().optional().default(0),
  quantity: z.number().int().min(1).optional().default(1),
  purchaseDate: z.string().nullish(),
  deliveryDate: z.string().nullish(),
  configuration: z.record(z.string(), z.unknown()).optional().default({}),
  charges: z.array(z.record(z.string(), z.unknown())).nullish(),
  sourceQuoteId: z.string().uuid().nullish(),
  sourceOrderId: z.string().uuid().nullish(),
  sourceQuoteLineId: z.string().uuid().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const cpqInventoryAssetUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  assetType: z.enum(['one_time', 'license', 'physical', 'logical']).optional(),
  deliveryDate: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

// ─── CPQ Orders ──────────────────────────────────────────────────

export const cpqConvertQuoteToOrderSchema = z.object({
  quoteId: z.string().uuid(),
})

export const cpqOrderStatusTransitionSchema = z.object({
  targetStatus: z.string().min(1),
})
