import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CpqBundleSlot,
  CpqOfferingComponent,
  CpqProductSpecification,
  CpqProductOffering,
  CpqProductCharge,
} from '../data/entities'

type TenantScope = { organizationId: string; tenantId: string }

export interface BundleSlotResult {
  id: string
  specId: string
  targetSpecId: string
  targetSpec: { id: string; code: string; name: string; specType: string } | null
  componentGroup: string
  name: string
  description: string | null
  cardinalityMin: number
  cardinalityMax: number | null
  sortOrder: number
  isActive: boolean
}

export interface OfferingComponentResult {
  id: string
  offeringId: string
  slotId: string
  slot: {
    id: string
    componentGroup: string
    name: string
    cardinalityMin: number
    cardinalityMax: number | null
  } | null
  childOfferingId: string
  childOffering: {
    id: string
    code: string
    name: string
    offeringType: string
    specId: string
  } | null
  isDefault: boolean
  sortOrder: number
  isActive: boolean
}

export interface BundleTreeNode {
  offeringId: string
  offeringCode: string
  offeringName: string
  offeringType: string
  specId: string
  specType: string
  isAssetizable: boolean
  charges: Array<Record<string, unknown>>
  slots: Array<{
    slotId: string
    componentGroup: string
    name: string
    cardinalityMin: number
    cardinalityMax: number | null
    components: Array<{
      componentId: string
      childOffering: BundleTreeNode
      isDefault: boolean
      sortOrder: number
    }>
  }>
}

export class DefaultCpqBundleService {
  constructor(private em: EntityManager) {}

  // ─── Bundle Slots ─────────────────────────────────────────────

  async getSlots(specId: string, scope: TenantScope): Promise<BundleSlotResult[]> {
    const slots = await this.em.find(
      CpqBundleSlot,
      { specId, ...scope, deletedAt: null },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
    )

    const targetSpecIds = [...new Set(slots.map((s) => s.targetSpecId))]
    const targetSpecs = targetSpecIds.length
      ? await this.em.find(CpqProductSpecification, {
          id: { $in: targetSpecIds },
          ...scope,
          deletedAt: null,
        })
      : []
    const specMap = new Map(targetSpecs.map((s) => [s.id, s]))

    return slots.map((s) => {
      const ts = specMap.get(s.targetSpecId)
      return {
        id: s.id,
        specId: s.specId,
        targetSpecId: s.targetSpecId,
        targetSpec: ts
          ? { id: ts.id, code: ts.code, name: ts.name, specType: ts.specType }
          : null,
        componentGroup: s.componentGroup,
        name: s.name,
        description: s.description ?? null,
        cardinalityMin: s.cardinalityMin,
        cardinalityMax: s.cardinalityMax ?? null,
        sortOrder: s.sortOrder,
        isActive: s.isActive,
      }
    })
  }

  async getSlot(slotId: string, scope: TenantScope): Promise<BundleSlotResult | null> {
    const slot = await this.em.findOne(CpqBundleSlot, { id: slotId, ...scope, deletedAt: null })
    if (!slot) return null

    const targetSpec = await this.em.findOne(CpqProductSpecification, {
      id: slot.targetSpecId,
      ...scope,
      deletedAt: null,
    })

    return {
      id: slot.id,
      specId: slot.specId,
      targetSpecId: slot.targetSpecId,
      targetSpec: targetSpec
        ? { id: targetSpec.id, code: targetSpec.code, name: targetSpec.name, specType: targetSpec.specType }
        : null,
      componentGroup: slot.componentGroup,
      name: slot.name,
      description: slot.description ?? null,
      cardinalityMin: slot.cardinalityMin,
      cardinalityMax: slot.cardinalityMax ?? null,
      sortOrder: slot.sortOrder,
      isActive: slot.isActive,
    }
  }

