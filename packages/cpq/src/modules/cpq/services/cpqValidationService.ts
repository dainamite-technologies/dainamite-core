import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqProductAttribute,
  CpqProductOffering,
  CpqProductSpecification,
  CpqProductRelationship,
  CpqPricingTable,
  CpqPricingTableEntry,
} from '../data/entities'
import type { ValidationError, TenantScope } from './types'

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface AttributeOption {
  value: string
  label: string
}

export class DefaultCpqValidationService {
  private em: EntityManager

  constructor(em: EntityManager) {
    this.em = em
  }

  /**
   * Validate a configuration against an offering's specification attributes (v2).
   * Loads the spec via offering -> spec relationship, then validates run-time attributes.
   */
  async validateOfferingConfiguration(params: {
    offeringId: string
    configuration: Record<string, unknown>
    scope: TenantScope
  }): Promise<ValidationResult> {
    const { offeringId, configuration, scope } = params
    const dbScope = { ...scope, deletedAt: null }

    const offering = await this.em.findOne(CpqProductOffering, { id: offeringId, ...dbScope })
    if (!offering) {
      return { valid: false, errors: [{ type: 'attribute', message: `Offering ${offeringId} not found` }] }
    }

    // Merge design-time values into evaluation context
    const evalContext = { ...(offering.designTimeValues ?? {}), ...configuration }

    // Load run-time attributes from spec
    const attributes = await this.em.find(
      CpqProductAttribute,
      { specId: offering.specId, resolutionTime: 'run_time', isActive: true, ...dbScope },
      { orderBy: { sortOrder: 'asc' } },
    )

    return this.validateAttributes(attributes, evalContext)
  }

