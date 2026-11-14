import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqInventorySubscriptionItem,
  CpqOrderConfiguration,
  CpqOrderLineConfiguration,
  CpqProductSpecification,
  CpqQuoteConfiguration,
  CpqQuoteLineConfiguration,
  CpqQuoteTargetSubscription,
} from '../../../data/entities'
import { DefaultCpqOrderService } from '../../cpqOrderService'
import type { TenantScope } from '../../types'

/**
 * Harness for `DefaultCpqOrderService.activateOrder` characterization tests.
 *
 * The EM answers `find` / `findOne` by entity class from fixed fixtures; the
 * inventory service is a mock. Every `flush` and every inventory call is
 * appended to `trace` so a test can pin the ORDER of persistence steps on the
 * request EM (today's non-atomic activation boundary).
 */
type Row = Record<string, unknown>

export const ACTIVATION_SCOPE: TenantScope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

export interface ActivationFixture {
  quoteType: 'new' | 'amend' | 'renew' | 'cancel'
  orderLines?: Row[]
  specs?: Row[]
  subscriptionItems?: Row[]
  targets?: Row[]
  quoteLines?: Row[]
  quoteOver?: Row
  inventory?: Partial<Record<'createSubscription' | 'createAsset' | 'applyAmendment' | 'applyRenewal' | 'applyCancel' | 'applyMergeRenewal', unknown>>
}

export function createActivationHarness(fixture: ActivationFixture) {
  const trace: string[] = []
  const orderConfig: Row = {
    id: 'oc-1', orderId: 'so-1', cpqStatus: 'draft', customerId: 'cust-1', currencyCode: 'USD', sourceQuoteId: 'quote-1',
    pricingSummary: { nrcTotal: 0, mrcTotal: 0, currencyCode: 'USD' }, activatedAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  const salesOrder: Row = { id: 'so-1', status: 'draft', orderNumber: 'ORD-1', placedAt: null }
  const quote: Row = { id: 'quote-1', quoteType: fixture.quoteType, ...fixture.quoteOver }

  const em = {
    fork: jest.fn(),
    transactional: jest.fn(),
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    flush: jest.fn(async () => {
      trace.push(`flush[order=${String(orderConfig.cpqStatus)}]`)
    }),
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === CpqOrderConfiguration) return orderConfig
      if (entity === SalesOrder) return salesOrder
      if (entity === CpqQuoteConfiguration) return quote
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === CpqOrderLineConfiguration) return fixture.orderLines ?? []
      if (entity === CpqProductSpecification) return fixture.specs ?? []
      if (entity === CpqInventorySubscriptionItem) return fixture.subscriptionItems ?? []
      if (entity === CpqQuoteTargetSubscription) return fixture.targets ?? []
      if (entity === CpqQuoteLineConfiguration) return fixture.quoteLines ?? []
      return []
    }),
  }

  const inventoryCall = (name: string, result: unknown) =>
    jest.fn(async (..._args: unknown[]) => {
      trace.push(name)
      return result
    })
  const inv = fixture.inventory ?? {}
  const inventory = {
    createSubscription: inventoryCall('createSubscription', inv.createSubscription ?? { id: 'sub-1' }),
    createAsset: inventoryCall('createAsset', inv.createAsset ?? { id: 'asset-1' }),
    applyAmendment: inventoryCall('applyAmendment', inv.applyAmendment),
    applyRenewal: inventoryCall('applyRenewal', inv.applyRenewal),
    applyCancel: inventoryCall('applyCancel', inv.applyCancel),
    applyMergeRenewal: inventoryCall('applyMergeRenewal', inv.applyMergeRenewal),
  }

  const service = new DefaultCpqOrderService({
    em: em as unknown as never,
    cpqInventoryService: inventory as unknown as never,
    salesDocumentNumberGenerator: { generate: jest.fn() } as unknown as never,
  })
  return { service, em, inventory, trace, orderConfig, salesOrder }
}