  async createSlot(
    input: {
      specId: string
      targetSpecId: string
      componentGroup: string
      name: string
      description?: string | null
      cardinalityMin?: number
      cardinalityMax?: number | null
      sortOrder?: number
      metadata?: Record<string, unknown> | null
    },
    scope: TenantScope,
  ): Promise<BundleSlotResult> {
    // V-SLOT-1: spec must be bundle type
    const spec = await this.em.findOne(CpqProductSpecification, {
      id: input.specId,
      ...scope,
      deletedAt: null,
    })
    if (!spec) throw new Error('Specification not found')
    if (spec.specType !== 'bundle') throw new Error('V-SLOT-1: Specification must be bundle type')

    // V-SLOT-2: target spec must exist
    const targetSpec = await this.em.findOne(CpqProductSpecification, {
      id: input.targetSpecId,
      ...scope,
      deletedAt: null,
    })
    if (!targetSpec) throw new Error('V-SLOT-2: Target specification not found')

    // V-SLOT-6: no self-referencing
    if (input.specId === input.targetSpecId) {
      throw new Error('V-SLOT-6: Target specification cannot be the same as the bundle specification')
    }

    // V-SLOT-4 & V-SLOT-5: cardinality
    const cardMin = input.cardinalityMin ?? 0
    if (cardMin < 0) throw new Error('V-SLOT-4: cardinalityMin must be >= 0')
    if (input.cardinalityMax != null && input.cardinalityMax < cardMin) {
      throw new Error('V-SLOT-5: cardinalityMax must be >= cardinalityMin')
    }

    // V-SLOT-3: consistent cardinality within group
    const existingGroupSlots = await this.em.find(CpqBundleSlot, {
      specId: input.specId,
      componentGroup: input.componentGroup,
      ...scope,
      deletedAt: null,
    })
    if (existingGroupSlots.length > 0) {
      const first = existingGroupSlots[0]
      if (first.cardinalityMin !== cardMin || (first.cardinalityMax ?? null) !== (input.cardinalityMax ?? null)) {
        throw new Error(
          'V-SLOT-3: Cardinality must be consistent across slots in the same component group',
        )
      }
    }

    // V-SLOT-7: circular slot chain detection
    if (targetSpec.specType === 'bundle') {
      const isCircular = await this.detectCircularSlotChain(input.specId, input.targetSpecId, scope)
      if (isCircular) {
        throw new Error('V-SLOT-7: Circular slot chain detected')
      }
    }

    const entity = this.em.create(CpqBundleSlot, { ...input, ...scope })
    await this.em.flush()

    return this.getSlot(entity.id, scope) as Promise<BundleSlotResult>
  }

  async updateSlot(
    slotId: string,
    input: {
      componentGroup?: string
      name?: string
      description?: string | null
      cardinalityMin?: number
      cardinalityMax?: number | null
      sortOrder?: number
      isActive?: boolean
      metadata?: Record<string, unknown> | null
    },
    scope: TenantScope,
  ): Promise<BundleSlotResult | null> {
    const slot = await this.em.findOne(CpqBundleSlot, { id: slotId, ...scope, deletedAt: null })
    if (!slot) return null

    if (input.cardinalityMin != null && input.cardinalityMin < 0) {
      throw new Error('V-SLOT-4: cardinalityMin must be >= 0')
    }
    const newMin = input.cardinalityMin ?? slot.cardinalityMin
    const newMax = input.cardinalityMax !== undefined ? input.cardinalityMax : slot.cardinalityMax
    if (newMax != null && newMax < newMin) {
      throw new Error('V-SLOT-5: cardinalityMax must be >= cardinalityMin')
    }

    // V-SLOT-3: if cardinality changed, update all slots in the same group
    const groupChanged =
      (input.cardinalityMin != null && input.cardinalityMin !== slot.cardinalityMin) ||
      (input.cardinalityMax !== undefined && (input.cardinalityMax ?? null) !== (slot.cardinalityMax ?? null))

    this.em.assign(slot, input)
    await this.em.flush()

    if (groupChanged) {
      const groupSlots = await this.em.find(CpqBundleSlot, {
        specId: slot.specId,
        componentGroup: slot.componentGroup,
        ...scope,
        deletedAt: null,
        id: { $ne: slotId },
      })
      for (const gs of groupSlots) {
        gs.cardinalityMin = newMin
        gs.cardinalityMax = newMax ?? undefined as any
      }
      await this.em.flush()
    }

    return this.getSlot(slotId, scope)
  }

