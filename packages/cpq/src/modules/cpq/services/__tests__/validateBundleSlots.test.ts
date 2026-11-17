/**
 * #124 — quote-time bundle slot rules (XD-223 V-QBUN-1..4).
 */
import { DefaultCpqValidationService } from '../cpqValidationService'
import {
  CpqBundleSlot,
  CpqOfferingComponent,
  CpqProductOffering,
  CpqProductRelationship,
} from '../../data/entities'
import type { TenantScope } from '../types'

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

type Row = Record<string, unknown>
type Line = Parameters<DefaultCpqValidationService['validateBundleSlots']>[0]['lines'][number]

function service(data: { offerings: Row[]; slots: Row[]; components: Row[]; relationships?: Row[] }) {
  const em = {
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqProductOffering) {
        const ids = (where.id as { $in: string[] }).$in
        return data.offerings.filter((o) => ids.includes(o.id as string) && o.offeringType === 'bundle')
      }
      if (entity === CpqBundleSlot) return data.slots
      if (entity === CpqOfferingComponent) return data.components
      if (entity === CpqProductRelationship) return data.relationships ?? []
      return []
    }),
  }
  return new DefaultCpqValidationService(em as never)
}

// Bundle "Fiber Home" (spec-b) with two required 1..1 slots: access and cpe.
const catalog = {
  offerings: [{ id: 'b', specId: 'spec-b', offeringType: 'bundle', name: 'Fiber Home' }],
  slots: [
    { id: 's-access', specId: 'spec-b', componentGroup: 'access', name: 'Access', cardinalityMin: 1, cardinalityMax: 1 },
    { id: 's-cpe', specId: 'spec-b', componentGroup: 'cpe', name: 'CPE', cardinalityMin: 1, cardinalityMax: 1 },
  ],
  components: [
    { offeringId: 'b', slotId: 's-access', childOfferingId: 'fiber' },
    { offeringId: 'b', slotId: 's-access', childOfferingId: 'fiber-pro' },
    { offeringId: 'b', slotId: 's-cpe', childOfferingId: 'ont' },
  ],
}

const line = (lineId: string, offeringId: string, parentLineId: string | null = null, overrides: Partial<Line> = {}): Line => ({
  lineId, offeringId, specId: `spec-${offeringId}`, parentLineId, action: 'add',
  isArcCancelled: false, isArcMirrored: false, ...overrides,
})

describe('DefaultCpqValidationService.validateBundleSlots', () => {
  it('returns no errors for a complete bundle', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [line('L1', 'b'), line('L2', 'fiber', 'L1'), line('L3', 'ont', 'L1')],
      scope: SCOPE,
    })
    expect(errors).toEqual([])
  })

  it('V-QBUN-1: names each required slot group that is empty, on the bundle line', async () => {
    const errors = await service(catalog).validateBundleSlots({ lines: [line('L1', 'b')], scope: SCOPE })
    expect(errors).toEqual([
      expect.objectContaining({ lineId: 'L1', type: 'bundle_slot', slotGroup: 'access', message: 'V-QBUN-1: Access requires at least 1 component(s) (0 selected)' }),
      expect.objectContaining({ lineId: 'L1', type: 'bundle_slot', slotGroup: 'cpe', message: 'V-QBUN-1: CPE requires at least 1 component(s) (0 selected)' }),
    ])
  })

  it('V-QBUN-2: flags a slot group over its maximum', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [line('L1', 'b'), line('L2', 'fiber', 'L1'), line('L3', 'fiber-pro', 'L1'), line('L4', 'ont', 'L1')],
      scope: SCOPE,
    })
    expect(errors).toEqual([expect.objectContaining({ lineId: 'L1', message: 'V-QBUN-2: Access allows at most 1 component(s) (2 selected)' })])
  })

  it('V-QBUN-3: flags a child that is not a component of the bundle, on the child line', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [line('L1', 'b'), line('L2', 'fiber', 'L1'), line('L3', 'ont', 'L1'), line('L4', 'stray', 'L1')],
      scope: SCOPE,
    })
    expect(errors).toEqual([expect.objectContaining({ lineId: 'L4', type: 'bundle_slot', message: expect.stringMatching(/^V-QBUN-3: .*Fiber Home/) })])
  })

  it('does not flag an add-on allowed by a parent_child relationship from the bundle spec', async () => {
    const errors = await service({
      ...catalog,
      relationships: [{ sourceSpecId: 'spec-b', targetSpecId: 'spec-static-ip', relationshipType: 'parent_child' }],
    }).validateBundleSlots({
      lines: [line('L1', 'b'), line('L2', 'fiber', 'L1'), line('L3', 'ont', 'L1'), line('L4', 'static-ip', 'L1')],
      scope: SCOPE,
    })
    expect(errors).toEqual([])
  })

  it('does not count children marked for removal by ARC', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [
        line('L1', 'b', null, { isArcMirrored: true, action: 'modify' }),
        line('L2', 'fiber', 'L1', { isArcMirrored: true, action: 'modify' }),
        line('L3', 'ont', 'L1', { isArcMirrored: true, isArcCancelled: true, action: 'cancel' }),
      ],
      scope: SCOPE,
    })
    expect(errors.map((e) => e.message)).toEqual(['V-QBUN-1: CPE requires at least 1 component(s) (0 selected)'])
  })

  it('grandfathers a mirrored subscription bundle whose children the quote does not change', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [
        line('L1', 'b', null, { isArcMirrored: true, action: 'modify' }),
        line('L2', 'fiber', 'L1', { isArcMirrored: true, action: 'modify' }),
      ],
      scope: SCOPE,
    })
    expect(errors).toEqual([])
  })

  it('does not flag a mirrored child whose component was later removed from the catalog', async () => {
    const errors = await service(catalog).validateBundleSlots({
      lines: [
        line('L1', 'b', null, { isArcMirrored: true, action: 'modify' }),
        line('L2', 'fiber', 'L1', { isArcMirrored: true, action: 'modify' }),
        line('L3', 'legacy-cpe', 'L1', { isArcMirrored: true, action: 'modify' }),
        line('L4', 'ont', 'L1', { action: 'add' }), // the quote adds a child, so the bundle is re-checked
      ],
      scope: SCOPE,
    })
    expect(errors).toEqual([])
  })

  it('V-QBUN-4: checks a nested bundle on its own', async () => {
    const nested = {
      offerings: [...catalog.offerings, { id: 'tv', specId: 'spec-tv', offeringType: 'bundle', name: 'TV Pack' }],
      slots: [...catalog.slots, { id: 's-base', specId: 'spec-tv', componentGroup: 'base', name: 'Base channels', cardinalityMin: 1, cardinalityMax: 1 }],
      components: [...catalog.components, { offeringId: 'b', slotId: 's-access', childOfferingId: 'tv' }],
    }
    const errors = await service(nested).validateBundleSlots({
      lines: [line('L1', 'b'), line('L2', 'tv', 'L1'), line('L3', 'ont', 'L1')],
      scope: SCOPE,
    })
    expect(errors).toEqual([expect.objectContaining({ lineId: 'L2', slotGroup: 'base' })])
  })

  it('skips the catalog queries when no line is a bundle', async () => {
    const svc = service({ offerings: [], slots: [], components: [] })
    expect(await svc.validateBundleSlots({ lines: [line('L1', 'fiber')], scope: SCOPE })).toEqual([])
  })
})