  /**
   * Validate a configuration against a product's attributes (v1 compat).
   */
  async validateProductConfiguration(params: {
    productId: string
    configuration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<ValidationResult> {
    const { productId, configuration, tenantId, organizationId } = params

    const attributes = await this.em.find(CpqProductAttribute, {
      productId,
      tenantId,
      organizationId,
      isActive: true,
      deletedAt: null,
    })

    return this.validateAttributes(attributes, configuration)
  }

  /**
   * Validate relationships between offerings on a quote.
   * Checks requires, excludes, and parent_child constraints.
   */
  async validateRelationships(params: {
    lines: Array<{
      lineId: string
      specId: string | null
      parentLineId: string | null
    }>
    scope: TenantScope
  }): Promise<ValidationError[]> {
    const { lines, scope } = params
    const errors: ValidationError[] = []
    const dbScope = { ...scope, deletedAt: null, isActive: true }

    // Collect all specIds present in the quote
    const specIds = lines.map((l) => l.specId).filter((s): s is string => !!s)
    const specIdSet = new Set(specIds)

    if (specIds.length === 0) return errors

    // Load all outgoing relationships for specs in the quote
    const relationships = await this.em.find(CpqProductRelationship, {
      sourceSpecId: { $in: specIds },
      ...dbScope,
    })

    // Load spec code/name for error messages
    const specs = await this.em.find(CpqProductSpecification, {
      id: { $in: specIds },
      ...scope,
      deletedAt: null,
    })
    const specMap = new Map(specs.map((s) => [s.id, s]))

    for (const line of lines) {
      if (!line.specId) continue

      const lineRelationships = relationships.filter((r) => r.sourceSpecId === line.specId)

      for (const rel of lineRelationships) {
        const sourceSpec = specMap.get(rel.sourceSpecId)
        const targetSpec = specMap.get(rel.targetSpecId)
        const sourceCode = sourceSpec?.code ?? rel.sourceSpecId
        const targetCode = targetSpec?.code ?? rel.targetSpecId

        if (rel.relationshipType === 'requires') {
          if (!specIdSet.has(rel.targetSpecId)) {
            errors.push({
              type: 'relationship',
              relationshipType: 'requires',
              sourceSpec: sourceCode,
              targetSpec: targetCode,
              message: `${sourceCode} requires ${targetCode} to be present on the quote`,
            })
          }
        }

        if (rel.relationshipType === 'excludes') {
          if (specIdSet.has(rel.targetSpecId)) {
            errors.push({
              type: 'relationship',
              relationshipType: 'excludes',
              sourceSpec: sourceCode,
              targetSpec: targetCode,
              message: `${sourceCode} cannot co-exist with ${targetCode} on the same quote`,
            })
          }
        }

        if (rel.relationshipType === 'parent_child') {
          // Count children of this type under this parent
          const childrenOfType = lines.filter(
            (l) => l.specId === rel.targetSpecId && l.parentLineId === line.lineId,
          )
          const count = childrenOfType.length

          if (rel.cardinalityMin > 0 && count < rel.cardinalityMin) {
            errors.push({
              type: 'relationship',
              relationshipType: 'parent_child',
              sourceSpec: sourceCode,
              targetSpec: targetCode,
              message: `${sourceCode} requires at least ${rel.cardinalityMin} child item(s) of type ${targetCode}`,
            })
          }

          if (rel.cardinalityMax != null && count > rel.cardinalityMax) {
            errors.push({
              type: 'relationship',
              relationshipType: 'parent_child',
              sourceSpec: sourceCode,
              targetSpec: targetCode,
              message: `${sourceCode} allows at most ${rel.cardinalityMax} child item(s) of type ${targetCode}`,
            })
          }
        }
      }
    }

    return errors
  }

  /**
   * Get dynamic attribute options. Supports reference-type attributes
   * and dynamic option sources from pricing tables.
   */
  async getAttributeOptions(params: {
    productId?: string
    specId?: string
    attributeCode: string
    currentConfiguration: Record<string, unknown>
    tenantId: string
    organizationId: string
  }): Promise<AttributeOption[]> {
    const { attributeCode, currentConfiguration, tenantId, organizationId } = params

    const filter: Record<string, unknown> = {
      code: attributeCode,
      tenantId,
      organizationId,
      isActive: true,
      deletedAt: null,
    }
    if (params.specId) filter.specId = params.specId
    else if (params.productId) filter.productId = params.productId

    const attribute = await this.em.findOne(CpqProductAttribute, filter)
    if (!attribute) return []

    const constraints = (attribute.constraints ?? {}) as Record<string, unknown>
    if (constraints.dynamicOptionsSource) {
      const source = constraints.dynamicOptionsSource as {
        type?: string
        tableCode: string
        dimensionKey: string
        filterByDimension?: Record<string, string>
      }
      const table = await this.em.findOne(CpqPricingTable, {
        code: source.tableCode,
        tenantId,
        organizationId,
      })
      if (table) {
        const entries = await this.em.find(CpqPricingTableEntry, {
          pricingTableId: table.id,
          tenantId,
          organizationId,
          isActive: true,
        })
        let filtered = entries
        if (source.filterByDimension) {
          for (const [dimKey, configRef] of Object.entries(source.filterByDimension)) {
            const configKey = configRef.startsWith('$') ? configRef.slice(1) : configRef
            const filterValue = String(currentConfiguration[configKey] ?? '')
            if (filterValue) {
              filtered = filtered.filter(
                (e) => String(e.dimensionValues[dimKey] ?? '').toLowerCase() === filterValue.toLowerCase(),
              )
            }
          }
        }
        const unique = new Set<string>()
        for (const entry of filtered) {
          const val = entry.dimensionValues[source.dimensionKey]
          if (val) unique.add(val)
        }
        return Array.from(unique)
          .sort()
          .map((v) => ({ value: v, label: v }))
      }
    }

    return attribute.options ?? []
  }

  // ─── Private helpers ────────────────────────────────────────────

  private validateAttributes(
    attributes: CpqProductAttribute[],
    configuration: Record<string, unknown>,
  ): ValidationResult {
    const errors: ValidationError[] = []

    for (const attr of attributes) {
      const value = configuration[attr.code]

      // Check dependency visibility — if attribute depends on another and the dependency
      // isn't met, skip validation (attribute is hidden)
      if (attr.dependsOn) {
        const dep = attr.dependsOn as { attributeCode?: string; rules?: Array<{ when?: { operator?: string; value?: unknown } }> }
        if (dep.attributeCode) {
          const parentValue = configuration[dep.attributeCode]
          if (parentValue === undefined || parentValue === null) continue
        }
      }

      if (attr.isRequired && (value === undefined || value === null || value === '')) {
        errors.push({ type: 'attribute', attribute: attr.code, message: `${attr.name} is required.` })
        continue
      }

      if (value === undefined || value === null || value === '') continue

      if (attr.attributeType === 'number') {
        const numValue = Number(value)
        if (isNaN(numValue)) {
          errors.push({ type: 'attribute', attribute: attr.code, message: `${attr.name} must be a number.` })
          continue
        }
        const constraints = (attr.constraints ?? {}) as Record<string, unknown>
        if (constraints.min !== undefined && numValue < Number(constraints.min)) {
          errors.push({ type: 'attribute', attribute: attr.code, message: `${attr.name} must be at least ${constraints.min}.` })
        }
        if (constraints.max !== undefined && numValue > Number(constraints.max)) {
          errors.push({ type: 'attribute', attribute: attr.code, message: `${attr.name} must be at most ${constraints.max}.` })
        }
        if (constraints.step !== undefined) {
          const step = Number(constraints.step)
          const min = Number(constraints.min ?? 0)
          if (step > 0 && (numValue - min) % step !== 0) {
            errors.push({ type: 'attribute', attribute: attr.code, message: `${attr.name} must be in increments of ${step}.` })
          }
        }
      }

      // Validate select/enum against allowed options
      if ((attr.attributeType === 'select' || attr.attributeType === 'enum') && attr.options && attr.options.length > 0) {
        const validValues = attr.options.map((o) => o.value)
        if (typeof value === 'string' && !validValues.includes(value)) {
          errors.push({
            type: 'attribute',
            attribute: attr.code,
            message: `${attr.name} must be one of: ${validValues.join(', ')}`,
          })
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }
}
