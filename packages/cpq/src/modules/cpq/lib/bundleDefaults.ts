import type { BundleTreeNode } from '../services/cpqBundleService'

/**
 * #123 — the child offerings to add as default component lines when a bundle
 * is added to a quote.
 *
 * Cardinality is defined per slot *group* (V-SLOT-3), so defaults are picked
 * per group: slots in their order, components in their order, only active
 * child offerings marked `isDefault`, and never more than the group's
 * `cardinalityMax`. Fewer defaults than `cardinalityMin` is allowed — the
 * bundle then shows V-QBUN-1 until the user adds the rest.
 */
export function selectDefaultComponents(node: BundleTreeNode): BundleTreeNode[] {
  const picked: BundleTreeNode[] = []
  const countByGroup = new Map<string, number>()
  for (const slot of node.slots) {
    for (const component of slot.components) {
      if (!component.isDefault || !component.childOffering.isActive) continue
      const count = countByGroup.get(slot.componentGroup) ?? 0
      if (slot.cardinalityMax != null && count >= slot.cardinalityMax) break
      countByGroup.set(slot.componentGroup, count + 1)
      picked.push(component.childOffering)
    }
  }
  return picked
}
