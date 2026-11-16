import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { CpqBillingOrderSetup } from '../data/entities'
import type { AccountOverrides, OrderSetupUpsertBody } from '../data/validators'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  isArcQuoteType,
  isUsableAccount,
  normalizeInvoiceAddress,
  resolveInvoiceLanguage,
  toIsoDate,
  type BillCycle,
  type BillStartSetup,
  type BillingInvoiceAddress,
} from '../lib/orderSetupResolution'
import {
  computeEarliestActivation,
  isActivationConstrained,
  type EarliestActivation,
} from '../lib/earliestActivation'

/**
 * The slice of `@dainamite/cpq`'s `cpqOrderService` the connector reads.
 * Declared structurally so the connector depends on CPQ's public behaviour,
 * not on its internal result types.
 */
export type CpqOrderReader = {
  getOrder(
    orderId: string,
    scope: Scope,
  ): Promise<{
    id: string
    /** Sales order number (e.g. `SO-1234`). */
    orderNumber?: string
    customerId: string
    cpqStatus: string
    currencyCode: string
    quoteType: string
    /** `CpqQuoteConfiguration.id` of the source quote — the key of its ARC targets. */
    sourceQuoteId?: string | null
    lines: Array<{
      lineId: string
      offeringName: string
      /** 'add' | 'modify' | 'cancel' — only ARC orders carry anything but 'add'. */
      action: string
      parentLineId: string | null
      startDate: string | null
      nrcTotal: number
      mrcTotal: number
    }>
  }>
  getOrderCustomerFields(
    orderId: string,
    scope: Scope,
  ): Promise<{
    customerName?: string
    customerKind?: 'company' | 'person'
    invoiceEmail?: string
    invoiceAddress?: Record<string, unknown>
  }>
}

/**
 * The slice of `@dainamite/cpq`'s `cpqQuotingService` the connector reads:
 * the ARC target subscriptions of a quote (`cpq_quote_target_subscriptions`).
 */
export type CpqQuoteTargetReader = {
  listTargetSubscriptions(
    quoteId: string,
    scope: Scope,
  ): Promise<Array<{ subscriptionId: string; quoteType: string }>>
}

/** The earliest-activation part of the order-setup read model (Part 2, 6c). */
export type EarliestActivationView = {
  /** YYYY-MM-DD, or null when activation is not constrained. */
  earliestActivationDate: string | null
  earliestActivationReason: { subscriptionId: string; itemDescription: string } | null
}

export function toEarliestActivationView(earliest: EarliestActivation | null): EarliestActivationView {
  return earliest
    ? {
        earliestActivationDate: earliest.date,
        earliestActivationReason: { subscriptionId: earliest.subscriptionId, itemDescription: earliest.itemDescription },
      }
    : { earliestActivationDate: null, earliestActivationReason: null }
}

export class OrderSetupError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message)
    this.name = 'OrderSetupError'
  }
}

/**
 * A concurrent writer created the order's setup row first (unique index on
 * organization + tenant + order). Constructor-name fallback survives class
 * duplication across bundles.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof UniqueConstraintViolationException ||
    (err as { constructor?: { name?: string } } | null)?.constructor?.name === 'UniqueConstraintViolationException'
  )
}

/**
 * Run a find-or-create write; if it loses a create race, run it once more on
 * a fresh fork — the retry finds the winner's row and updates it instead.
 */
async function retryOnCreateRace<T>(write: (em: EntityManager) => Promise<T>, fork: () => EntityManager): Promise<T> {
  try {
    return await write(fork())
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    return write(fork())
  }
}

export function isOrderSetupError(err: unknown): err is OrderSetupError {
  return err instanceof OrderSetupError || (err as { name?: string } | null)?.name === 'OrderSetupError'
}

/** Serialized setup row — the API shape and the undo snapshot. */
export type OrderSetupSnapshot = {
  id: string
  orderId: string
  customerId: string
  currencyCode: string
  accountMode: 'existing' | 'new'
  billingAccountId: string | null
  accountOverrides: AccountOverrides
  defaultBillStartDate: string | null
  lineBillStarts: Record<string, string>
  appliedAt: string | null
  appliedBillingAccountId: string | null
  createdAt: string
  updatedAt: string
}

