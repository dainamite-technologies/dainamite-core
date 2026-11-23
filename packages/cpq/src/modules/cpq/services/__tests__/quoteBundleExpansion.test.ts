/**
 * #123 — adding a bundle with `expandBundleDefaults` creates a child line per
 * default component (recursively), in one write; without the flag only the
 * bundle line is created, as before.
 */
jest.mock('../priceAdjustments/quotePricingWrite', () => ({
  withQuotePricingWrite: jest.fn(async (em: unknown, _id: string, _scope: unknown, execute: (tx: unknown, quote: unknown) => unknown) =>
    execute(em, (globalThis as Record<string, unknown>).__cpqTestQuote)),
}))

import { DefaultCpqQuotingService } from '../cpqQuotingService'
import { CpqProductAttribute, CpqProductOffering, CpqProductSpecification, CpqQuoteLineConfiguration } from '../../data/entities'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import type { BundleTreeNode } from '../cpqBundleService'
import type { TenantScope } from '../types'

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

type Row = Record<string, unknown>

const node = (id: string, overrides: Partial<BundleTreeNode> = {}): BundleTreeNode => ({
  offeringId: id, offeringCode: id, offeringName: id, offeringType: 'simple', isActive: true, lifecycleStatus: 'active', isSellable: true,
  specId: `spec-${id}`, specType: 'simple', isAssetizable: false, charges: [], slots: [], ...overrides,
})
const slot = (group: string, children: Array<[BundleTreeNode, boolean]>): BundleTreeNode['slots'][number] => ({
  slotId: `s-${group}`, componentGroup: group, name: group, cardinalityMin: 1, cardinalityMax: 1,
  components: children.map(([child, isDefault], i) => ({ componentId: `c-${child.offeringId}`, childOffering: child, isDefault, sortOrder: i })),
})

function setup(tree: BundleTreeNode, attributesBySpec: Record<string, Row[]> = {}, offeringOverrides: Record<string, Row> = {}) {
  const quote = { id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new', customerId: 'cust', currencyCode: 'USD', version: 1, quoteType: 'new', quoteContext: null }
  ;(globalThis as Record<string, unknown>).__cpqTestQuote = quote
  const offerings = new Map<string, Row>([
    ['bundle', { id: 'bundle', specId: 'spec-bundle', offeringType: 'bundle', name: 'Fiber Home', code: 'FH' }],
    ['fiber', { id: 'fiber', specId: 'spec-fiber', offeringType: 'simple', name: 'Fiber', code: 'F' }],
    ['ont', { id: 'ont', specId: 'spec-ont', offeringType: 'simple', name: 'ONT', code: 'O' }],
    ['tv', { id: 'tv', specId: 'spec-tv', offeringType: 'bundle', name: 'TV', code: 'TV' }],
    ['base', { id: 'base', specId: 'spec-base', offeringType: 'simple', name: 'Base', code: 'B' }],
  ])
  for (const [id, override] of Object.entries(offeringOverrides)) offerings.set(id, { ...offerings.get(id), ...override })
  const lineConfigs: Row[] = []
  const salesLines: Row[] = []
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-1' }
      if (entity === CpqProductOffering) return offerings.get(where.id as string) ?? null
      if (entity === CpqQuoteLineConfiguration) return lineConfigs.find((l) => l.quoteLineId === where.quoteLineId) ?? null
      if (entity === CpqProductSpecification) return { id: where.id, productId: null, name: 'spec' }
      if (entity === SalesQuoteLine) return salesLines.find((l) => l.id === where.id) ?? null
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteLineConfiguration) return lineConfigs
      if (entity === CpqProductAttribute) return attributesBySpec[where.specId as string] ?? []
      return []
    }),
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { id: data.id ?? `lc-${lineConfigs.length + 1}`, ...data }
      if (entity === CpqQuoteLineConfiguration) lineConfigs.push(row)
      if (entity === SalesQuoteLine) salesLines.push(row)
      return row
    }),
    persist: jest.fn(), flush: jest.fn(),
    assign: jest.fn((entity: Row, data: Row) => Object.assign(entity, data)),
  }
  const bundleService = { resolveBundleTree: jest.fn().mockResolvedValue(tree) }
  const service = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: { resolveProductCharges: jest.fn().mockResolvedValue([{ code: 'mrc', chargeType: 'mrc', unitPrice: 1, totalPrice: 1 }]) } as never,
    cpqValidationService: {
      validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      validateRelationships: jest.fn().mockResolvedValue([]),
      validateBundleSlots: jest.fn().mockResolvedValue([]),
    } as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
    cpqBundleService: bundleService as never,
  })
  return { service, lineConfigs, salesLines, bundleService }
}

const fiberHome = node('bundle', {
  offeringType: 'bundle',
  slots: [slot('access', [[node('fiber'), true]]), slot('cpe', [[node('ont'), true]])],
})

