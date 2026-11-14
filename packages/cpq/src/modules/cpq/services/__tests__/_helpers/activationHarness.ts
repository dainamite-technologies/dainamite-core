import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import {
  CpqInventorySubscriptionItem,
  CpqOrderConfiguration,
  CpqOrderLineConfiguration,
  CpqOrderLineCost,
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
 * `harness.em` is the REQUEST EM: `activateOrder` must only fork it, so any
 * read / write on it throws. `harness.txEm` is the forked EM the activation runs
 * on; it answers `find` / `findOne` by entity class from fixed fixtures and
 * `transactional` simulates a DB transaction (writes become `committed` only
 * when the callback resolves; a throw rolls them back). The inventory service is
 * a mock bound through `withEntityManager`. Transaction boundaries, flushes and
 * inventory calls are appended to `trace` so a test can pin the ORDER of
 * persistence steps inside the transaction.
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
  /** Order line costs of the order (`CpqOrderLineCost` rows). */
  orderLineCosts?: Row[]
  /** What `createSubscriptionWithCosts` reports besides the subscription (default: nothing). */
  createdCosts?: { inventoryCostChanges?: unknown[]; inventoryCostLinks?: unknown[] }
  /** Inject a failure: `createSubscription` throws AFTER it wrote the subscription, items, costs and change log. */
  failInventory?: 'createSubscription'
  /** Inject a failure on the final order-status flush. */
  failFinalFlush?: boolean
  inventory?: Partial<Record<'createSubscription' | 'applyAmendment' | 'applyRenewal' | 'applyCancel' | 'applyMergeRenewal', unknown>>
}

export function createActivationHarness(fixture: ActivationFixture) {
  const trace: string[] = []
  const orderConfig: Row = {
    id: 'oc-1', orderId: 'so-1', cpqStatus: 'draft', customerId: 'cust-1', currencyCode: 'USD', sourceQuoteId: 'quote-1',
    pricingSummary: { nrcTotal: 0, mrcTotal: 0, currencyCode: 'USD' }, activatedAt: null, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  const salesOrder: Row = { id: 'so-1', status: 'draft', orderNumber: 'ORD-1', placedAt: null }
  const quote: Row = { id: 'quote-1', quoteType: fixture.quoteType, ...fixture.quoteOver }

  // Simulated database: `pending` is the open transaction, `committed` what survives.
  const store = { pending: [] as string[], committed: [] as string[], committedOrderStatus: 'draft' }
  const forbidden = (name: string) => jest.fn(() => { throw new Error(`request EM must not be used: ${name}`) })
  const em = {
    fork: jest.fn(),
    isInTransaction: jest.fn(() => false),
    find: forbidden('find'),
    findOne: forbidden('findOne'),
    persist: forbidden('persist'),
    create: forbidden('create'),
    flush: forbidden('flush'),
    getUnitOfWork: () => ({ getChangeSets: () => [] as unknown[], getIdentityMap: () => new Map() }),
  }
  const txEm = {
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      trace.push('tx:begin')
      store.pending = []
      try {
        const result = await callback(txEm)
        store.committed.push(...store.pending)
        store.committedOrderStatus = String(orderConfig.cpqStatus)
        trace.push('tx:commit')
        return result
      } catch (err) {
        store.pending = []
        orderConfig.cpqStatus = 'draft'
        trace.push('tx:rollback')
        throw err
      }
    }),
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, data: Row) => ({ ...data })),
    flush: jest.fn(async () => {
      trace.push(`flush[order=${String(orderConfig.cpqStatus)}]`)
      if (fixture.failFinalFlush && orderConfig.cpqStatus === 'active') throw new Error('final flush failed')
      if (orderConfig.cpqStatus === 'active') store.pending.push('order:active')
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
      if (entity === CpqOrderLineCost) return fixture.orderLineCosts ?? []
      return []
    }),
  }
  em.fork.mockReturnValue(txEm)

  const inventoryCall = (name: string, result: unknown, rows: string[] = []) =>
    jest.fn(async (..._args: unknown[]) => {
      trace.push(name)
      store.pending.push(...rows)
      if (name === 'createSubscription' && fixture.failInventory === 'createSubscription') throw new Error('createSubscription failed')
      return result
    })
  const inv = fixture.inventory ?? {}
  const createSubscription = inventoryCall('createSubscription', inv.createSubscription ?? { id: 'sub-1' }, ['subscription', 'item', 'itemCost', 'assetAndCosts', 'changeLog'])
  const inventory: Record<string, jest.Mock> = {
    withEntityManager: jest.fn((bound: unknown): unknown => {
      trace.push(bound === txEm ? 'inventory.withEntityManager(tx)' : 'inventory.withEntityManager(OTHER)')
      return inventory
    }),
    // `createSubscription` fixtures stay the bare subscription; the order service calls `createSubscriptionWithCosts`.
    createSubscriptionWithCosts: jest.fn(async (...args: unknown[]) => {
      const created = await createSubscription(...args)
      return { subscription: created, assets: [], inventoryCostChanges: [], inventoryCostLinks: [], ...fixture.createdCosts }
    }),
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
  return { service, em, txEm, inventory, trace, orderConfig, salesOrder, store }
}
