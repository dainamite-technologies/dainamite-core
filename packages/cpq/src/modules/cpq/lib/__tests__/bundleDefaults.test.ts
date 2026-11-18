import { selectDefaultComponents } from '../bundleDefaults'
import type { BundleTreeNode } from '../../services/cpqBundleService'

function offering(id: string, overrides: Partial<BundleTreeNode> = {}): BundleTreeNode {
  return {
    offeringId: id, offeringCode: id, offeringName: id, offeringType: 'simple', isActive: true,
    specId: `spec-${id}`, specType: 'simple', isAssetizable: false, charges: [], slots: [], ...overrides,
  }
}

function slot(
  componentGroup: string,
  max: number | null,
  components: Array<{ child: BundleTreeNode; isDefault: boolean }>,
): BundleTreeNode['slots'][number] {
  return {
    slotId: `slot-${componentGroup}-${components.length}`, componentGroup, name: componentGroup,
    cardinalityMin: 1, cardinalityMax: max,
    components: components.map((c, i) => ({ componentId: `c-${c.child.offeringId}`, childOffering: c.child, isDefault: c.isDefault, sortOrder: i })),
  }
}

describe('selectDefaultComponents', () => {
  it('picks the default component of each slot (two 1..1 slots → two children)', () => {
    const bundle = offering('bundle', {
      offeringType: 'bundle',
      slots: [
        slot('access', 1, [{ child: offering('fiber'), isDefault: true }, { child: offering('dsl'), isDefault: false }]),
        slot('cpe', 1, [{ child: offering('ont'), isDefault: true }]),
      ],
    })
    expect(selectDefaultComponents(bundle).map((o) => o.offeringId)).toEqual(['fiber', 'ont'])
  })

  it('caps a slot group at cardinalityMax, in component order', () => {
    const bundle = offering('bundle', {
      slots: [slot('tv', 2, [
        { child: offering('a'), isDefault: true },
        { child: offering('b'), isDefault: true },
        { child: offering('c'), isDefault: true },
      ])],
    })
    expect(selectDefaultComponents(bundle).map((o) => o.offeringId)).toEqual(['a', 'b'])
  })

  it('counts the cap across slots of the same group', () => {
    const bundle = offering('bundle', {
      slots: [
        slot('addons', 1, [{ child: offering('a'), isDefault: true }]),
        slot('addons', 1, [{ child: offering('b'), isDefault: true }]),
      ],
    })
    expect(selectDefaultComponents(bundle).map((o) => o.offeringId)).toEqual(['a'])
  })

  it('takes every default when the group has no maximum', () => {
    const bundle = offering('bundle', {
      slots: [slot('extras', null, [{ child: offering('a'), isDefault: true }, { child: offering('b'), isDefault: true }])],
    })
    expect(selectDefaultComponents(bundle)).toHaveLength(2)
  })

  it('skips inactive child offerings', () => {
    const bundle = offering('bundle', {
      slots: [slot('access', 1, [
        { child: offering('retired', { isActive: false }), isDefault: true },
        { child: offering('fiber'), isDefault: true },
      ])],
    })
    expect(selectDefaultComponents(bundle).map((o) => o.offeringId)).toEqual(['fiber'])
  })

  it('returns nothing for a bundle without defaults', () => {
    const bundle = offering('bundle', { slots: [slot('access', 1, [{ child: offering('fiber'), isDefault: false }])] })
    expect(selectDefaultComponents(bundle)).toEqual([])
  })
})