describe('addQuoteItem with expandBundleDefaults (#123)', () => {
  it('adds a child line under the bundle for each default component', async () => {
    const { service, lineConfigs, salesLines } = setup(fiberHome)
    await service.addQuoteItem('cpq-1', { offeringId: 'bundle', configuration: {}, expandBundleDefaults: true }, SCOPE)

    expect(lineConfigs.map((l) => l.offeringId)).toEqual(['bundle', 'fiber', 'ont'])
    const bundleLineId = lineConfigs[0].quoteLineId
    expect(lineConfigs.slice(1).every((l) => l.parentLineId === bundleLineId)).toBe(true)
    expect(salesLines.map((l) => l.lineNumber)).toEqual([1, 2, 3])
  })

  it('creates only the bundle line when the flag is omitted (unchanged behaviour)', async () => {
    const { service, lineConfigs, bundleService } = setup(fiberHome)
    await service.addQuoteItem('cpq-1', { offeringId: 'bundle', configuration: {} }, SCOPE)
    expect(lineConfigs.map((l) => l.offeringId)).toEqual(['bundle'])
    expect(bundleService.resolveBundleTree).not.toHaveBeenCalled()
  })

  it('expands a default component that is itself a bundle', async () => {
    const tree = node('bundle', {
      offeringType: 'bundle',
      slots: [slot('tv', [[node('tv', { offeringType: 'bundle', slots: [slot('base', [[node('base'), true]])] }), true]])],
    })
    const { service, lineConfigs } = setup(tree)
    await service.addQuoteItem('cpq-1', { offeringId: 'bundle', configuration: {}, expandBundleDefaults: true }, SCOPE)

    expect(lineConfigs.map((l) => l.offeringId)).toEqual(['bundle', 'tv', 'base'])
    expect(lineConfigs[2].parentLineId).toBe(lineConfigs[1].quoteLineId)
  })

  it('does not expand a non-bundle offering even with the flag', async () => {
    const { service, lineConfigs, bundleService } = setup(fiberHome)
    await service.addQuoteItem('cpq-1', { offeringId: 'fiber', configuration: {}, expandBundleDefaults: true }, SCOPE)
    expect(lineConfigs).toHaveLength(1)
    expect(bundleService.resolveBundleTree).not.toHaveBeenCalled()
  })

  it('gives default components the bundle term and the attribute values it can (inherited, else attribute default)', async () => {
    const { service, lineConfigs } = setup(fiberHome, {
      'spec-fiber': [
        { code: 'region', defaultValue: 'ams1' },
        { code: 'speed', defaultValue: '1G' },
        { code: 'serial', defaultValue: null },
      ],
    })
    await service.addQuoteItem('cpq-1', {
      offeringId: 'bundle', configuration: { region: 'fra1' }, termMonths: 24, startDate: '2026-12-01', expandBundleDefaults: true,
    }, SCOPE)

    const fiberLine = lineConfigs.find((l) => l.offeringId === 'fiber')!
    expect(fiberLine.configuration).toEqual({ region: 'fra1', speed: '1G' })
    expect(fiberLine.termMonths).toBe(24)
    expect(fiberLine.quantity).toBe(1)
  })
})

describe('addQuoteItem with a component-only offering (#133)', () => {
  const componentOnly = { ont: { isSellable: false } }

  it('rejects it as a top-level line with 422 V-QLINE-1 and creates no line', async () => {
    const { service, lineConfigs } = setup(fiberHome, {}, componentOnly)
    await expect(service.addQuoteItem('cpq-1', { offeringId: 'ont', configuration: {} }, SCOPE)).rejects.toMatchObject({
      status: 422,
      message: 'V-QLINE-1: Offering O can only be sold as part of a bundle',
      details: { code: 'V-QLINE-1', offeringId: 'ont' },
    })
    expect(lineConfigs).toHaveLength(0)
  })

  it('accepts it as a child line under a bundle line of the quote', async () => {
    const { service, lineConfigs } = setup(fiberHome, {}, componentOnly)
    await service.addQuoteItem('cpq-1', { offeringId: 'bundle', configuration: {} }, SCOPE)
    const bundleLineId = lineConfigs[0].quoteLineId as string
    await service.addQuoteItem('cpq-1', { offeringId: 'ont', configuration: {}, parentLineId: bundleLineId }, SCOPE)
    expect(lineConfigs.map((l) => [l.offeringId, l.parentLineId ?? null])).toEqual([['bundle', null], ['ont', bundleLineId]])
  })

  it('refuses a child line whose parent is not on the quote (404), so it cannot pose as a component', async () => {
    const { service, lineConfigs } = setup(fiberHome, {}, componentOnly)
    await expect(
      service.addQuoteItem('cpq-1', { offeringId: 'ont', configuration: {}, parentLineId: 'no-such-line' }, SCOPE),
    ).rejects.toMatchObject({ status: 404 })
    expect(lineConfigs).toHaveLength(0)
  })

  it('still adds it as a default component of the bundle', async () => {
    const { service, lineConfigs } = setup(fiberHome, {}, componentOnly)
    await service.addQuoteItem('cpq-1', { offeringId: 'bundle', configuration: {}, expandBundleDefaults: true }, SCOPE)
    expect(lineConfigs.map((l) => l.offeringId)).toEqual(['bundle', 'fiber', 'ont'])
  })

  it('blocks a top-level line that only claims to modify an item (the action is caller input)', async () => {
    const { service, lineConfigs } = setup(fiberHome, {}, componentOnly)
    await expect(
      service.addQuoteItem('cpq-1', { offeringId: 'ont', configuration: {}, action: 'modify' }, SCOPE),
    ).rejects.toMatchObject({ status: 422, details: { code: 'V-QLINE-1' } })
    expect(lineConfigs).toHaveLength(0)
  })
})