export type OrderSetupView = EarliestActivationView & {
  orderId: string
  orderStatus: string
  quoteType: string
  editable: boolean
  setup: OrderSetupSnapshot | null
  defaults: {
    /**
     * New-account values from the customer (sales order snapshot). A field
     * that is absent here would fall back to a placeholder at activation.
     */
    account: {
      name: string | null
      customerKind: 'company' | 'person' | null
      invoiceEmail: string | null
      invoiceLanguage: string
      invoiceAddress: Partial<BillingInvoiceAddress> | null
      /** Default bill cycle of a new account: every 1 month on day 1. */
      billCycle: BillCycle
      billCycleInterval: number
      billCycleDay: string | null
    }
    lines: Array<{
      lineId: string
      name: string
      parentLineId: string | null
      serviceStartDate: string | null
    }>
  }
}

const EDITABLE_ORDER_STATUSES = new Set(['draft', 'pending_activation'])

/**
 * Quote types whose orders create billing items, and so take a billing setup:
 *   - `new`             → account choice + bill start per line
 *   - `amend` / `renew` → bill start of the ADDED lines only (D7); their
 *                         account is the subscription's existing one
 * `cancel` adds nothing to bill.
 */
const SETUP_QUOTE_TYPES = new Set(['new', 'amend', 'renew'])

type OrderLine = Awaited<ReturnType<CpqOrderReader['getOrder']>>['lines'][number]

/**
 * Lines that get a billing item, so a bill start: billable (zero-value lines
 * create no item) and, on an ARC order, added by it — modified and cancelled
 * lines keep their existing billing items.
 */
function billableLines(quoteType: string, lines: OrderLine[]): OrderLine[] {
  return lines.filter(
    (line) =>
      (Number(line.mrcTotal) > 0 || Number(line.nrcTotal) > 0) &&
      (!isArcQuoteType(quoteType) || line.action === 'add'),
  )
}

