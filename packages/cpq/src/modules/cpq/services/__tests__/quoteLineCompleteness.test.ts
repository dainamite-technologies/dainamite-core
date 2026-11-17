/**
 * #125 — a valid line for an offering with no charges is configured; one
 * whose charges exist but none applies is incomplete with V-LINE-1. The
 * decision is made once, in recalculateInternal (lib/lineCompleteness.ts).
 */
import { DefaultCpqQuotingService } from '../cpqQuotingService'
import {
  CpqProductCharge,
  CpqProductOffering,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
} from '../../data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import type { TenantScope } from '../types'

const SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

type Row = Record<string, unknown>

function setup(opts: { lines: Row[]; offerings: Row[]; chargeDefinitions: Row[]; resolvedCharges?: unknown[]; quoteType?: string }) {
  const cpqConfig = {
    id: 'cpq-1', quoteId: 'sq-1', cpqStatus: 'new', customerId: 'cust', currencyCode: 'USD', version: 1,
    parentQuoteId: null, validationResult: null, pricingSummary: null, quoteContext: null, quoteType: opts.quoteType ?? 'new',
  }
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CpqQuoteConfiguration) return cpqConfig
      if (entity === SalesQuote) return { id: 'sq-1', currencyCode: 'USD', quoteNumber: 'Q-1' }
      if (entity === CpqProductOffering) return opts.offerings.find((o) => o.id === where.id) ?? null
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CpqQuoteLineConfiguration) return opts.lines
      if (entity === CpqProductCharge) return opts.chargeDefinitions
      return []
    }),
    flush: jest.fn(), persist: jest.fn(), assign: jest.fn(), fork: jest.fn(), transactional: jest.fn(),
  }
  const pricingService = { resolveProductCharges: jest.fn().mockResolvedValue(opts.resolvedCharges ?? []) }
  const validationService = {
    validateOfferingConfiguration: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    validateRelationships: jest.fn().mockResolvedValue([]),
    validateBundleSlots: jest.fn().mockResolvedValue([]),
  }
  const service = new DefaultCpqQuotingService({
    em: em as never,
    cpqPricingService: pricingService as never,
    cpqValidationService: validationService as never,
    cpqProductService: {} as never,
    salesDocumentNumberGenerator: {} as never,
  })
  return { service, em, validationService }
}

const line = (overrides: Row = {}): Row => ({
  id: 'lc-1', quoteLineId: 'line-1', quoteConfigurationId: 'cpq-1', offeringId: 'off-cpe', productId: null,
  specId: 'spec-cpe', action: 'add', parentLineId: null, configuration: { serial: 'X1' }, quantity: 1,
  charges: [], nrcTotal: '0', mrcTotal: '0', usageEstimates: null, termMonths: null, ...overrides,
})

describe('quote line completeness (#125)', () => {
  it('configures a valid line whose offering defines no charges (included equipment)', async () => {
    const { service } = setup({
      lines: [line()],
      offerings: [{ id: 'off-cpe', offeringType: 'simple', name: 'ONT', code: 'ONT' }],
      chargeDefinitions: [],
    })
    const result = await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(result.lines[0].isConfigured).toBe(true)
    expect(result.cpqStatus).toBe('ready')
    expect(result.validationResult.errors).toEqual([])
  })

  it('keeps a line incomplete with V-LINE-1 when charges exist but none applies', async () => {
    const { service } = setup({
      lines: [line()],
      offerings: [{ id: 'off-cpe', offeringType: 'simple', name: 'ONT', code: 'ONT' }],
      chargeDefinitions: [{ id: 'ch-1', offeringId: 'off-cpe', productId: null }],
    })
    const result = await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(result.lines[0].isConfigured).toBe(false)
    expect(result.cpqStatus).toBe('incomplete')
    expect(result.validationResult.errors).toEqual([
      expect.objectContaining({ lineId: 'line-1', message: expect.stringMatching(/^V-LINE-1:/) }),
    ])
  })

  it('does not query charge definitions when every line resolved charges', async () => {
    const { service, em } = setup({
      lines: [line()],
      offerings: [{ id: 'off-cpe', offeringType: 'simple', name: 'ONT', code: 'ONT' }],
      chargeDefinitions: [],
      resolvedCharges: [{ code: 'mrc', chargeType: 'mrc', unitPrice: 5, totalPrice: 5 }],
    })
    const result = await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(result.lines[0].isConfigured).toBe(true)
    expect(em.find.mock.calls.some(([entity]) => entity === CpqProductCharge)).toBe(false)
  })

  it('keeps a product-only line without charges incomplete (unchanged; only offerings can be free)', async () => {
    const { service } = setup({
      lines: [line({ offeringId: null, productId: 'prod-1' })],
      offerings: [],
      chargeDefinitions: [],
    })
    const result = await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(result.lines[0].isConfigured).toBe(false)
    expect(result.validationResult.errors[0].message).toMatch(/^V-LINE-1:/)
  })
})

describe('bundle slot validation scope (#124)', () => {
  const bundleOffering = { id: 'off-b', offeringType: 'bundle', name: 'Fiber Home', code: 'FH' }

  it('runs the slot rules when the quote has a bundle line', async () => {
    const { service, validationService } = setup({ lines: [line({ offeringId: 'off-b' })], offerings: [bundleOffering], chargeDefinitions: [] })
    await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(validationService.validateBundleSlots).toHaveBeenCalledTimes(1)
  })

  it('skips them on a Cancel quote: the whole subscription is being terminated', async () => {
    const { service, validationService } = setup({
      lines: [line({ offeringId: 'off-b', action: 'cancel', configuration: { _arcMirroredFromItemId: 'item-1' } })],
      offerings: [bundleOffering],
      chargeDefinitions: [],
      quoteType: 'cancel',
    })
    await service.recalculate('cpq-1', { save: false }, SCOPE)
    expect(validationService.validateBundleSlots).not.toHaveBeenCalled()
  })
})
