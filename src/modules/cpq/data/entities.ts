import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core'

// ─── CpqProductSpecification ─────────────────────────────────────

@Entity({ tableName: 'cpq_product_specifications' })
@Unique({ name: 'cpq_product_specifications_product_unique', properties: ['organizationId', 'tenantId', 'productId'] })
@Unique({ name: 'cpq_product_specifications_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_product_specifications_lifecycle_idx', properties: ['organizationId', 'tenantId', 'lifecycleStatus'] })
export class CpqProductSpecification {
  [OptionalProps]?: 'specType' | 'isAssetizable' | 'lifecycleStatus' | 'version' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'spec_type', type: 'text', default: 'simple' })
  specType: string = 'simple'

  @Property({ name: 'is_assetizable', type: 'boolean', default: false })
  isAssetizable: boolean = false

  @Property({ name: 'lifecycle_status', type: 'text', default: 'draft' })
  lifecycleStatus: string = 'draft'

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqProductOffering ─────────────────────────────────────────

@Entity({ tableName: 'cpq_product_offerings' })
@Unique({ name: 'cpq_product_offerings_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_product_offerings_spec_idx', properties: ['organizationId', 'tenantId', 'specId'] })
@Index({ name: 'cpq_product_offerings_lifecycle_idx', properties: ['organizationId', 'tenantId', 'lifecycleStatus'] })
export class CpqProductOffering {
  [OptionalProps]?: 'offeringType' | 'designTimeValues' | 'lifecycleStatus' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'spec_id', type: 'uuid' })
  specId!: string

  @Property({ name: 'catalog_offer_id', type: 'uuid', nullable: true })
  catalogOfferId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'offering_type', type: 'text', default: 'simple' })
  offeringType: string = 'simple'

  @Property({ name: 'design_time_values', type: 'jsonb', default: '{}' })
  designTimeValues: Record<string, unknown> = {}

  @Property({ name: 'lifecycle_status', type: 'text', default: 'draft' })
  lifecycleStatus: string = 'draft'

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqProductRelationship ─────────────────────────────────────

@Entity({ tableName: 'cpq_product_relationships' })
@Unique({
  name: 'cpq_product_relationships_unique',
  properties: ['organizationId', 'tenantId', 'sourceSpecId', 'targetSpecId', 'relationshipType'],
})
@Index({ name: 'cpq_product_relationships_source_idx', properties: ['organizationId', 'tenantId', 'sourceSpecId'] })
@Index({ name: 'cpq_product_relationships_target_idx', properties: ['organizationId', 'tenantId', 'targetSpecId'] })
export class CpqProductRelationship {
  [OptionalProps]?: 'cardinalityMin' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'source_spec_id', type: 'uuid' })
  sourceSpecId!: string

  @Property({ name: 'target_spec_id', type: 'uuid' })
  targetSpecId!: string

  @Property({ name: 'relationship_type', type: 'text' })
  relationshipType!: string

  @Property({ name: 'cardinality_min', type: 'integer', default: 0 })
  cardinalityMin: number = 0

  @Property({ name: 'cardinality_max', type: 'integer', nullable: true })
  cardinalityMax?: number | null

  @Property({ type: 'jsonb', nullable: true })
  condition?: Record<string, unknown> | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqBundleSlot ──────────────────────────────────────────────

@Entity({ tableName: 'cpq_bundle_slots' })
@Index({ name: 'cpq_bundle_slot_spec_idx', properties: ['organizationId', 'tenantId', 'specId'] })
@Index({ name: 'cpq_bundle_slot_target_idx', properties: ['organizationId', 'tenantId', 'targetSpecId'] })
@Index({ name: 'cpq_bundle_slot_group_idx', properties: ['organizationId', 'tenantId', 'specId', 'componentGroup'] })
export class CpqBundleSlot {
  [OptionalProps]?: 'cardinalityMin' | 'sortOrder' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'spec_id', type: 'uuid' })
  specId!: string

  @Property({ name: 'target_spec_id', type: 'uuid' })
  targetSpecId!: string

  @Property({ name: 'component_group', type: 'text' })
  componentGroup!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'cardinality_min', type: 'integer', default: 0 })
  cardinalityMin: number = 0

  @Property({ name: 'cardinality_max', type: 'integer', nullable: true })
  cardinalityMax?: number | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqOfferingComponent ───────────────────────────────────────

