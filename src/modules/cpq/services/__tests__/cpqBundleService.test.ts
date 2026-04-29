import { DefaultCpqBundleService } from '../cpqBundleService'

interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
  count: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<number>>
  create: jest.MockedFunction<(entity: unknown, data: Record<string, unknown>) => unknown>
  assign: jest.MockedFunction<(entity: unknown, updates: Record<string, unknown>) => unknown>
  flush: jest.MockedFunction<() => Promise<void>>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_e, data: Record<string, unknown>) => ({ id: 'new-id', ...data })),
    assign: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

const SCOPE = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

function makeService() {
  const em = createMockEm()
  const service = new DefaultCpqBundleService(em as unknown as never)
  return { em, service }
}

describe('DefaultCpqBundleService.createSlot — validation rules', () => {
  it('throws "Specification not found" when spec lookup misses', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null) // spec lookup

    await expect(
      service.createSlot(
        {
          specId: 'spec-missing',
          targetSpecId: 'target-1',
          componentGroup: 'access',
          name: 'Slot 1',
        },
        SCOPE,
      ),
    ).rejects.toThrow('Specification not found')
  })

  it('V-SLOT-1: rejects when spec is not bundle type', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'simple' })

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'target-1',
          componentGroup: 'access',
          name: 'Slot 1',
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-1: Specification must be bundle type')
  })

  it('V-SLOT-2: rejects when target spec does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce(null) // target spec missing

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'missing',
          componentGroup: 'access',
          name: 'Slot 1',
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-2: Target specification not found')
  })

  it('V-SLOT-6: rejects self-referencing slot', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'spec-1',
          componentGroup: 'access',
          name: 'Slot 1',
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-6')
  })

  it('V-SLOT-4: rejects negative cardinalityMin', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce({ id: 'target', specType: 'simple' })

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'target',
          componentGroup: 'access',
          name: 'Slot 1',
          cardinalityMin: -1,
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-4')
  })

  it('V-SLOT-5: rejects cardinalityMax < cardinalityMin', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce({ id: 'target', specType: 'simple' })

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'target',
          componentGroup: 'access',
          name: 'Slot 1',
          cardinalityMin: 5,
          cardinalityMax: 2,
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-5')
  })

  it('V-SLOT-3: rejects mismatched cardinality vs existing slots in same group', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce({ id: 'target', specType: 'simple' })
    em.find.mockResolvedValueOnce([
      // existing slot with different cardinality in 'access' group
      { cardinalityMin: 1, cardinalityMax: 2 },
    ])

    await expect(
      service.createSlot(
        {
          specId: 'spec-1',
          targetSpecId: 'target',
          componentGroup: 'access',
          name: 'Slot 1',
          cardinalityMin: 0,
          cardinalityMax: null,
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-3')
  })

  it('accepts when cardinality matches existing slots in the same group', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', specType: 'bundle' })
    em.findOne.mockResolvedValueOnce({ id: 'target', specType: 'simple' })
    em.find.mockResolvedValueOnce([{ cardinalityMin: 0, cardinalityMax: null }])
    // For getSlot at the end:
    em.findOne.mockResolvedValueOnce({
      id: 'new-id',
      specId: 'spec-1',
      targetSpecId: 'target',
      componentGroup: 'access',
      name: 'Slot 1',
      description: null,
      cardinalityMin: 0,
      cardinalityMax: null,
      sortOrder: 0,
      isActive: true,
    })
    em.findOne.mockResolvedValueOnce({ id: 'target', code: 'T', name: 'Target', specType: 'simple' })

    const result = await service.createSlot(
      {
        specId: 'spec-1',
        targetSpecId: 'target',
        componentGroup: 'access',
        name: 'Slot 1',
      },
      SCOPE,
    )

    expect(result.specId).toBe('spec-1')
    expect(em.flush).toHaveBeenCalled()
  })

  it('V-SLOT-7: rejects when target spec leads back via slot chain (circular)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'spec-A', specType: 'bundle' }) // root
    em.findOne.mockResolvedValueOnce({ id: 'spec-B', specType: 'bundle' }) // target — also bundle, triggers chain check
    em.find.mockResolvedValueOnce([]) // no existing group slots

    // detectCircularSlotChain begins:
    em.findOne.mockResolvedValueOnce({ id: 'spec-B', specType: 'bundle' }) // current = spec-B
    em.find.mockResolvedValueOnce([{ targetSpecId: 'spec-A' }]) // B has slot back to A → circular

    await expect(
      service.createSlot(
        {
          specId: 'spec-A',
          targetSpecId: 'spec-B',
          componentGroup: 'access',
          name: 'Slot 1',
        },
        SCOPE,
      ),
    ).rejects.toThrow('V-SLOT-7')
  })
})

