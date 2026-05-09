import { DefaultCpqProductService } from '../cpqProductService'

interface MockEm {
  findOne: jest.MockedFunction<(entity: unknown, where: Record<string, unknown>) => Promise<unknown>>
  find: jest.MockedFunction<
    (entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  >
}

function createMockEm(): MockEm {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
  }
}

const SCOPE = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

describe('DefaultCpqProductService.getSpecificationWithDetails', () => {
  let em: MockEm
  let service: DefaultCpqProductService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqProductService(em as unknown as never)
  })

  it('returns null when spec is not found', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.getSpecificationWithDetails({
      specId: 'missing',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })

    expect(result).toBeNull()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('loads spec + attributes + offerings + relationships when found', async () => {
    const spec = { id: 'spec-1', code: 'GIX', name: 'GIX Access' }
    em.findOne.mockResolvedValueOnce(spec)
    em.find
      .mockResolvedValueOnce([{ code: 'port_speed' }]) // attributes
      .mockResolvedValueOnce([{ code: 'offer-1' }]) // offerings
      .mockResolvedValueOnce([{ relationshipType: 'requires' }]) // outgoing
      .mockResolvedValueOnce([{ relationshipType: 'parent_child' }]) // incoming

    const result = await service.getSpecificationWithDetails({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })

    expect(result).toMatchObject({
      id: 'spec-1',
      code: 'GIX',
      attributes: [{ code: 'port_speed' }],
      offerings: [{ code: 'offer-1' }],
      relationships: {
        outgoing: [{ relationshipType: 'requires' }],
        incoming: [{ relationshipType: 'parent_child' }],
      },
    })
  })

  it('queries attributes ordered by sortOrder ASC', async () => {
    em.findOne.mockResolvedValueOnce({ id: 'spec-1' })
    em.find.mockResolvedValue([])

    await service.getSpecificationWithDetails({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })

    const [, , attrOptions] = em.find.mock.calls[0]
    expect(attrOptions).toMatchObject({ orderBy: { sortOrder: 'asc' } })
  })
})

describe('DefaultCpqProductService.getOfferingWithDetails', () => {
  let em: MockEm
  let service: DefaultCpqProductService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqProductService(em as unknown as never)
  })

  it('returns null when offering is not found', async () => {
    em.findOne.mockResolvedValueOnce(null)

    const result = await service.getOfferingWithDetails({
      offeringId: 'missing',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })

    expect(result).toBeNull()
  })

  it('loads spec and charges in parallel when offering exists', async () => {
    const offering = { id: 'o', specId: 'spec-1', code: 'OFFER-1' }
    em.findOne.mockResolvedValueOnce(offering) // offering lookup
    em.findOne.mockResolvedValueOnce({ id: 'spec-1', code: 'GIX' }) // spec lookup
    em.find.mockResolvedValueOnce([{ code: 'setup' }, { code: 'support' }]) // charges

    const result = await service.getOfferingWithDetails({
      offeringId: 'o',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
    })

    expect(result).toMatchObject({
      id: 'o',
      specification: { id: 'spec-1' },
      charges: [{ code: 'setup' }, { code: 'support' }],
    })
  })
})