  async deleteSlot(slotId: string, scope: TenantScope): Promise<boolean> {
    const slot = await this.em.findOne(CpqBundleSlot, { id: slotId, ...scope, deletedAt: null })
    if (!slot) return false

    const activeComponents = await this.em.count(CpqOfferingComponent, {
      slotId,
      ...scope,
      deletedAt: null,
      isActive: true,
    })
    if (activeComponents > 0) {
      throw new Error('Cannot delete slot with active offering components')
    }

    slot.deletedAt = new Date()
    await this.em.flush()
    return true
  }

  // ─── Offering Components ──────────────────────────────────────

  async getComponents(offeringId: string, scope: TenantScope): Promise<OfferingComponentResult[]> {
    const components = await this.em.find(
      CpqOfferingComponent,
      { offeringId, ...scope, deletedAt: null },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
    )

    const slotIds = [...new Set(components.map((c) => c.slotId))]
    const childOfferingIds = [...new Set(components.map((c) => c.childOfferingId))]

    const [slots, childOfferings] = await Promise.all([
      slotIds.length
        ? this.em.find(CpqBundleSlot, { id: { $in: slotIds }, ...scope, deletedAt: null })
        : [],
      childOfferingIds.length
        ? this.em.find(CpqProductOffering, { id: { $in: childOfferingIds }, ...scope, deletedAt: null })
        : [],
    ])

    const slotMap = new Map(slots.map((s) => [s.id, s]))
    const offeringMap = new Map(childOfferings.map((o) => [o.id, o]))

    return components.map((c) => {
      const slot = slotMap.get(c.slotId)
      const child = offeringMap.get(c.childOfferingId)
      return {
        id: c.id,
        offeringId: c.offeringId,
        slotId: c.slotId,
        slot: slot
          ? {
              id: slot.id,
              componentGroup: slot.componentGroup,
              name: slot.name,
              cardinalityMin: slot.cardinalityMin,
              cardinalityMax: slot.cardinalityMax ?? null,
            }
          : null,
        childOfferingId: c.childOfferingId,
        childOffering: child
          ? {
              id: child.id,
              code: child.code,
              name: child.name,
              offeringType: child.offeringType,
              specId: child.specId,
            }
          : null,
        isDefault: c.isDefault,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
      }
    })
  }

