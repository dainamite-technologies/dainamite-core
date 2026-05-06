import { z } from 'zod'

// ─── Product Specification ───────────────────────────────────────

export const cpqProductSpecificationCreateSchema = z.object({
  productId: z.string().uuid().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  specType: z.enum(['simple', 'bundle']).optional().default('simple'),
  isAssetizable: z.boolean().optional().default(false),
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated', 'retired']).optional().default('draft'),
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
  lifecycleStatus: z.enum(['draft', 'active', 'deprecated', 'retired']).optional().default('draft'),
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

export const cpqProductChargeCreateSchema = z.object({
  productId: z.string().uuid().optional(),
  offeringId: z.string().uuid().nullish(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  chargeType: z.enum(['nrc', 'mrc', 'usage']),
  pricingMethod: z.enum(['flat', 'tiered', 'per_unit']),
  pricingTableId: z.string().uuid().nullish(),
  priceColumnKey: z.string().nullish(),
  fixedPrice: z.union([z.string(), z.number().transform(String)]).nullish(),
  currencyCode: z.string().nullish(),
  quantityAttributeCode: z.string().nullish(),
  applicabilityCondition: z.record(z.string(), z.unknown()).nullish(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
})

export const cpqProductChargeUpdateSchema = cpqProductChargeCreateSchema.partial().extend({
  id: z.string().uuid(),
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

export const cpqPricingTableCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  dimensions: z.array(z.object({ key: z.string(), label: z.string() })),
  priceColumns: z.array(z.object({ key: z.string(), label: z.string() })),
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