describe('DefaultCpqProductService.getConstrainedAttributes', () => {
  let em: MockEm
  let service: DefaultCpqProductService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqProductService(em as unknown as never)
  })

  it('returns plain attributes when no offering and no dynamic options', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'port_speed',
        name: 'Port Speed',
        attributeType: 'enum',
        resolutionTime: 'run_time',
        isRequired: true,
        options: [
          { value: '1G', label: '1 Gbps' },
          { value: '10G', label: '10 Gbps' },
        ],
        constraints: null,
        defaultValue: null,
        helpText: null,
        dependsOn: null,
      },
    ])

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
    })

    expect(result).toEqual([
      {
        code: 'port_speed',
        name: 'Port Speed',
        attributeType: 'enum',
        resolutionTime: 'run_time',
        isRequired: true,
        options: [
          { value: '1G', label: '1 Gbps' },
          { value: '10G', label: '10 Gbps' },
        ],
        constraints: null,
        defaultValue: null,
        helpText: null,
        dependsOn: null,
      },
    ])
  })

  it('merges offering designTimeValues into evaluation context (currentConfig wins on conflict)', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'sub_speed',
        name: 'Sub Speed',
        attributeType: 'enum',
        resolutionTime: 'run_time',
        isRequired: true,
        options: [{ value: '10G', label: '10 Gbps' }, { value: '40G', label: '40 Gbps' }],
        constraints: null,
        dependsOn: {
          attributeCode: 'main_speed',
          effect: 'filter_options',
          rules: [{ when: { operator: 'eq', value: '10G' }, then: { options: ['10G'] } }],
        },
      },
    ])
    em.findOne.mockResolvedValueOnce({ designTimeValues: { main_speed: '10G' } })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
      offeringId: 'offer-1',
    })

    // Dependency rule fires using design-time main_speed=10G → only 10G is allowed
    expect(result[0].options).toEqual([{ value: '10G', label: '10 Gbps' }])
  })

  it('resolves dynamic options from a pricing table when configured', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'datacenter',
        name: 'Datacenter',
        attributeType: 'select',
        resolutionTime: 'run_time',
        isRequired: true,
        options: null,
        constraints: {
          dynamicOptionsSource: {
            type: 'pricing_table',
            tableCode: 'dc-pricing',
            dimensionKey: 'dc',
          },
        },
        dependsOn: null,
      },
    ])
    em.findOne.mockResolvedValueOnce({ id: 'pt-1' }) // pricing table
    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'frankfurt' } },
      { dimensionValues: { dc: 'amsterdam' } },
      { dimensionValues: { dc: 'frankfurt' } }, // duplicate to verify uniqueness
    ])

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
    })

    expect(result[0].options).toEqual([
      { value: 'amsterdam', label: 'amsterdam' },
      { value: 'frankfurt', label: 'frankfurt' },
    ])
  })

  it('filters dynamic options by $-referenced configuration value', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'datacenter',
        name: 'Datacenter',
        attributeType: 'select',
        resolutionTime: 'run_time',
        isRequired: true,
        options: null,
        constraints: {
          dynamicOptionsSource: {
            type: 'pricing_table',
            tableCode: 'dc-pricing',
            dimensionKey: 'dc',
            filterByDimension: { region: '$region' },
          },
        },
        dependsOn: null,
      },
    ])
    em.findOne.mockResolvedValueOnce({ id: 'pt-1' })
    em.find.mockResolvedValueOnce([
      { dimensionValues: { dc: 'frankfurt', region: 'eu' } },
      { dimensionValues: { dc: 'amsterdam', region: 'eu' } },
      { dimensionValues: { dc: 'reston', region: 'us' } },
    ])

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { region: 'eu' },
    })

    expect(result[0].options).toEqual([
      { value: 'amsterdam', label: 'amsterdam' },
      { value: 'frankfurt', label: 'frankfurt' },
    ])
  })

  it('returns [] options when dynamic source pricing table is missing', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'x',
        name: 'X',
        attributeType: 'select',
        resolutionTime: 'run_time',
        isRequired: false,
        options: null,
        constraints: {
          dynamicOptionsSource: { type: 'pricing_table', tableCode: 'missing', dimensionKey: 'x' },
        },
        dependsOn: null,
      },
    ])
    em.findOne.mockResolvedValueOnce(null) // pricing table not found

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
    })

    expect(result[0].options).toEqual([])
  })

  it('does NOT call dynamic options resolver when type is not "pricing_table"', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'x',
        name: 'X',
        attributeType: 'select',
        resolutionTime: 'run_time',
        isRequired: false,
        options: null,
        constraints: { dynamicOptionsSource: { type: 'unknown_source' } },
        dependsOn: null,
      },
    ])

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
    })

    expect(result[0].options).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled() // never tried to look up pricing table
  })
})