  async addComponent(
    input: {
      offeringId: string
      slotId: string
      childOfferingId: string
      isDefault?: boolean
      sortOrder?: number
      metadata?: Record<string, unknown> | null
    },
    scope: TenantScope,
  ): Promise<OfferingComponentResult> {
    // V-COMP-1: offering must be bundle type
    const offering = await this.em.findOne(CpqProductOffering, {
      id: input.offeringId,
      ...scope,
      deletedAt: null,
    })
    if (!offering) throw new Error('Offering not found')
    if (offering.offeringType !== 'bundle') {
      throw new Error('V-COMP-1: Offering must be bundle type')
    }

    // V-COMP-3: slot must belong to the offering's spec
    const slot = await this.em.findOne(CpqBundleSlot, {
      id: input.slotId,
      ...scope,
      deletedAt: null,
    })
    if (!slot) throw new Error('Slot not found')
    if (slot.specId !== offering.specId) {
      throw new Error('V-COMP-3: Slot must belong to the bundle offering\'s specification')
    }

    // V-COMP-2: child offering's spec must match slot's target_spec_id
    const childOffering = await this.em.findOne(CpqProductOffering, {
      id: input.childOfferingId,
      ...scope,
      deletedAt: null,
    })
    if (!childOffering) throw new Error('Child offering not found')
    if (childOffering.specId !== slot.targetSpecId) {
      throw new Error('V-COMP-2: Child offering spec must match the slot\'s target specification')
    }

    // V-COMP-5: no duplicate
    const existingDup = await this.em.findOne(CpqOfferingComponent, {
      offeringId: input.offeringId,
      childOfferingId: input.childOfferingId,
      ...scope,
      deletedAt: null,
    })
    if (existingDup) {
      throw new Error('V-COMP-5: This child offering is already a component of this bundle')
    }

    // V-COMP-4: circular reference detection
    if (childOffering.offeringType === 'bundle') {
      const isCircular = await this.detectCircularReference(input.offeringId, input.childOfferingId, scope)
      if (isCircular) {
        throw new Error('V-COMP-4: Circular reference detected')
      }
    }

    const entity = this.em.create(CpqOfferingComponent, { ...input, ...scope })
    await this.em.flush()

    const components = await this.getComponents(input.offeringId, scope)
    return components.find((c) => c.id === entity.id)!
  }

  async updateComponent(
    componentId: string,
    input: {
      isDefault?: boolean
      sortOrder?: number
      isActive?: boolean
      metadata?: Record<string, unknown> | null
    },
    scope: TenantScope,
  ): Promise<OfferingComponentResult | null> {
    const component = await this.em.findOne(CpqOfferingComponent, {
      id: componentId,
      ...scope,
      deletedAt: null,
    })
    if (!component) return null

    this.em.assign(component, input)
    await this.em.flush()

    const components = await this.getComponents(component.offeringId, scope)
    return components.find((c) => c.id === componentId) ?? null
  }

  async removeComponent(componentId: string, scope: TenantScope): Promise<boolean> {
    const component = await this.em.findOne(CpqOfferingComponent, {
      id: componentId,
      ...scope,
      deletedAt: null,
    })
    if (!component) return false

    component.deletedAt = new Date()
    await this.em.flush()
    return true
  }

  // ─── Bundle Resolution ────────────────────────────────────────

