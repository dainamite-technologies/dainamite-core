import { DefaultCpqValidationService } from '../cpqValidationService'
import {
  CpqProductAttribute,
  CpqProductOffering,
  CpqProductRelationship,
  CpqProductSpecification,
  CpqPricingTable,
  CpqPricingTableEntry,
} from '../../data/entities'
import type { TenantScope } from '../types'

type EntityCtor =
  | typeof CpqProductAttribute
  | typeof CpqProductOffering
  | typeof CpqProductRelationship
  | typeof CpqProductSpecification
  | typeof CpqPricingTable
  | typeof CpqPricingTableEntry

type FindOneFn = (entity: EntityCtor, where: Record<string, unknown>) => Promise<unknown>
type FindFn = (
  entity: EntityCtor,
  where: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<unknown[]>

interface MockEm {
  findOne: jest.MockedFunction<FindOneFn>
  find: jest.MockedFunction<FindFn>
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
}

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

describe('DefaultCpqValidationService.validateOfferingConfiguration', () => {
  let em: MockEm
  let service: DefaultCpqValidationService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqValidationService(em as unknown as never)
  })

  it('returns an "Offering not found" error when the offering does not exist', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.validateOfferingConfiguration({
      offeringId: 'missing',
      configuration: {},
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      { type: 'attribute', message: 'Offering missing not found' },
    ])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('passes validation when no run-time attributes are defined', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'offering-1',
      specId: 'spec-1',
      designTimeValues: {},
    })
    em.find.mockResolvedValueOnce([])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'offering-1',
      configuration: {},
      scope: SCOPE,
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('flags missing required run-time attribute', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'offering-1',
      specId: 'spec-1',
      designTimeValues: {},
    })
    em.find.mockResolvedValueOnce([
      {
        code: 'port_speed',
        name: 'Port Speed',
        attributeType: 'enum',
        isRequired: true,
        options: null,
        constraints: null,
        dependsOn: null,
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'offering-1',
      configuration: {},
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      { type: 'attribute', attribute: 'port_speed', message: 'Port Speed is required.' },
    ])
  })

  it('treats empty string as missing for required attributes', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'o',
      specId: 's',
      designTimeValues: {},
    })
    em.find.mockResolvedValueOnce([
      { code: 'port_speed', name: 'Port Speed', attributeType: 'enum', isRequired: true },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { port_speed: '' },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/required/)
  })

  it('passes when configuration provides all required attributes', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'o',
      specId: 's',
      designTimeValues: {},
    })
    em.find.mockResolvedValueOnce([
      {
        code: 'port_speed',
        name: 'Port Speed',
        attributeType: 'enum',
        isRequired: true,
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { port_speed: '10G' },
      scope: SCOPE,
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('merges design-time values into the evaluation context (so they satisfy requirements)', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'o',
      specId: 's',
      designTimeValues: { port_speed: '1G' },
    })
    em.find.mockResolvedValueOnce([
      { code: 'port_speed', name: 'Port Speed', attributeType: 'enum', isRequired: true },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: {},
      scope: SCOPE,
    })

    expect(result.valid).toBe(true)
  })

  it('flags select/enum value not in the allowed options list', async () => {
    em.findOne.mockResolvedValueOnce({
      id: 'o',
      specId: 's',
      designTimeValues: {},
    })
    em.find.mockResolvedValueOnce([
      {
        code: 'port_speed',
        name: 'Port Speed',
        attributeType: 'select',
        isRequired: true,
        options: [
          { value: '1G', label: '1 Gbps' },
          { value: '10G', label: '10 Gbps' },
        ],
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { port_speed: '40G' },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/must be one of: 1G, 10G/)
  })

  it('rejects non-numeric values for number attributes', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      { code: 'qty', name: 'Quantity', attributeType: 'number', isRequired: true },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { qty: 'abc' },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/must be a number/)
  })

  it('enforces min constraint on number attributes', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      {
        code: 'qty',
        name: 'Quantity',
        attributeType: 'number',
        isRequired: true,
        constraints: { min: 5 },
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { qty: 3 },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/at least 5/)
  })

  it('enforces max constraint on number attributes', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      {
        code: 'qty',
        name: 'Quantity',
        attributeType: 'number',
        isRequired: true,
        constraints: { max: 100 },
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { qty: 200 },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/at most 100/)
  })

  it('enforces step constraint on number attributes', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      {
        code: 'qty',
        name: 'Quantity',
        attributeType: 'number',
        isRequired: true,
        constraints: { min: 0, step: 5 },
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { qty: 7 },
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toMatch(/in increments of 5/)
  })

  it('skips validation for an attribute whose dependency is unmet (hidden field)', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      {
        code: 'sub_speed',
        name: 'Sub Speed',
        attributeType: 'enum',
        isRequired: true,
        dependsOn: { attributeCode: 'main_speed' },
      },
    ])

    // main_speed is not provided → sub_speed should be skipped
    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: {},
      scope: SCOPE,
    })

    expect(result.valid).toBe(true)
  })

  it('still validates a dependent attribute when the parent dependency is satisfied', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 's', designTimeValues: {} })
    em.find.mockResolvedValueOnce([
      {
        code: 'sub_speed',
        name: 'Sub Speed',
        attributeType: 'enum',
        isRequired: true,
        dependsOn: { attributeCode: 'main_speed' },
      },
    ])

    const result = await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: { main_speed: '10G' }, // dependency satisfied, sub_speed missing
      scope: SCOPE,
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.attribute).toBe('sub_speed')
  })

  it('queries only run-time + active attributes scoped to the spec', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'o', specId: 'spec-xyz', designTimeValues: {} })
    em.find.mockResolvedValueOnce([])

    await service.validateOfferingConfiguration({
      offeringId: 'o',
      configuration: {},
      scope: SCOPE,
    })

    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({
      specId: 'spec-xyz',
      resolutionTime: 'run_time',
      isActive: true,
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      deletedAt: null,
    })
  })
})