describe('DefaultCpqProductService.getConstrainedAttributes — dependency rules', () => {
  let em: MockEm
  let service: DefaultCpqProductService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqProductService(em as unknown as never)
  })

  function setupAttributeWithDependency(dependsOn: Record<string, unknown>) {
    em.find.mockResolvedValueOnce([
      {
        code: 'sub_speed',
        name: 'Sub Speed',
        attributeType: 'enum',
        resolutionTime: 'run_time',
        isRequired: true,
        options: [
          { value: '1G', label: '1 Gbps' },
          { value: '10G', label: '10 Gbps' },
          { value: '40G', label: '40 Gbps' },
        ],
        constraints: null,
        dependsOn,
      },
    ])
  }

  it('does not filter when parent value is missing', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'eq', value: '10G' }, then: { options: ['10G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: {},
    })

    // No parent value → original options preserved
    expect(result[0].options).toHaveLength(3)
  })

  it('filters by eq match', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'eq', value: '10G' }, then: { options: ['10G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: '10G' },
    })

    expect(result[0].options).toEqual([{ value: '10G', label: '10 Gbps' }])
  })

  it('filters by neq match', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'neq', value: '40G' }, then: { options: ['1G', '10G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: '10G' }, // 10G !== 40G → rule fires
    })

    expect(result[0].options?.map((o) => o.value)).toEqual(['1G', '10G'])
  })

  it('filters by in operator', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'in', value: ['10G', '40G'] }, then: { options: ['10G', '40G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: '10G' },
    })

    expect(result[0].options?.map((o) => o.value)).toEqual(['10G', '40G'])
  })

  it('filters by not_in operator', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'not_in', value: ['1G'] }, then: { options: ['10G', '40G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: '10G' }, // 10G is NOT in ['1G'] → rule fires
    })

    expect(result[0].options?.map((o) => o.value)).toEqual(['10G', '40G'])
  })

  it('matches "any" operator regardless of parent value', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'filter_options',
      rules: [{ when: { operator: 'any' }, then: { options: ['1G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: 'whatever' },
    })

    expect(result[0].options?.map((o) => o.value)).toEqual(['1G'])
  })

  it('does not apply rules when effect is not "filter_options"', async () => {
    setupAttributeWithDependency({
      attributeCode: 'main_speed',
      effect: 'other_effect',
      rules: [{ when: { operator: 'eq', value: '10G' }, then: { options: ['10G'] } }],
    })

    const result = await service.getConstrainedAttributes({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      currentConfig: { main_speed: '10G' },
    })

    expect(result[0].options).toHaveLength(3) // untouched
  })
})

describe('DefaultCpqProductService.validateDesignTimeValues', () => {
  let em: MockEm
  let service: DefaultCpqProductService

  beforeEach(() => {
    em = createMockEm()
    service = new DefaultCpqProductService(em as unknown as never)
  })

  it('queries only design_time attributes', async () => {
    em.find.mockResolvedValueOnce([])

    await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: {},
    })

    const [, where] = em.find.mock.calls[0]
    expect(where).toMatchObject({
      specId: 'spec-1',
      resolutionTime: 'design_time',
    })
  })

  it('passes when all required design-time values are provided', async () => {
    em.find.mockResolvedValueOnce([
      { code: 'region', name: 'Region', isRequired: true, options: null },
    ])

    const result = await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: { region: 'eu' },
    })

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('flags missing required value', async () => {
    em.find.mockResolvedValueOnce([
      { code: 'region', name: 'Region', isRequired: true, options: null },
    ])

    const result = await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: {},
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([{ attribute: 'region', message: 'Region is required' }])
  })

  it('flags empty string as missing', async () => {
    em.find.mockResolvedValueOnce([
      { code: 'region', name: 'Region', isRequired: true, options: null },
    ])

    const result = await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: { region: '' },
    })

    expect(result.valid).toBe(false)
  })

  it('flags value not in allowed options', async () => {
    em.find.mockResolvedValueOnce([
      {
        code: 'region',
        name: 'Region',
        isRequired: true,
        options: [
          { value: 'eu', label: 'Europe' },
          { value: 'us', label: 'United States' },
        ],
      },
    ])

    const result = await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: { region: 'apac' },
    })

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toMatch(/must be one of: eu, us/)
  })

  it('skips optional attributes with no value', async () => {
    em.find.mockResolvedValueOnce([
      { code: 'region', name: 'Region', isRequired: false, options: null },
    ])

    const result = await service.validateDesignTimeValues({
      specId: 'spec-1',
      organizationId: SCOPE.organizationId,
      tenantId: SCOPE.tenantId,
      values: {},
    })

    expect(result.valid).toBe(true)
  })
})
