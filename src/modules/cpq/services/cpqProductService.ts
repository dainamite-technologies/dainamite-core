import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqProductSpecification,
  CpqProductOffering,
  CpqProductRelationship,
  CpqProductAttribute,
  CpqProductCharge,
  CpqPricingTable,
  CpqPricingTableEntry,
} from '../data/entities'

export interface ConstrainedAttribute {
  code: string
  name: string
  attributeType: string
  resolutionTime: string
  isRequired: boolean
  options: Array<{ value: string; label: string }> | null
  constraints: Record<string, unknown> | null
  defaultValue: unknown | null
  helpText: string | null
  dependsOn: Record<string, unknown> | null
}

export interface DesignTimeValidationResult {
  valid: boolean
  errors: Array<{ attribute: string; message: string }>
}

export class DefaultCpqProductService {
  private em: EntityManager

  constructor(em: EntityManager) {
    this.em = em
  }

  /**
   * Load a specification with all related entities: attributes, offerings, and relationships.
   */
  async getSpecificationWithDetails(params: {
    specId: string
    organizationId: string
    tenantId: string
  }) {
    const scope = { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null }

    const spec = await this.em.findOne(CpqProductSpecification, { id: params.specId, ...scope })
    if (!spec) return null

    const [attributes, offerings, outgoingRelationships, incomingRelationships] = await Promise.all([
      this.em.find(CpqProductAttribute, { specId: spec.id, ...scope }, { orderBy: { sortOrder: 'asc' } }),
      this.em.find(CpqProductOffering, { specId: spec.id, ...scope }, { orderBy: { createdAt: 'asc' } }),
      this.em.find(CpqProductRelationship, { sourceSpecId: spec.id, ...scope }),
      this.em.find(CpqProductRelationship, { targetSpecId: spec.id, ...scope }),
    ])

    return {
      ...spec,
      attributes,
      offerings,
      relationships: {
        outgoing: outgoingRelationships,
        incoming: incomingRelationships,
      },
    }
  }

  /**
   * Load an offering with its spec and charges.
   */
  async getOfferingWithDetails(params: {
    offeringId: string
    organizationId: string
    tenantId: string
  }) {
    const scope = { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null }

    const offering = await this.em.findOne(CpqProductOffering, { id: params.offeringId, ...scope })
    if (!offering) return null

    const [spec, charges] = await Promise.all([
      this.em.findOne(CpqProductSpecification, { id: offering.specId, ...scope }),
      this.em.find(CpqProductCharge, { offeringId: offering.id, ...scope }, { orderBy: { sortOrder: 'asc' } }),
    ])

    return {
      ...offering,
      specification: spec,
      charges,
    }
  }

  /**
   * Get constrained attributes for a specification, applying dependency rules
   * and merging design-time values from an offering if provided.
   */
  async getConstrainedAttributes(params: {
    specId: string
    organizationId: string
    tenantId: string
    currentConfig: Record<string, unknown>
    offeringId?: string
  }): Promise<ConstrainedAttribute[]> {
    const scope = { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null }

    const attributes = await this.em.find(
      CpqProductAttribute,
      { specId: params.specId, ...scope },
      { orderBy: { sortOrder: 'asc' } },
    )

    // If an offering is specified, merge its design-time values into the evaluation context
    let evaluationContext = { ...params.currentConfig }
    if (params.offeringId) {
      const offering = await this.em.findOne(CpqProductOffering, { id: params.offeringId, ...scope })
      if (offering?.designTimeValues) {
        evaluationContext = { ...offering.designTimeValues, ...evaluationContext }
      }
    }

    const results: ConstrainedAttribute[] = []

    for (const attr of attributes) {
      let resolvedOptions = attr.options ?? null

      // Resolve dynamic options from pricing table if options are null and dynamicOptionsSource is configured
      if (!resolvedOptions && attr.constraints) {
        const dyn = (attr.constraints as Record<string, unknown>).dynamicOptionsSource as {
          type?: string
          tableCode?: string
          dimensionKey?: string
          filterByDimension?: Record<string, string>
        } | undefined

        if (dyn?.type === 'pricing_table' && dyn.tableCode && dyn.dimensionKey) {
          resolvedOptions = await this.resolveDynamicOptions(dyn, evaluationContext, scope)
        }
      }

      // Apply dependency rules if present
      if (attr.dependsOn && resolvedOptions) {
        resolvedOptions = this.applyDependencyRules(attr.dependsOn, resolvedOptions, evaluationContext)
      }

      results.push({
        code: attr.code,
        name: attr.name,
        attributeType: attr.attributeType,
        resolutionTime: attr.resolutionTime,
        isRequired: attr.isRequired,
        options: resolvedOptions,
        constraints: attr.constraints ?? null,
        defaultValue: attr.defaultValue ?? null,
        helpText: attr.helpText ?? null,
        dependsOn: attr.dependsOn ?? null,
      })
    }

    return results
  }