describe('DefaultCpqValidationService.validateProductConfiguration (v1 compat)', () => {
  let em: MockEm
  let service: DefaultCpqValidationService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqValidationService(em as unknown as never)
  })

  it('queries attributes by productId (not specId)', async () => {
    em.find.mockResolvedValueOnce([])

    await service.validateProductConfiguration({
      productId: 'product-1',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({
      productId: 'product-1',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      isActive: true,
      deletedAt: null,
    })
    expect(where).not.toHaveProperty('resolutionTime')
  })

  it('passes when no attributes are defined for the product', async () => {
    em.find.mockResolvedValueOnce([])

    const result = await service.validateProductConfiguration({
      productId: 'product-1',
      configuration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })
})

describe('DefaultCpqValidationService.validateRelationships', () => {
  let em: MockEm
  let service: DefaultCpqValidationService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqValidationService(em as unknown as never)
  })

  it('returns an empty array when there are no specIds on the lines', async () => {
    const errors = await service.validateRelationships({
      lines: [{ lineId: 'l1', specId: null, parentLineId: null }],
      scope: SCOPE,
    })

    expect(errors).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('flags requires when a referenced target spec is missing from the quote', async () => {
    em.find
      .mockResolvedValueOnce([
        // relationships: spec-A requires spec-B
        {
          sourceSpecId: 'spec-A',
          targetSpecId: 'spec-B',
          relationshipType: 'requires',
          cardinalityMin: 0,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([
        // specs metadata
        { id: 'spec-A', code: 'A' },
      ])

    const errors = await service.validateRelationships({
      lines: [{ lineId: 'l1', specId: 'spec-A', parentLineId: null }],
      scope: SCOPE,
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'relationship',
      relationshipType: 'requires',
      sourceSpec: 'A',
      targetSpec: 'spec-B',
    })
    expect(errors[0].message).toMatch(/A requires spec-B/)
  })

  it('does not flag requires when the target spec IS present', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-A',
          targetSpecId: 'spec-B',
          relationshipType: 'requires',
          cardinalityMin: 0,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'spec-A', code: 'A' },
        { id: 'spec-B', code: 'B' },
      ])

    const errors = await service.validateRelationships({
      lines: [
        { lineId: 'l1', specId: 'spec-A', parentLineId: null },
        { lineId: 'l2', specId: 'spec-B', parentLineId: null },
      ],
      scope: SCOPE,
    })

    expect(errors).toEqual([])
  })

  it('flags excludes when both specs are present together', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-A',
          targetSpecId: 'spec-B',
          relationshipType: 'excludes',
          cardinalityMin: 0,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'spec-A', code: 'A' },
        { id: 'spec-B', code: 'B' },
      ])

    const errors = await service.validateRelationships({
      lines: [
        { lineId: 'l1', specId: 'spec-A', parentLineId: null },
        { lineId: 'l2', specId: 'spec-B', parentLineId: null },
      ],
      scope: SCOPE,
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: 'relationship',
      relationshipType: 'excludes',
      sourceSpec: 'A',
      targetSpec: 'B',
    })
    expect(errors[0].message).toMatch(/cannot co-exist/)
  })

  it('flags parent_child when child count is below cardinalityMin', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-bundle',
          targetSpecId: 'spec-port',
          relationshipType: 'parent_child',
          cardinalityMin: 2,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'spec-bundle', code: 'BUNDLE' },
        { id: 'spec-port', code: 'PORT' },
      ])

    const errors = await service.validateRelationships({
      lines: [
        { lineId: 'parent-1', specId: 'spec-bundle', parentLineId: null },
        { lineId: 'child-1', specId: 'spec-port', parentLineId: 'parent-1' },
        // only 1 child of PORT under BUNDLE; need 2
      ],
      scope: SCOPE,
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].relationshipType).toBe('parent_child')
    expect(errors[0].message).toMatch(/at least 2 child item\(s\) of type PORT/)
  })

  it('flags parent_child when child count exceeds cardinalityMax', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-bundle',
          targetSpecId: 'spec-port',
          relationshipType: 'parent_child',
          cardinalityMin: 0,
          cardinalityMax: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'spec-bundle', code: 'BUNDLE' },
        { id: 'spec-port', code: 'PORT' },
      ])

    const errors = await service.validateRelationships({
      lines: [
        { lineId: 'parent-1', specId: 'spec-bundle', parentLineId: null },
        { lineId: 'child-1', specId: 'spec-port', parentLineId: 'parent-1' },
        { lineId: 'child-2', specId: 'spec-port', parentLineId: 'parent-1' },
      ],
      scope: SCOPE,
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/at most 1 child item\(s\) of type PORT/)
  })

  it('does not flag parent_child when child count is within cardinality bounds', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-bundle',
          targetSpecId: 'spec-port',
          relationshipType: 'parent_child',
          cardinalityMin: 1,
          cardinalityMax: 4,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'spec-bundle', code: 'BUNDLE' },
        { id: 'spec-port', code: 'PORT' },
      ])

    const errors = await service.validateRelationships({
      lines: [
        { lineId: 'parent-1', specId: 'spec-bundle', parentLineId: null },
        { lineId: 'child-1', specId: 'spec-port', parentLineId: 'parent-1' },
        { lineId: 'child-2', specId: 'spec-port', parentLineId: 'parent-1' },
      ],
      scope: SCOPE,
    })

    expect(errors).toEqual([])
  })

  it('falls back to spec id in messages when spec metadata is missing', async () => {
    em.find
      .mockResolvedValueOnce([
        {
          sourceSpecId: 'spec-A',
          targetSpecId: 'spec-B',
          relationshipType: 'requires',
          cardinalityMin: 0,
          cardinalityMax: null,
        },
      ])
      .mockResolvedValueOnce([]) // no spec metadata returned

    const errors = await service.validateRelationships({
      lines: [{ lineId: 'l1', specId: 'spec-A', parentLineId: null }],
      scope: SCOPE,
    })

    expect(errors[0].sourceSpec).toBe('spec-A')
    expect(errors[0].targetSpec).toBe('spec-B')
  })
})