@Entity({ tableName: 'cpq_offering_components' })
@Index({ name: 'cpq_off_comp_offering_idx', properties: ['organizationId', 'tenantId', 'offeringId'] })
@Index({ name: 'cpq_off_comp_slot_idx', properties: ['organizationId', 'tenantId', 'offeringId', 'slotId'] })
@Index({ name: 'cpq_off_comp_child_idx', properties: ['organizationId', 'tenantId', 'childOfferingId'] })
@Unique({ name: 'cpq_off_comp_unique', properties: ['organizationId', 'tenantId', 'offeringId', 'childOfferingId'] })
export class CpqOfferingComponent {
  [OptionalProps]?: 'isDefault' | 'sortOrder' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'offering_id', type: 'uuid' })
  offeringId!: string

  @Property({ name: 'slot_id', type: 'uuid' })
  slotId!: string

  @Property({ name: 'child_offering_id', type: 'uuid' })
  childOfferingId!: string

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqProductAttribute ─────────────────────────────────────────

@Entity({ tableName: 'cpq_product_attributes' })
@Index({ name: 'cpq_product_attributes_scope_idx', properties: ['organizationId', 'tenantId', 'productId'] })
@Index({ name: 'cpq_product_attributes_spec_idx', properties: ['organizationId', 'tenantId', 'specId'] })
@Index({ name: 'cpq_product_attributes_spec_resolution_idx', properties: ['organizationId', 'tenantId', 'specId', 'resolutionTime'] })
@Unique({
  name: 'cpq_product_attributes_code_unique',
  properties: ['organizationId', 'tenantId', 'productId', 'code'],
})
export class CpqProductAttribute {
  [OptionalProps]?: 'resolutionTime' | 'isRequired' | 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'spec_id', type: 'uuid', nullable: true })
  specId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'attribute_type', type: 'text' })
  attributeType!: string

  @Property({ name: 'resolution_time', type: 'text', default: 'run_time' })
  resolutionTime: string = 'run_time'

  @Property({ type: 'jsonb', nullable: true })
  options?: Array<{ value: string; label: string }> | null

  @Property({ type: 'jsonb', nullable: true })
  constraints?: Record<string, unknown> | null

  @Property({ name: 'reference_entity', type: 'text', nullable: true })
  referenceEntity?: string | null

  @Property({ name: 'reference_filter', type: 'jsonb', nullable: true })
  referenceFilter?: Record<string, unknown> | null

  @Property({ name: 'depends_on', type: 'jsonb', nullable: true })
  dependsOn?: Record<string, unknown> | null

  @Property({ name: 'default_value', type: 'jsonb', nullable: true })
  defaultValue?: unknown | null

  @Property({ name: 'help_text', type: 'text', nullable: true })
  helpText?: string | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean = true

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqPricingTable ─────────────────────────────────────────────