  /**
   * Validate design-time values against a specification's design-time attributes.
   */
  async validateDesignTimeValues(params: {
    specId: string
    organizationId: string
    tenantId: string
    values: Record<string, unknown>
  }): Promise<DesignTimeValidationResult> {
    const scope = { organizationId: params.organizationId, tenantId: params.tenantId, deletedAt: null }

    const designTimeAttrs = await this.em.find(CpqProductAttribute, {
      specId: params.specId,
      resolutionTime: 'design_time',
      ...scope,
    })

    const errors: Array<{ attribute: string; message: string }> = []

    for (const attr of designTimeAttrs) {
      const value = params.values[attr.code]

      // Check required
      if (attr.isRequired && (value === undefined || value === null || value === '')) {
        errors.push({ attribute: attr.code, message: `${attr.name} is required` })
        continue
      }

      if (value === undefined || value === null) continue

      // Validate against options if present
      if (attr.options && attr.options.length > 0) {
        const validValues = attr.options.map((o) => o.value)
        if (typeof value === 'string' && !validValues.includes(value)) {
          errors.push({
            attribute: attr.code,
            message: `${attr.name} must be one of: ${validValues.join(', ')}`,
          })
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Resolve dynamic options from a pricing table by querying unique dimension values.
   */
  private async resolveDynamicOptions(
    source: { tableCode: string; dimensionKey: string; filterByDimension?: Record<string, string> },
    context: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; deletedAt: null },
  ): Promise<Array<{ value: string; label: string }>> {
    const table = await this.em.findOne(CpqPricingTable, { code: source.tableCode, ...scope })
    if (!table) return []

    const entries = await this.em.find(CpqPricingTableEntry, {
      pricingTableId: table.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    // Filter entries by dimension filters (resolve $variable references from context)
    let filtered = entries
    if (source.filterByDimension) {
      for (const [dimKey, dimValue] of Object.entries(source.filterByDimension)) {
        const resolvedValue = dimValue.startsWith('$')
          ? context[dimValue.slice(1)]
          : dimValue
        if (resolvedValue === undefined || resolvedValue === null || resolvedValue === '') continue
        filtered = filtered.filter((e) => {
          const dims = e.dimensionValues as Record<string, unknown>
          return dims?.[dimKey] === resolvedValue
        })
      }
    }

    // Extract unique values for the target dimension key
    const uniqueValues = new Set<string>()
    for (const entry of filtered) {
      const dims = entry.dimensionValues as Record<string, unknown>
      const val = dims?.[source.dimensionKey]
      if (typeof val === 'string' && val) uniqueValues.add(val)
    }

    return Array.from(uniqueValues).sort().map((v) => ({ value: v, label: v }))
  }

  /**
   * Apply dependency rules to filter attribute options based on evaluation context.
   */
  private applyDependencyRules(
    dependsOn: Record<string, unknown>,
    options: Array<{ value: string; label: string }>,
    context: Record<string, unknown>,
  ): Array<{ value: string; label: string }> {
    const dep = dependsOn as {
      attributeCode?: string
      effect?: string
      rules?: Array<{
        when?: { operator?: string; value?: string | string[] }
        then?: { options?: string[]; value?: unknown; state?: boolean }
      }>
    }

    if (!dep.attributeCode || !dep.rules || dep.effect !== 'filter_options') {
      return options
    }

    const parentValue = context[dep.attributeCode]
    if (parentValue === undefined || parentValue === null) return options

    for (const rule of dep.rules) {
      if (!rule.when || !rule.then?.options) continue

      const matched = this.evaluateCondition(rule.when, parentValue)
      if (matched) {
        const allowedValues = new Set(rule.then.options)
        return options.filter((opt) => allowedValues.has(opt.value))
      }
    }

    return options
  }

  private evaluateCondition(
    when: { operator?: string; value?: string | string[] },
    actualValue: unknown,
  ): boolean {
    const { operator, value } = when
    switch (operator) {
      case 'eq':
        return actualValue === value
      case 'neq':
        return actualValue !== value
      case 'in':
        return Array.isArray(value) && value.includes(String(actualValue))
      case 'not_in':
        return Array.isArray(value) && !value.includes(String(actualValue))
      case 'any':
        return true
      default:
        return false
    }
  }
}