describe('DefaultCpqBundleService.updateSlot', () => {
  it('returns null when slot does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)
    expect(await service.updateSlot('missing', { name: 'X' }, SCOPE)).toBeNull()
  })

  it('rejects negative cardinalityMin', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', cardinalityMin: 0, cardinalityMax: null })

    await expect(
      service.updateSlot('s1', { cardinalityMin: -1 }, SCOPE),
    ).rejects.toThrow('V-SLOT-4')
  })

  it('rejects cardinalityMax < cardinalityMin (after merging incoming + existing values)', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', cardinalityMin: 5, cardinalityMax: null })

    await expect(
      service.updateSlot('s1', { cardinalityMax: 2 }, SCOPE),
    ).rejects.toThrow('V-SLOT-5')
  })

  it('propagates a cardinality change to other slots in the same group', async () => {
    const { em, service } = makeService()
    const slot = {
      id: 's1',
      specId: 'spec-1',
      componentGroup: 'access',
      cardinalityMin: 0,
      cardinalityMax: null,
    }
    em.findOne.mockResolvedValueOnce(slot)
    const groupMate = { id: 's2', cardinalityMin: 0, cardinalityMax: null }
    em.find.mockResolvedValueOnce([groupMate])
    // getSlot at the end:
    em.findOne.mockResolvedValueOnce({
      id: 's1',
      specId: 'spec-1',
      targetSpecId: 'target',
      componentGroup: 'access',
      name: 'Slot 1',
      description: null,
      cardinalityMin: 1,
      cardinalityMax: 3,
      sortOrder: 0,
      isActive: true,
    })
    em.findOne.mockResolvedValueOnce({ id: 'target', code: 'T', name: 'Target', specType: 'simple' })

    await service.updateSlot('s1', { cardinalityMin: 1, cardinalityMax: 3 }, SCOPE)

    expect(groupMate.cardinalityMin).toBe(1)
    expect(groupMate.cardinalityMax).toBe(3)
    expect(em.flush).toHaveBeenCalledTimes(2) // assign + group propagation
  })

  it('does NOT requery group when cardinality is unchanged', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({
      id: 's1',
      specId: 'spec-1',
      componentGroup: 'access',
      cardinalityMin: 0,
      cardinalityMax: null,
    })
    em.findOne.mockResolvedValueOnce({
      id: 's1',
      specId: 'spec-1',
      targetSpecId: 'target',
      componentGroup: 'access',
      name: 'Renamed',
      description: null,
      cardinalityMin: 0,
      cardinalityMax: null,
      sortOrder: 0,
      isActive: true,
    })
    em.findOne.mockResolvedValueOnce(null)

    await service.updateSlot('s1', { name: 'Renamed' }, SCOPE)

    expect(em.find).not.toHaveBeenCalled() // no group requery
  })
})

describe('DefaultCpqBundleService.deleteSlot', () => {
  it('returns false when slot does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)
    expect(await service.deleteSlot('missing', SCOPE)).toBe(false)
  })

  it('rejects deletion when active components reference the slot', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 's1', deletedAt: null })
    em.count.mockResolvedValueOnce(2)

    await expect(service.deleteSlot('s1', SCOPE)).rejects.toThrow(/active offering components/)
  })

  it('soft-deletes when no active components remain', async () => {
    const { em, service } = makeService()
    const slot = { id: 's1', deletedAt: null }
    em.findOne.mockResolvedValueOnce(slot)
    em.count.mockResolvedValueOnce(0)

    expect(await service.deleteSlot('s1', SCOPE)).toBe(true)
    expect(slot.deletedAt).toBeInstanceOf(Date)
  })
})