@Entity({ tableName: 'cpq_pricing_tables' })
@Index({ name: 'cpq_pricing_tables_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cpq_pricing_tables_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class CpqPricingTable {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'jsonb' })
  dimensions!: Array<{ key: string; label: string }>

  @Property({ name: 'price_columns', type: 'jsonb' })
  priceColumns!: Array<{ key: string; label: string }>

  @Property({ name: 'currency_code_list', type: 'jsonb' })
  currencyCodeList!: string[]

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqPricingTableEntry ────────────────────────────────────────

@Entity({ tableName: 'cpq_pricing_table_entries' })
@Index({ name: 'cpq_pricing_table_entries_scope_idx', properties: ['organizationId', 'tenantId', 'pricingTableId'] })
@Index({ name: 'cpq_pricing_table_entries_dim_gin_idx', properties: ['dimensionValues'], type: 'GIN' })
export class CpqPricingTableEntry {
  [OptionalProps]?: 'isActive' | 'currencyCode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'pricing_table_id', type: 'uuid' })
  pricingTableId!: string

  @Property({ name: 'dimension_values', type: 'jsonb' })
  dimensionValues!: Record<string, string>

  @Property({ name: 'tier_number', type: 'integer', nullable: true })
  tierNumber?: number | null

  @Property({ name: 'range_from', type: 'numeric', nullable: true })
  rangeFrom?: string | null

  @Property({ name: 'range_to', type: 'numeric', nullable: true })
  rangeTo?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ type: 'jsonb' })
  prices!: Record<string, number>

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqProductCharge ────────────────────────────────────────────

@Entity({ tableName: 'cpq_product_charges' })
@Index({ name: 'cpq_product_charges_scope_idx', properties: ['organizationId', 'tenantId', 'productId'] })
@Index({ name: 'cpq_product_charges_offering_idx', properties: ['organizationId', 'tenantId', 'offeringId'] })
@Unique({
  name: 'cpq_product_charges_offering_code_unique',
  properties: ['organizationId', 'tenantId', 'offeringId', 'code'],
})
export class CpqProductCharge {
  [OptionalProps]?: 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'offering_id', type: 'uuid', nullable: true })
  offeringId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'charge_type', type: 'text' })
  chargeType!: string

  @Property({ name: 'pricing_method', type: 'text' })
  pricingMethod!: string

  @Property({ name: 'pricing_table_id', type: 'uuid', nullable: true })
  pricingTableId?: string | null

  @Property({ name: 'price_column_key', type: 'text', nullable: true })
  priceColumnKey?: string | null

  @Property({ name: 'fixed_price', type: 'numeric', nullable: true })
  fixedPrice?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'quantity_attribute_code', type: 'text', nullable: true })
  quantityAttributeCode?: string | null

  @Property({ name: 'applicability_condition', type: 'jsonb', nullable: true })
  applicabilityCondition?: Record<string, unknown> | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqPriceRule ─────────────────────────────────────────────────

@Entity({ tableName: 'cpq_price_rules' })
@Index({ name: 'cpq_price_rules_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cpq_price_rules_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_price_rules_product_idx', properties: ['organizationId', 'tenantId', 'productOfferingId'] })
export class CpqPriceRule {
  [OptionalProps]?: 'sortOrder' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'product_offering_id', type: 'uuid', nullable: true })
  productOfferingId?: string | null

  @Property({ name: 'rule_type', type: 'text' })
  ruleType!: string

  @Property({ type: 'numeric' })
  value!: string

  @Property({ name: 'charge_code_filter', type: 'text', nullable: true })
  chargeCodeFilter?: string | null

  @Property({ name: 'charge_type_filter', type: 'text', nullable: true })
  chargeTypeFilter?: string | null

  @Property({ name: 'applicability_condition', type: 'jsonb', nullable: true })
  applicabilityCondition?: Record<string, unknown> | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqQuoteConfiguration ───────────────────────────────────────

@Entity({ tableName: 'cpq_quote_configurations' })
@Unique({ name: 'cpq_quote_configurations_quote_unique', properties: ['organizationId', 'tenantId', 'quoteId'] })
export class CpqQuoteConfiguration {
  [OptionalProps]?: 'cpqStatus' | 'version' | 'currencyCode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'quote_id', type: 'uuid' })
  quoteId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'cpq_status', type: 'text', default: 'new' })
  cpqStatus: string = 'new'

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'parent_quote_id', type: 'uuid', nullable: true })
  parentQuoteId?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'quote_context', type: 'jsonb', nullable: true })
  quoteContext?: Record<string, string | number | boolean> | null

  @Property({ name: 'validation_result', type: 'jsonb', nullable: true })
  validationResult?: Record<string, unknown> | null

  @Property({ name: 'pricing_summary', type: 'jsonb', nullable: true })
  pricingSummary?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqWizardDefinition ───────────────────────────────────────

@Entity({ tableName: 'cpq_wizard_definitions' })
@Unique({ name: 'cpq_wizard_definitions_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_wizard_definitions_active_idx', properties: ['organizationId', 'tenantId', 'isActive'] })
@Index({ name: 'cpq_wizard_definitions_surface_idx', properties: ['organizationId', 'tenantId', 'surface'] })
export class CpqWizardDefinition {
  [OptionalProps]?: 'version' | 'surface' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'integer', default: 1 })
  version: number = 1

  @Property({ type: 'jsonb', default: '[]' })
  steps!: Array<Record<string, unknown>>

  @Property({ type: 'jsonb', nullable: true })
  applicability?: Record<string, unknown> | null

  @Property({ name: 'params_schema', type: 'jsonb', nullable: true })
  paramsSchema?: Record<string, unknown> | null

  @Property({ type: 'text', default: 'backend' })
  surface: string = 'backend'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqQuoteLineConfiguration ──────────────────────────────────