export function serializeOrderSetup(row: CpqBillingOrderSetup): OrderSetupSnapshot {
  return {
    id: row.id,
    orderId: row.cpqOrderId,
    customerId: row.customerId,
    currencyCode: row.currencyCode,
    accountMode: row.accountMode,
    billingAccountId: row.billingAccountId ?? null,
    accountOverrides: (row.accountOverrides ?? {}) as AccountOverrides,
    defaultBillStartDate: toIsoDate(row.defaultBillStartDate),
    lineBillStarts: { ...(row.lineBillStarts ?? {}) },
    appliedAt: row.appliedAt ? new Date(row.appliedAt).toISOString() : null,
    appliedBillingAccountId: row.appliedBillingAccountId ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

/** Address fields the customer actually has, in billing's keys (no placeholders). */
function partialBillingAddress(raw: Record<string, unknown> | undefined): Partial<BillingInvoiceAddress> | null {
  if (!raw) return null
  const full = normalizeInvoiceAddress(raw)
  const placeholder = normalizeInvoiceAddress(undefined)
  const partial: Partial<BillingInvoiceAddress> = {}
  for (const key of ['line1', 'line2', 'city', 'postal_code', 'country'] as const) {
    const value = full[key]
    if (value && value !== placeholder[key]) partial[key] = value
  }
  return Object.keys(partial).length > 0 ? partial : null
}

/**
 * Order billing setup (spec `2026-11-15-cpq-billing-connector-order-billing-setup`).
 *
 * Reads CPQ through `cpqOrderService` (DI) and billing through
 * `BillingApiClient`; writes only the connector's own table. Each method
 * works on a fresh fork, so a caller's identity map is never touched.
 */
export class CpqBillingOrderSetupService {
  constructor(private readonly deps: { em: EntityManager; container: AwilixContainer }) {}

  private fork(): EntityManager {
    return this.deps.em.fork()
  }

  private cpqOrders(): CpqOrderReader {
    return this.deps.container.resolve('cpqOrderService') as CpqOrderReader
  }

  private cpqQuotes(): CpqQuoteTargetReader {
    return this.deps.container.resolve('cpqQuotingService') as CpqQuoteTargetReader
  }

  private billing(): BillingApiClient {
    return new BillingApiClient(this.deps.container)
  }

  private async loadOrder(scope: Scope, orderId: string) {
    try {
      return await this.cpqOrders().getOrder(orderId, scope)
    } catch (err) {
      if ((err as { status?: number } | null)?.status === 404) {
        throw new OrderSetupError(404, 'CPQ order not found')
      }
      throw err
    }
  }

  async findSetup(scope: Scope, orderId: string, em: EntityManager = this.fork()): Promise<CpqBillingOrderSetup | null> {
    return em.findOne(CpqBillingOrderSetup, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cpqOrderId: orderId,
      deletedAt: null,
    })
  }

  /**
   * Earliest activation date of an ARC `amend` / `cancel` order: the latest
   * bill start among its target subscriptions' billing items (Part 2, 6c).
   * Two bounded reads — the quote's targets (CPQ), then their items
   * (billing) — and none for other quote types.
   */
  async resolveEarliestActivation(
    scope: Scope,
    order: { quoteType: string; sourceQuoteId?: string | null },
  ): Promise<EarliestActivation | null> {
    if (!isActivationConstrained(order.quoteType) || !order.sourceQuoteId) return null
    const targets = await this.cpqQuotes().listTargetSubscriptions(order.sourceQuoteId, scope)
    const subscriptionIds = [...new Set(targets.map((target) => target.subscriptionId).filter(Boolean))]
    const items = await this.billing().findItemsBySubscriptions(scope, subscriptionIds)
    return computeEarliestActivation(order.quoteType, items)
  }

  /** `resolveEarliestActivation` by order id (the activation guard's entry point). */
  async resolveEarliestActivationForOrder(scope: Scope, orderId: string): Promise<EarliestActivation | null> {
    const order = await this.loadOrder(scope, orderId)
    return this.resolveEarliestActivation(scope, order)
  }

  async getView(scope: Scope, orderId: string): Promise<OrderSetupView> {
    const order = await this.loadOrder(scope, orderId)
    type CustomerFields = Awaited<ReturnType<CpqOrderReader['getOrderCustomerFields']>>
    const reader = this.cpqOrders()
    // Customer fields are prefill only: an older CPQ without the method, or a
    // failed read, leaves the new-account fields blank instead of failing.
    const customerFields: Promise<CustomerFields> =
      typeof reader.getOrderCustomerFields === 'function'
        ? reader.getOrderCustomerFields(orderId, scope).catch(() => ({}))
        : Promise.resolve({})
    const [setup, customer, earliest] = await Promise.all([
      this.findSetup(scope, orderId),
      customerFields,
      // A hint only: a failed read hides the callout instead of the whole tab
      // (the activation guard computes the rule again and enforces it).
      this.resolveEarliestActivation(scope, order).catch((err) => {
        console.warn('[cpq_billing_connector] earliest activation date unavailable', err)
        return null
      }),
    ])
    return {
      ...toEarliestActivationView(earliest),
      orderId: order.id,
      orderStatus: order.cpqStatus,
      quoteType: order.quoteType,
      editable:
        EDITABLE_ORDER_STATUSES.has(order.cpqStatus) && !setup?.appliedAt && SETUP_QUOTE_TYPES.has(order.quoteType),
      setup: setup ? serializeOrderSetup(setup) : null,
      defaults: {
        account: {
          name: customer.customerName ?? null,
          customerKind: customer.customerKind ?? null,
          invoiceEmail: customer.invoiceEmail ?? null,
          invoiceLanguage: resolveInvoiceLanguage(undefined),
          invoiceAddress: partialBillingAddress(customer.invoiceAddress),
          billCycle: 'monthly',
          billCycleInterval: 1,
          billCycleDay: '1',
        },
        lines: billableLines(order.quoteType, order.lines).map((line) => ({
            lineId: line.lineId,
            name: line.offeringName,
            parentLineId: line.parentLineId,
            serviceStartDate: toIsoDate(line.startDate),
          })),
      },
    }
  }

  /**
   * Upsert the setup of one order (PUT = full replacement of the setup).
   * Returns the before / after snapshots for the command's undo log.
   */
  async save(
    scope: Scope,
    orderId: string,
    body: OrderSetupUpsertBody,
  ): Promise<{ before: OrderSetupSnapshot | null; after: OrderSetupSnapshot }> {
    const order = await this.loadOrder(scope, orderId)
    if (!SETUP_QUOTE_TYPES.has(order.quoteType)) {
      throw new OrderSetupError(409, `A '${order.quoteType}' order has nothing to bill`)
    }
    if (!EDITABLE_ORDER_STATUSES.has(order.cpqStatus)) {
      throw new OrderSetupError(409, `Billing setup cannot change once the order is '${order.cpqStatus}'`)
    }
    const arc = isArcQuoteType(order.quoteType)
    if (!arc && !body.accountMode) {
      throw new OrderSetupError(422, 'accountMode is required for a new-sale order')
    }
    // ARC orders: the account is the subscription's — account fields are ignored (D7).
    const accountMode = arc ? 'existing' : (body.accountMode as 'existing' | 'new')

    if (!arc && accountMode === 'existing') {
      const account = await this.billing().findAccountById(scope, body.billingAccountId as string)
      if (!isUsableAccount(account, { customerId: order.customerId, currencyCode: order.currencyCode })) {
        throw new OrderSetupError(
          422,
          "The billing account must be an active account of this order's customer in the order's currency",
        )
      }
    }

    const lineIds = new Set(billableLines(order.quoteType, order.lines).map((line) => line.lineId))
    const unknownLines = Object.keys(body.lineBillStarts ?? {}).filter((id) => !lineIds.has(id))
    if (unknownLines.length > 0) {
      throw new OrderSetupError(422, `Lines that get no billing item on this order: ${unknownLines.join(', ')}`)
    }

    // PUT replaces the whole setup, so a concurrent save that created the row
    // first is simply overwritten (last writer wins) instead of surfacing a 500.
    return retryOnCreateRace(async (em) => {
      const existing = await this.findSetup(scope, orderId, em)
      if (existing?.appliedAt) {
        throw new OrderSetupError(409, 'Billing setup was already applied at activation')
      }
      const before = existing ? serializeOrderSetup(existing) : null
      const row =
        existing ??
        em.create(CpqBillingOrderSetup, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          cpqOrderId: orderId,
          customerId: order.customerId,
          currencyCode: order.currencyCode.toUpperCase(),
          accountMode,
        })
      row.accountMode = accountMode
      row.billingAccountId = !arc && accountMode === 'existing' ? (body.billingAccountId ?? null) : null
      row.accountOverrides = !arc && accountMode === 'new' ? { ...(body.accountOverrides ?? {}) } : {}
      row.defaultBillStartDate = body.defaultBillStartDate ?? null
      row.lineBillStarts = { ...(body.lineBillStarts ?? {}) }
      row.updatedAt = new Date()
      if (!existing) em.persist(row)
      await em.flush()
      return { before, after: serializeOrderSetup(row) }
    }, () => this.fork())
  }

  /** Undo of `save`: put the row back as it was (or remove the row `save` created). */
  async restore(scope: Scope, before: OrderSetupSnapshot | null, after: OrderSetupSnapshot): Promise<void> {
    const em = this.fork()
    const row = await em.findOne(CpqBillingOrderSetup, {
      id: after.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!row) return
    if (row.appliedAt) {
      throw new OrderSetupError(409, 'Billing setup was already applied at activation and cannot be undone')
    }
    if (!before) {
      row.deletedAt = new Date()
    } else {
      row.accountMode = before.accountMode
      row.billingAccountId = before.billingAccountId
      row.accountOverrides = { ...before.accountOverrides }
      row.defaultBillStartDate = before.defaultBillStartDate
      row.lineBillStarts = { ...before.lineBillStarts }
    }
    row.updatedAt = new Date()
    await em.flush()
  }

  /**
   * Record the account the activation subscriber used. Creates the row when
   * the operator never saved a setup, so a re-fired event reuses the same
   * account instead of creating another one.
   */
  async markApplied(
    scope: Scope,
    input: { orderId: string; customerId: string; currencyCode: string; billingAccountId: string; accountMode: 'existing' | 'new' },
  ): Promise<void> {
    // Two events for one order (an ARC order touching several subscriptions)
    // can race to create the row; the loser retries and updates it.
    await retryOnCreateRace(async (em) => {
      const existing = await this.findSetup(scope, input.orderId, em)
      const row =
        existing ??
        em.create(CpqBillingOrderSetup, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          cpqOrderId: input.orderId,
          customerId: input.customerId,
          currencyCode: input.currencyCode.toUpperCase(),
          accountMode: input.accountMode,
        })
      // Keep the first application time: it is what locks the setup.
      row.appliedAt = row.appliedAt ?? new Date()
      row.appliedBillingAccountId = input.billingAccountId
      row.updatedAt = new Date()
      if (!existing) em.persist(row)
      await em.flush()
    }, () => this.fork())
  }
}

/** The bill-start part of a setup row, as `resolveLineBillStart` reads it. */
export function billStartSetupOf(row: CpqBillingOrderSetup | null): BillStartSetup | null {
  if (!row) return null
  return {
    defaultBillStartDate: toIsoDate(row.defaultBillStartDate),
    lineBillStarts: { ...(row.lineBillStarts ?? {}) },
  }
}