describe('DefaultCpqBundleService.addComponent — validation rules', () => {
  it('throws when bundle offering is not found', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    await expect(
      service.addComponent(
        { offeringId: 'missing', slotId: 's', childOfferingId: 'c' },
        SCOPE,
      ),
    ).rejects.toThrow('Offering not found')
  })

  it('V-COMP-1: rejects when offering is not bundle type', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'simple' })

    await expect(
      service.addComponent(
        { offeringId: 'o', slotId: 's', childOfferingId: 'c' },
        SCOPE,
      ),
    ).rejects.toThrow('V-COMP-1')
  })

  it('V-COMP-3: rejects when slot does not belong to the offering\'s spec', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.findOne.mockResolvedValueOnce({ id: 's', specId: 'spec-DIFFERENT', targetSpecId: 't' })

    await expect(
      service.addComponent(
        { offeringId: 'o', slotId: 's', childOfferingId: 'c' },
        SCOPE,
      ),
    ).rejects.toThrow('V-COMP-3')
  })

  it('V-COMP-2: rejects when child offering\'s spec does not match slot.targetSpecId', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.findOne.mockResolvedValueOnce({ id: 's', specId: 'spec-1', targetSpecId: 'target-spec' })
    em.findOne.mockResolvedValueOnce({ id: 'c', specId: 'wrong-spec', offeringType: 'simple' })

    await expect(
      service.addComponent(
        { offeringId: 'o', slotId: 's', childOfferingId: 'c' },
        SCOPE,
      ),
    ).rejects.toThrow('V-COMP-2')
  })

  it('V-COMP-5: rejects duplicate child offering on the same bundle', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.findOne.mockResolvedValueOnce({ id: 's', specId: 'spec-1', targetSpecId: 'target-spec' })
    em.findOne.mockResolvedValueOnce({ id: 'c', specId: 'target-spec', offeringType: 'simple' })
    em.findOne.mockResolvedValueOnce({ id: 'existing-component' })

    await expect(
      service.addComponent(
        { offeringId: 'o', slotId: 's', childOfferingId: 'c' },
        SCOPE,
      ),
    ).rejects.toThrow('V-COMP-5')
  })

  it('throws when child offering does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.findOne.mockResolvedValueOnce({ id: 's', specId: 'spec-1', targetSpecId: 't' })
    em.findOne.mockResolvedValueOnce(null) // child offering missing

    await expect(
      service.addComponent(
        { offeringId: 'o', slotId: 's', childOfferingId: 'missing' },
        SCOPE,
      ),
    ).rejects.toThrow('Child offering not found')
  })

  it('V-COMP-4: rejects circular bundle reference', async () => {
    const { em, service } = makeService()
    // bundle-A wants to add bundle-A as a child via spec-target — but bundle-B (the child) has
    // a component pointing back to bundle-A.
    em.findOne.mockResolvedValueOnce({ id: 'A', offeringType: 'bundle', specId: 'spec-A' })
    em.findOne.mockResolvedValueOnce({ id: 'slot', specId: 'spec-A', targetSpecId: 'spec-B' })
    em.findOne.mockResolvedValueOnce({ id: 'B', offeringType: 'bundle', specId: 'spec-B' })
    em.findOne.mockResolvedValueOnce(null) // no existing duplicate

    // detectCircularReference traversal:
    // queue starts with childOfferingId 'B'
    em.find.mockResolvedValueOnce([{ childOfferingId: 'A' }]) // B has component pointing back to A → circular

    await expect(
      service.addComponent(
        { offeringId: 'A', slotId: 'slot', childOfferingId: 'B' },
        SCOPE,
      ),
    ).rejects.toThrow('V-COMP-4')
  })
})

describe('DefaultCpqBundleService.detectCircularReference', () => {
  it('returns true immediately when offering and child are the same', async () => {
    const { service } = makeService()
    expect(await service.detectCircularReference('o1', 'o1', SCOPE)).toBe(true)
  })

  it('returns false when child has no further components', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([])

    expect(await service.detectCircularReference('parent', 'child', SCOPE)).toBe(false)
  })

  it('detects multi-hop circular reference (A → B → C → A)', async () => {
    const { em, service } = makeService()
    em.find
      .mockResolvedValueOnce([{ childOfferingId: 'C' }]) // B's children
      .mockResolvedValueOnce([{ childOfferingId: 'A' }]) // C's children → back to A

    expect(await service.detectCircularReference('A', 'B', SCOPE)).toBe(true)
  })
})

describe('DefaultCpqBundleService.removeComponent', () => {
  it('returns false when component does not exist', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)
    expect(await service.removeComponent('missing', SCOPE)).toBe(false)
  })

  it('soft-deletes when component is found', async () => {
    const { em, service } = makeService()
    const comp = { id: 'c1', deletedAt: null }
    em.findOne.mockResolvedValueOnce(comp)

    expect(await service.removeComponent('c1', SCOPE)).toBe(true)
    expect(comp.deletedAt).toBeInstanceOf(Date)
  })
})