@Entity({ tableName: 'cpq_quote_line_configurations' })
@Unique({ name: 'cpq_qlc_quote_line_unique', properties: ['organizationId', 'tenantId', 'quoteLineId'] })
@Index({ name: 'cpq_qlc_quote_config_idx', properties: ['organizationId', 'tenantId', 'quoteConfigurationId'] })
@Index({ name: 'cpq_qlc_parent_line_idx', properties: ['organizationId', 'tenantId', 'parentLineId'] })
export class CpqQuoteLineConfiguration {
  [OptionalProps]?: 'action' | 'configuration' | 'quantity' | 'nrcTotal' | 'mrcTotal' | 'isConfigured' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'quote_line_id', type: 'uuid' })
  quoteLineId!: string

  @Property({ name: 'quote_configuration_id', type: 'uuid' })
  quoteConfigurationId!: string

  @Property({ name: 'offering_id', type: 'uuid', nullable: true })
  offeringId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'spec_id', type: 'uuid', nullable: true })
  specId?: string | null

  @Property({ type: 'text', default: 'add' })
  action: string = 'add'

  @Property({ name: 'parent_line_id', type: 'uuid', nullable: true })
  parentLineId?: string | null

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'term_months', type: 'integer', nullable: true })
  termMonths?: number | null

  @Property({ name: 'end_date', type: 'date', nullable: true })
  endDate?: Date | null

  @Property({ type: 'jsonb', default: '{}' })
  configuration: Record<string, unknown> = {}

  @Property({ type: 'integer', default: 1 })
  quantity: number = 1

  @Property({ type: 'jsonb', nullable: true })
  charges?: Array<Record<string, unknown>> | null

  @Property({ name: 'nrc_total', columnType: 'numeric(18, 4)', default: 0 })
  nrcTotal: string = '0'

  @Property({ name: 'mrc_total', columnType: 'numeric(18, 4)', default: 0 })
  mrcTotal: string = '0'

  @Property({ name: 'usage_estimates', type: 'jsonb', nullable: true })
  usageEstimates?: Array<{ chargeCode: string; estimatedQuantity: number; estimatedTotal: number }> | null

  @Property({ name: 'usage_total_estimated', type: 'numeric', columnType: 'numeric(18, 4)', nullable: true })
  usageTotalEstimated?: string | null

  @Property({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors?: Array<Record<string, unknown>> | null

  @Property({ name: 'is_configured', type: 'boolean', default: false })
  isConfigured: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqInventorySubscription ───────────────────────────────────

@Entity({ tableName: 'cpq_inventory_subscriptions' })
@Index({ name: 'cpq_inventory_subscriptions_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cpq_inventory_subscriptions_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_inventory_subscriptions_customer_idx', properties: ['organizationId', 'tenantId', 'customerId'] })
@Index({ name: 'cpq_inventory_subscriptions_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'cpq_inventory_subscriptions_source_quote_idx', properties: ['organizationId', 'tenantId', 'sourceQuoteId'] })
export class CpqInventorySubscription {
  [OptionalProps]?: 'status' | 'billingCycle' | 'currencyCode' | 'mrcAmount' | 'nrcAmount' | 'autoRenew' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ name: 'billing_cycle', type: 'text', default: 'monthly' })
  billingCycle: string = 'monthly'

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'mrc_amount', columnType: 'numeric(18, 4)', default: 0 })
  mrcAmount: string = '0'

  @Property({ name: 'nrc_amount', columnType: 'numeric(18, 4)', default: 0 })
  nrcAmount: string = '0'

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'current_term_end', type: 'date', nullable: true })
  currentTermEnd?: Date | null

  @Property({ name: 'term_months', type: 'integer', nullable: true })
  termMonths?: number | null

  @Property({ name: 'auto_renew', type: 'boolean', default: true })
  autoRenew: boolean = true

  @Property({ name: 'activated_at', type: Date, nullable: true })
  activatedAt?: Date | null

  @Property({ name: 'suspended_at', type: Date, nullable: true })
  suspendedAt?: Date | null

  @Property({ name: 'terminated_at', type: Date, nullable: true })
  terminatedAt?: Date | null

  @Property({ name: 'pricing_summary', type: 'jsonb', nullable: true })
  pricingSummary?: Record<string, unknown> | null

  @Property({ name: 'source_quote_id', type: 'uuid', nullable: true })
  sourceQuoteId?: string | null

  @Property({ name: 'source_order_id', type: 'uuid', nullable: true })
  sourceOrderId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqInventorySubscriptionItem ───────────────────────────────

