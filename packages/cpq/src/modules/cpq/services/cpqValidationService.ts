import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqBundleSlot,
  CpqOfferingComponent,
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
   * Quote-time bundle rules (XD-223 V-QBUN-1..4, #124). For every bundle line
   * on the quote, its child lines are matched to the bundle's live components
   * and counted per slot group:
   *
   * - V-QBUN-1 (on the bundle line) — a slot group has fewer than `cardinalityMin`
   * - V-QBUN-2 (on the bundle line) — a slot group has more than `cardinalityMax`
   * - V-QBUN-3 (on the child line)  — the child is not a component of the bundle
   *   and no `parent_child` relationship from the bundle's spec allows it
   * - V-QBUN-4 — nested bundles are bundle lines too, so they are checked the same way
   *
   * Child lines marked for removal by ARC are not counted. A bundle mirrored
   * from a live subscription is grandfathered: V-QBUN-1/2 only apply when this
   * quote changes its children (a child is added or cancelled), so renewing a
   * subscription sold before default expansion existed is not blocked.
   *
   * Child → slot mapping uses the component row (V-COMP-5 makes the child
   * offering unique per bundle), so quote lines need no slot column.
   */
  async validateBundleSlots(params: {
    lines: Array<{
      lineId: string
      offeringId: string | null
      specId: string | null
      parentLineId: string | null
      action: string
      isArcCancelled: boolean
      isArcMirrored: boolean
    }>
    scope: TenantScope
  }): Promise<ValidationError[]> {
    const { lines, scope } = params
    const offeringIds = [...new Set(lines.map((l) => l.offeringId).filter((id): id is string => !!id))]
    if (offeringIds.length === 0) return []

    const bundles = await this.em.find(CpqProductOffering, {
      id: { $in: offeringIds },
      offeringType: 'bundle',
      ...scope,
      deletedAt: null,
    })
    if (bundles.length === 0) return []
    const bundleById = new Map(bundles.map((b) => [b.id, b]))
    const bundleSpecIds = [...new Set(bundles.map((b) => b.specId))]

    const [slots, components, relationships] = await Promise.all([
      this.em.find(CpqBundleSlot, { specId: { $in: bundleSpecIds }, ...scope, deletedAt: null, isActive: true }),
      this.em.find(CpqOfferingComponent, { offeringId: { $in: bundles.map((b) => b.id) }, ...scope, deletedAt: null, isActive: true }),
      this.em.find(CpqProductRelationship, {
        sourceSpecId: { $in: bundleSpecIds },
        relationshipType: 'parent_child',
        ...scope,
        deletedAt: null,
        isActive: true,
      }),
    ])

    const errors: ValidationError[] = []
    for (const bundleLine of lines) {
      const bundle = bundleLine.offeringId ? bundleById.get(bundleLine.offeringId) : undefined
      if (!bundle || bundleLine.isArcCancelled) continue

      const bundleSlots = slots.filter((slot) => slot.specId === bundle.specId)
      const slotById = new Map(bundleSlots.map((slot) => [slot.id, slot]))
      const slotIdByChildOffering = new Map(
        components
          .filter((c) => c.offeringId === bundle.id && slotById.has(c.slotId))
          .map((c) => [c.childOfferingId, c.slotId]),
      )
      const addOnSpecIds = new Set(
        relationships.filter((r) => r.sourceSpecId === bundle.specId).map((r) => r.targetSpecId),
      )

      const allChildren = lines.filter((l) => l.parentLineId === bundleLine.lineId)
      const countByGroup = new Map<string, number>()
      for (const child of allChildren) {
        if (child.isArcCancelled) continue
        const slotId = child.offeringId ? slotIdByChildOffering.get(child.offeringId) : undefined
        const slot = slotId ? slotById.get(slotId) : undefined
        if (slot) {
          countByGroup.set(slot.componentGroup, (countByGroup.get(slot.componentGroup) ?? 0) + 1)
          continue
        }
        if (child.specId && addOnSpecIds.has(child.specId)) continue
        errors.push({
          lineId: child.lineId,
          type: 'bundle_slot',
          message: `V-QBUN-3: This item is not a component of bundle ${bundle.name}`,
        })
      }

      const grandfathered = bundleLine.isArcMirrored && allChildren.every((child) => child.action === 'modify')
      if (grandfathered) continue

      const groups = new Map<string, { min: number; max: number | null; names: string[] }>()
      for (const slot of bundleSlots) {
        const group = groups.get(slot.componentGroup)
        if (group) group.names.push(slot.name)
        else groups.set(slot.componentGroup, { min: slot.cardinalityMin, max: slot.cardinalityMax ?? null, names: [slot.name] })
      }
      for (const [componentGroup, group] of groups) {
        const count = countByGroup.get(componentGroup) ?? 0
        const slotName = group.names.join(' / ')
        if (group.min > 0 && count < group.min) {
          errors.push({
            lineId: bundleLine.lineId,
            type: 'bundle_slot',
            slotGroup: componentGroup,
            slotName,
            message: `V-QBUN-1: ${slotName} requires at least ${group.min} component(s) (${count} selected)`,
          })
        }
        if (group.max != null && count > group.max) {
          errors.push({
            lineId: bundleLine.lineId,
            type: 'bundle_slot',
            slotGroup: componentGroup,
            slotName,
            message: `V-QBUN-2: ${slotName} allows at most ${group.max} component(s) (${count} selected)`,
          })
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