describe('DefaultCpqBundleService.validateBundleCompleteness', () => {
  it('returns invalid when offering is not found', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.validateBundleCompleteness('missing', SCOPE)
    expect(result).toEqual({ valid: false, errors: ['Not a bundle offering'] })
  })

  it('returns invalid when offering is not bundle type', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'simple' })

    const result = await service.validateBundleCompleteness('o', SCOPE)
    expect(result).toEqual({ valid: false, errors: ['Not a bundle offering'] })
  })

  it('passes when all required slot groups have components', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.find.mockResolvedValueOnce([
      { id: 'slot-1', componentGroup: 'access', cardinalityMin: 1, cardinalityMax: null },
      { id: 'slot-2', componentGroup: 'optional', cardinalityMin: 0, cardinalityMax: null },
    ])
    em.find.mockResolvedValueOnce([
      { slotId: 'slot-1' }, // access satisfied; optional doesn't need anything
    ])

    const result = await service.validateBundleCompleteness('o', SCOPE)
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('flags required slot groups with no assigned components', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.find.mockResolvedValueOnce([
      { id: 'slot-1', componentGroup: 'access', cardinalityMin: 1, cardinalityMax: null },
      { id: 'slot-2', componentGroup: 'transport', cardinalityMin: 1, cardinalityMax: null },
    ])
    em.find.mockResolvedValueOnce([
      { slotId: 'slot-1' }, // access satisfied; transport NOT
    ])

    const result = await service.validateBundleCompleteness('o', SCOPE)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      expect.stringContaining('"transport"'),
    ])
  })

  it('does NOT flag optional groups (cardinalityMin = 0) with zero components', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce({ id: 'o', offeringType: 'bundle', specId: 'spec-1' })
    em.find.mockResolvedValueOnce([
      { id: 'slot-1', componentGroup: 'extras', cardinalityMin: 0, cardinalityMax: 5 },
    ])
    em.find.mockResolvedValueOnce([])

    const result = await service.validateBundleCompleteness('o', SCOPE)
    expect(result).toEqual({ valid: true, errors: [] })
  })
})

describe('DefaultCpqBundleService.getSlots / getSlot', () => {
  it('getSlots maps each slot with its target spec metadata', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([
      {
        id: 's1',
        specId: 'spec-1',
        targetSpecId: 'target-1',
        componentGroup: 'access',
        name: 'Slot 1',
        description: null,
        cardinalityMin: 0,
        cardinalityMax: null,
        sortOrder: 0,
        isActive: true,
      },
    ])
    em.find.mockResolvedValueOnce([
      { id: 'target-1', code: 'T1', name: 'Target One', specType: 'simple' },
    ])

    const result = await service.getSlots('spec-1', SCOPE)
    expect(result[0].targetSpec).toEqual({
      id: 'target-1',
      code: 'T1',
      name: 'Target One',
      specType: 'simple',
    })
  })

  it('getSlots returns null targetSpec when target metadata is missing', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([
      {
        id: 's1',
        specId: 'spec-1',
        targetSpecId: 'gone',
        componentGroup: 'access',
        name: 'Slot 1',
        description: null,
        cardinalityMin: 0,
        cardinalityMax: null,
        sortOrder: 0,
        isActive: true,
      },
    ])
    em.find.mockResolvedValueOnce([])

    const result = await service.getSlots('spec-1', SCOPE)
    expect(result[0].targetSpec).toBeNull()
  })

  it('getSlot returns null when slot is not found', async () => {
    const { em, service } = makeService()
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.getSlot('missing', SCOPE)
    expect(result).toBeNull()
  })
})

describe('DefaultCpqBundleService.getComponents', () => {
  it('returns empty list when there are no components', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([])

    const result = await service.getComponents('o', SCOPE)
    expect(result).toEqual([])
  })

  it('joins slot and child offering metadata onto each component', async () => {
    const { em, service } = makeService()
    em.find.mockResolvedValueOnce([
      {
        id: 'c1',
        offeringId: 'o',
        slotId: 's1',
        childOfferingId: 'co1',
        isDefault: true,
        sortOrder: 0,
        isActive: true,
      },
    ])
    em.find
      .mockResolvedValueOnce([
        {
          id: 's1',
          componentGroup: 'access',
          name: 'Access Slot',
          cardinalityMin: 1,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'co1',
          code: 'CO1',
          name: 'Child Offering 1',
          offeringType: 'simple',
          specId: 'target-spec',
        },
      ])

    const result = await service.getComponents('o', SCOPE)
    expect(result[0].slot).toEqual({
      id: 's1',
      componentGroup: 'access',
      name: 'Access Slot',
      cardinalityMin: 1,
      cardinalityMax: null,
    })
    expect(result[0].childOffering).toMatchObject({ id: 'co1', code: 'CO1' })
  })
})