describe('DefaultCpqValidationService.getAttributeOptions', () => {
  let em: MockEm
  let service: DefaultCpqValidationService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqValidationService(em as unknown as never)
  })

  it('returns [] when the attribute is not found', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'port_speed',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([])
  })

  it('returns the attribute static options when no dynamic source is configured', async () => {
    em.findOne.mockResolvedValueOnce({
      code: 'port_speed',
      options: [
        { value: '1G', label: '1 Gbps' },
        { value: '10G', label: '10 Gbps' },
      ],
      constraints: null,
    })

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'port_speed',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([
      { value: '1G', label: '1 Gbps' },
      { value: '10G', label: '10 Gbps' },
    ])
  })

  it('returns [] for static options when attribute has neither options nor dynamic source', async () => {
    em.findOne.mockResolvedValueOnce({ code: 'x', options: null, constraints: null })

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'x',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([])
  })

  it('returns sorted distinct dimension values from a pricing table for dynamic options', async () => {
    em.findOne
      .mockResolvedValueOnce({
        code: 'datacenter',
        options: null,
        constraints: {
          dynamicOptionsSource: {
            type: 'pricingTable',
            tableCode: 'dc-pricing',
            dimensionKey: 'dc',
          },
        },
      })
      .mockResolvedValueOnce({ id: 'table-1' }) // pricing table found

    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'frankfurt' }, currencyCode: 'USD', prices: {} },
      { dimensionValues: { dc: 'amsterdam' }, currencyCode: 'USD', prices: {} },
      { dimensionValues: { dc: 'frankfurt' }, currencyCode: 'EUR', prices: {} },
    ])

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'datacenter',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([
      { value: 'amsterdam', label: 'amsterdam' },
      { value: 'frankfurt', label: 'frankfurt' },
    ])
  })

  it('filters dynamic options by another configuration value (filterByDimension with $-prefixed reference)', async () => {
    em.findOne
      .mockResolvedValueOnce({
        code: 'datacenter',
        options: null,
        constraints: {
          dynamicOptionsSource: {
            type: 'pricingTable',
            tableCode: 'dc-pricing',
            dimensionKey: 'dc',
            filterByDimension: { region: '$region' },
          },
        },
      })
      .mockResolvedValueOnce({ id: 'table-1' })

    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'frankfurt', region: 'eu' }, currencyCode: 'USD', prices: {} },
      { dimensionValues: { dc: 'amsterdam', region: 'eu' }, currencyCode: 'USD', prices: {} },
      { dimensionValues: { dc: 'reston', region: 'us' }, currencyCode: 'USD', prices: {} },
    ])

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'datacenter',
      currentConfiguration: { region: 'eu' },
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([
      { value: 'amsterdam', label: 'amsterdam' },
      { value: 'frankfurt', label: 'frankfurt' },
    ])
  })

  it('falls back to static options when the referenced pricing table is not found', async () => {
    em.findOne
      .mockResolvedValueOnce({
        code: 'datacenter',
        options: [{ value: 'fallback', label: 'Fallback' }],
        constraints: {
          dynamicOptionsSource: {
            type: 'pricingTable',
            tableCode: 'missing-table',
            dimensionKey: 'dc',
          },
        },
      })
      .mockResolvedValueOnce(null) // pricing table not found

    const result = await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'datacenter',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    expect(result).toEqual([{ value: 'fallback', label: 'Fallback' }])
  })

  it('uses specId in the lookup filter when provided', async () => {
    em.findOne.mockResolvedValueOnce({ code: 'x', options: [], constraints: null })

    await service.getAttributeOptions({
      specId: 'spec-1',
      attributeCode: 'x',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const [, where] = em.findOne.mock.calls[0]
    expect(where).toMatchObject({ specId: 'spec-1', code: 'x' })
    expect(where).not.toHaveProperty('productId')
  })

  it('uses productId when specId is not provided', async () => {
    em.findOne.mockResolvedValueOnce({ code: 'x', options: [], constraints: null })

    await service.getAttributeOptions({
      productId: 'product-1',
      attributeCode: 'x',
      currentConfiguration: {},
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })

    const [, where] = em.findOne.mock.calls[0]
    expect(where).toMatchObject({ productId: 'product-1', code: 'x' })
    expect(where).not.toHaveProperty('specId')
  })
})
