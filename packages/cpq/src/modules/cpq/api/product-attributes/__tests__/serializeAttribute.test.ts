import { serializeAttribute } from '../route'
import type { CpqProductAttribute } from '../../../data/entities'

/**
 * XD-292 regression: the create (POST) and update (PUT) responses used to omit
 * `resolutionTime` (and several other fields), so a freshly created design-time
 * attribute rendered as "run" in the spec detail table until a page refresh.
 * serializeAttribute is now the single source of truth for the API shape, so
 * these assertions guard every method that returns it.
 */
function makeAttribute(overrides: Partial<CpqProductAttribute> = {}): CpqProductAttribute {
  const now = new Date('2026-06-01T00:00:00.000Z')
  return {
    id: 'attr-1',
    productId: 'prod-1',
    specId: 'spec-1',
    code: 'platform-subscription-tier',
    name: 'Platform Subscription Tier',
    attributeType: 'select',
    resolutionTime: 'design_time',
    options: [{ value: 'a' }],
    constraints: null,
    referenceEntity: null,
    referenceFilter: null,
    dependsOn: { attributeCode: 'foo' },
    defaultValue: 'a',
    helpText: 'pick a tier',
    sortOrder: 0,
    isRequired: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CpqProductAttribute
}

describe('serializeAttribute', () => {
  it('includes resolutionTime so design-time attributes do not render as "run"', () => {
    const out = serializeAttribute(makeAttribute({ resolutionTime: 'design_time' }))
    expect(out.resolutionTime).toBe('design_time')
  })

  it('preserves run_time resolution', () => {
    const out = serializeAttribute(makeAttribute({ resolutionTime: 'run_time' }))
    expect(out.resolutionTime).toBe('run_time')
  })

  it('exposes every field the spec detail UI reads', () => {
    const out = serializeAttribute(makeAttribute())
    // The fields that were previously missing from POST/PUT responses.
    expect(out).toMatchObject({
      id: 'attr-1',
      specId: 'spec-1',
      resolutionTime: 'design_time',
      referenceEntity: null,
      referenceFilter: null,
      dependsOn: { attributeCode: 'foo' },
      defaultValue: 'a',
      helpText: 'pick a tier',
    })
  })
})