  async resolveBundleTree(
    offeringId: string,
    scope: TenantScope,
    visited: Set<string> = new Set(),
  ): Promise<BundleTreeNode | null> {
    if (visited.has(offeringId)) return null
    visited.add(offeringId)

    const offering = await this.em.findOne(CpqProductOffering, {
      id: offeringId,
      ...scope,
      deletedAt: null,
    })
    if (!offering) return null

    const spec = await this.em.findOne(CpqProductSpecification, {
      id: offering.specId,
      ...scope,
      deletedAt: null,
    })
    if (!spec) return null

    const charges = await this.em.find(CpqProductCharge, {
      offeringId: offering.id,
      ...scope,
      deletedAt: null,
    })

    const node: BundleTreeNode = {
      offeringId: offering.id,
      offeringCode: offering.code,
      offeringName: offering.name,
      offeringType: offering.offeringType,
      specId: spec.id,
      specType: spec.specType,
      isAssetizable: spec.isAssetizable,
      charges: charges.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        chargeType: c.chargeType,
        pricingMethod: c.pricingMethod,
        fixedPrice: c.fixedPrice,
        currencyCode: c.currencyCode,
      })),
      slots: [],
    }

    if (offering.offeringType !== 'bundle') return node

    const slots = await this.em.find(CpqBundleSlot, {
      specId: spec.id,
      ...scope,
      deletedAt: null,
      isActive: true,
    }, { orderBy: { sortOrder: 'asc' } })

    const components = await this.em.find(CpqOfferingComponent, {
      offeringId: offering.id,
      ...scope,
      deletedAt: null,
      isActive: true,
    }, { orderBy: { sortOrder: 'asc' } })

    const componentsBySlot = new Map<string, CpqOfferingComponent[]>()
    for (const comp of components) {
      const arr = componentsBySlot.get(comp.slotId) ?? []
      arr.push(comp)
      componentsBySlot.set(comp.slotId, arr)
    }

    for (const slot of slots) {
      const slotComponents = componentsBySlot.get(slot.id) ?? []
      const resolvedComponents: BundleTreeNode['slots'][0]['components'] = []

      for (const comp of slotComponents) {
        const childNode = await this.resolveBundleTree(comp.childOfferingId, scope, new Set(visited))
        if (childNode) {
          resolvedComponents.push({
            componentId: comp.id,
            childOffering: childNode,
            isDefault: comp.isDefault,
            sortOrder: comp.sortOrder,
          })
        }
      }

      node.slots.push({
        slotId: slot.id,
        componentGroup: slot.componentGroup,
        name: slot.name,
        cardinalityMin: slot.cardinalityMin,
        cardinalityMax: slot.cardinalityMax ?? null,
        components: resolvedComponents,
      })
    }

    return node
  }

  async validateBundleCompleteness(
    offeringId: string,
    scope: TenantScope,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    const offering = await this.em.findOne(CpqProductOffering, {
      id: offeringId,
      ...scope,
      deletedAt: null,
    })
    if (!offering || offering.offeringType !== 'bundle') {
      return { valid: false, errors: ['Not a bundle offering'] }
    }

    const slots = await this.em.find(CpqBundleSlot, {
      specId: offering.specId,
      ...scope,
      deletedAt: null,
      isActive: true,
    })

    const components = await this.em.find(CpqOfferingComponent, {
      offeringId,
      ...scope,
      deletedAt: null,
      isActive: true,
    })

    // Group slots by component_group
    const groups = new Map<string, { min: number; max: number | null; slotIds: string[] }>()
    for (const slot of slots) {
      const existing = groups.get(slot.componentGroup)
      if (existing) {
        existing.slotIds.push(slot.id)
      } else {
        groups.set(slot.componentGroup, {
          min: slot.cardinalityMin,
          max: slot.cardinalityMax ?? null,
          slotIds: [slot.id],
        })
      }
    }

    for (const [group, { min, slotIds }] of groups) {
      const groupComponentCount = components.filter((c) => slotIds.includes(c.slotId)).length
      if (min > 0 && groupComponentCount === 0) {
        errors.push(`Required slot group "${group}" has no components assigned`)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  async detectCircularReference(
    offeringId: string,
    childOfferingId: string,
    scope: TenantScope,
  ): Promise<boolean> {
    if (offeringId === childOfferingId) return true

    const visited = new Set<string>([offeringId])
    const queue = [childOfferingId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) return true
      visited.add(current)

      const childComponents = await this.em.find(CpqOfferingComponent, {
        offeringId: current,
        ...scope,
        deletedAt: null,
      })

      for (const comp of childComponents) {
        if (comp.childOfferingId === offeringId) return true
        queue.push(comp.childOfferingId)
      }
    }

    return false
  }

  private async detectCircularSlotChain(
    rootSpecId: string,
    targetSpecId: string,
    scope: TenantScope,
  ): Promise<boolean> {
    const visited = new Set<string>([rootSpecId])
    const queue = [targetSpecId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) return true
      visited.add(current)

      const spec = await this.em.findOne(CpqProductSpecification, {
        id: current,
        ...scope,
        deletedAt: null,
      })
      if (!spec || spec.specType !== 'bundle') continue

      const childSlots = await this.em.find(CpqBundleSlot, {
        specId: current,
        ...scope,
        deletedAt: null,
      })

      for (const slot of childSlots) {
        if (slot.targetSpecId === rootSpecId) return true
        queue.push(slot.targetSpecId)
      }
    }

    return false
  }
}