@Entity({ tableName: 'cpq_inventory_subscription_items' })
@Index({ name: 'cpq_inventory_subscription_items_scope_idx', properties: ['organizationId', 'tenantId', 'subscriptionId'] })
@Index({ name: 'cpq_inventory_subscription_items_customer_idx', properties: ['organizationId', 'tenantId', 'customerId'] })
@Index({ name: 'cpq_inventory_subscription_items_parent_idx', properties: ['organizationId', 'tenantId', 'parentItemId'] })
@Index({ name: 'cpq_inventory_subscription_items_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class CpqInventorySubscriptionItem {
  [OptionalProps]?: 'status' | 'configuration' | 'mrcAmount' | 'nrcAmount' | 'currencyCode' | 'quantity' | 'sortOrder' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'parent_item_id', type: 'uuid', nullable: true })
  parentItemId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'offering_id', type: 'uuid', nullable: true })
  offeringId?: string | null

  @Property({ name: 'spec_id', type: 'uuid', nullable: true })
  specId?: string | null

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ type: 'jsonb', default: '{}' })
  configuration: Record<string, unknown> = {}

  @Property({ type: 'jsonb', nullable: true })
  charges?: Array<Record<string, unknown>> | null

  @Property({ name: 'mrc_amount', columnType: 'numeric(18, 4)', default: 0 })
  mrcAmount: string = '0'

  @Property({ name: 'nrc_amount', columnType: 'numeric(18, 4)', default: 0 })
  nrcAmount: string = '0'

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ type: 'integer', default: 1 })
  quantity: number = 1

  @Property({ name: 'capacity_total', type: 'numeric', columnType: 'numeric(18, 4)', nullable: true })
  capacityTotal?: string | null

  @Property({ name: 'capacity_used', type: 'numeric', columnType: 'numeric(18, 4)', nullable: true })
  capacityUsed?: string | null

  @Property({ name: 'capacity_unit', type: 'text', nullable: true })
  capacityUnit?: string | null

  @Property({ name: 'source_quote_line_id', type: 'uuid', nullable: true })
  sourceQuoteLineId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqInventoryAsset ──────────────────────────────────────────

@Entity({ tableName: 'cpq_inventory_assets' })
@Index({ name: 'cpq_inventory_assets_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'cpq_inventory_assets_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
@Index({ name: 'cpq_inventory_assets_customer_idx', properties: ['organizationId', 'tenantId', 'customerId'] })
@Index({ name: 'cpq_inventory_assets_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'cpq_inventory_assets_subscription_idx', properties: ['organizationId', 'tenantId', 'subscriptionId'] })
@Index({ name: 'cpq_inventory_assets_item_idx', properties: ['organizationId', 'tenantId', 'subscriptionItemId'] })
export class CpqInventoryAsset {
  [OptionalProps]?: 'status' | 'assetType' | 'currencyCode' | 'purchasePrice' | 'quantity' | 'configuration' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId?: string | null

  @Property({ name: 'subscription_item_id', type: 'uuid', nullable: true })
  subscriptionItemId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'offering_id', type: 'uuid', nullable: true })
  offeringId?: string | null

  @Property({ name: 'spec_id', type: 'uuid', nullable: true })
  specId?: string | null

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ name: 'asset_type', type: 'text', default: 'one_time' })
  assetType: string = 'one_time'

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'purchase_price', columnType: 'numeric(18, 4)', default: 0 })
  purchasePrice: string = '0'

  @Property({ type: 'integer', default: 1 })
  quantity: number = 1

  @Property({ name: 'purchase_date', type: 'date', nullable: true })
  purchaseDate?: Date | null

  @Property({ name: 'delivery_date', type: 'date', nullable: true })
  deliveryDate?: Date | null

  @Property({ type: 'jsonb', default: '{}' })
  configuration: Record<string, unknown> = {}

  @Property({ type: 'jsonb', nullable: true })
  charges?: Array<Record<string, unknown>> | null

  @Property({ name: 'source_quote_id', type: 'uuid', nullable: true })
  sourceQuoteId?: string | null

  @Property({ name: 'source_order_id', type: 'uuid', nullable: true })
  sourceOrderId?: string | null

  @Property({ name: 'source_quote_line_id', type: 'uuid', nullable: true })
  sourceQuoteLineId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqOrderConfiguration ──────────────────────────────────────

@Entity({ tableName: 'cpq_order_configurations' })
@Unique({ name: 'cpq_order_configurations_order_unique', properties: ['organizationId', 'tenantId', 'orderId'] })
@Index({ name: 'cpq_order_configurations_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'cpq_order_configurations_customer_idx', properties: ['organizationId', 'tenantId', 'customerId'] })
@Index({ name: 'cpq_order_configurations_source_quote_idx', properties: ['organizationId', 'tenantId', 'sourceQuoteId'] })
@Index({ name: 'cpq_order_configurations_status_idx', properties: ['organizationId', 'tenantId', 'cpqStatus'] })
export class CpqOrderConfiguration {
  [OptionalProps]?: 'cpqStatus' | 'currencyCode' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  @Property({ name: 'source_quote_id', type: 'uuid', nullable: true })
  sourceQuoteId?: string | null

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'cpq_status', type: 'text', default: 'draft' })
  cpqStatus: string = 'draft'

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'pricing_summary', type: 'jsonb', nullable: true })
  pricingSummary?: Record<string, unknown> | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'activated_at', type: Date, nullable: true })
  activatedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ─── CpqOrderLineConfiguration ──────────────────────────────────

@Entity({ tableName: 'cpq_order_line_configurations' })
@Unique({ name: 'cpq_olc_order_line_unique', properties: ['organizationId', 'tenantId', 'orderLineId'] })
@Index({ name: 'cpq_olc_order_config_idx', properties: ['organizationId', 'tenantId', 'orderConfigurationId'] })
@Index({ name: 'cpq_olc_parent_line_idx', properties: ['organizationId', 'tenantId', 'parentLineId'] })
export class CpqOrderLineConfiguration {
  [OptionalProps]?: 'action' | 'configuration' | 'quantity' | 'nrcTotal' | 'mrcTotal' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'order_line_id', type: 'uuid' })
  orderLineId!: string

  @Property({ name: 'order_configuration_id', type: 'uuid' })
  orderConfigurationId!: string

  @Property({ name: 'offering_id', type: 'uuid', nullable: true })
  offeringId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'spec_id', type: 'uuid', nullable: true })
  specId?: string | null

  @Property({ type: 'text', default: 'add' })
  action: string = 'add'

  @Property({ name: 'parent_line_id', type: 'uuid', nullable: true })
  parentLineId?: string | null

  @Property({ name: 'start_date', type: 'date', nullable: true })
  startDate?: Date | null

  @Property({ name: 'term_months', type: 'integer', nullable: true })
  termMonths?: number | null

  @Property({ name: 'end_date', type: 'date', nullable: true })
  endDate?: Date | null

  @Property({ type: 'jsonb', default: '{}' })
  configuration: Record<string, unknown> = {}

  @Property({ type: 'integer', default: 1 })
  quantity: number = 1

  @Property({ type: 'jsonb', nullable: true })
  charges?: Array<Record<string, unknown>> | null

  @Property({ name: 'nrc_total', columnType: 'numeric(18, 4)', default: 0 })
  nrcTotal: string = '0'

  @Property({ name: 'mrc_total', columnType: 'numeric(18, 4)', default: 0 })
  mrcTotal: string = '0'

  @Property({ name: 'source_quote_line_id', type: 'uuid', nullable: true })
  sourceQuoteLineId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
