import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
// TODO(L2-boundary): direct entity-class import couples the connector to
// billing's internal ORM shape — violates the dainamite-layering rule that
// cross-package coupling should be FK strings or REST. Tolerable at v0.1.x
// because reads are em-driven for performance (one round-trip vs serialise/
// deserialise via REST), but a `BillingAccount` / `BillingItem` rename in
// `@dainamite/billing` will manifest here as a silent runtime crash.
// Migrate to billing REST list endpoints once the connector graduates to
// stable v1 — track in the dainamite-cpq packaging plan.
import { BillingAccount, BillingItem } from '@dainamite/billing/modules/billing/data/entities'
import type { BillCycle } from '@dainamite/billing/modules/billing/lib/billCycle'

/**
 * Thin facade the connector uses to talk to billing.
 *
 * Reads (existence checks, lookups by subscription) go through the
 * EM directly — billing's REST list endpoints would work, but going
 * via the EM is one round-trip instead of a serialize-then-deserialize
 * loop. Writes go through the billing command bus exclusively, so
 * there is one and only one write path for every billing state
 * mutation (the same path the REST routes invoke).
 *
 * Auth context: subscribers run as a system identity, not as a user.
 * The command-bus `ctx` therefore carries `auth: null` and the
 * tenant/organization explicitly. `ensureTenantScope` /
 * `ensureOrganizationScope` are no-ops when `ctx.auth` is null
 * (verified against `@open-mercato/shared/lib/commands/scope`) so
 * the explicit fields in the payload are the authority.
 */

export type Scope = {
  tenantId: string
  organizationId: string
}

export type AccountSeed = {
  customerId: string
  /** 'company' (default when omitted) | 'person' — B2C accounts (billing Spec E). */
  customerKind?: 'company' | 'person'
  name: string
  currencyCode: string
  /** Bill cycle "every `billCycleInterval` `billCycle` on `billCycleDay`" (billing >= 0.23). */
  billCycle: BillCycle
  billCycleInterval: number
  /** '1'–'31' | 'mon'–'sun' | null (daily). */
  billCycleDay: string | null
  invoiceEmail: string
  invoiceLanguage: string
  invoiceAddress: Record<string, unknown>
  /** Omitted → billing starts the account on the first cycle day on or after today. */
  nextBillDate?: Date
  taxId?: string | null
}

export type ItemCreatePayload = {
  billAccountId: string
  type: 'one_time' | 'recurring' | 'usage'
  billStartDate: Date | string
  billEndDate?: Date | string | null
  description: string
  rateJson: Record<string, unknown>
  uomCode?: string
  subscriptionId?: string
  subscriptionItemId?: string
  sourceRef?: string
  /**
   * Billing Spec B: VAT % of the charge. CPQ charges carry no tax rate yet,
   * so the connector omits it and billing applies the organization default
   * at creation. Set it once CPQ exposes a per-charge rate.
   */
  taxRate?: number
  /** Contract C1: own billing period; omitted = follow the account cycle. */
  billingPeriodUnit?: 'daily' | 'weekly' | 'monthly' | 'annually' | null
  billingPeriodInterval?: number | null
  /** Contract C1: price phases, back to back from `billStartDate` (max 12). */
  phasesEnabled?: boolean
  phases?: Array<{
    name?: string | null
    durationUnit?: 'day' | 'week' | 'month' | 'year'
    durationCount?: number
    endDate?: string
    priceType: 'free' | 'fixed' | 'percent_off' | 'amount_off'
    value?: number | null
  }>
}

/** Generated credit reasons billing renders in the invoice language (billing Part 2, D10). */
export type CreditReasonCode = 'subscription_amended' | 'subscription_cancelled' | 'subscription_superseded'

export type CreditReasonParams = {
  /** e.g. the CPQ order number. */
  reference?: string
  /** YYYY-MM-DD the change took effect. */
  effectiveDate: string
}

export type ItemUpdatePayload = {
  id: string
  billEndDate?: Date | string | null
  subscriptionId?: string | null
  subscriptionItemId?: string | null
  isActive?: boolean
  /**
   * Why the end date credits already-billed days. Billing requires a reason
   * when the change produces a credit and ignores it otherwise, so the
   * connector sends it with every ARC end-date write.
   */
  creditReasonCode?: CreditReasonCode
  creditReasonParams?: CreditReasonParams
}

function buildSystemCtx(container: AwilixContainer, scope: Scope) {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

export class BillingApiClient {
  private readonly em: EntityManager
  private readonly commandBus: CommandBus

  constructor(private readonly container: AwilixContainer) {
    this.em = (container.resolve('em') as EntityManager).fork()
    this.commandBus = container.resolve('commandBus') as CommandBus
  }

  // ─── Accounts ───────────────────────────────────────────────────

  /**
   * Find a non-deleted Billing Account for `(tenant, organization,
   * customer)`. Returns the first match or `null`. Only a last-resort
   * fallback for ARC events whose subscription has no billing items yet;
   * activation uses `findCandidateAccounts` (currency + active aware).
   */
  async findAccountByCustomer(scope: Scope, customerId: string): Promise<BillingAccount | null> {
    return this.em.findOne(BillingAccount, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerId,
      deletedAt: null,
    })
  }

  /**
   * Accounts the connector may reuse for a CPQ order: same customer, same
   * currency, active, not deleted — newest first. Never reuse an account in
   * another currency or an inactive one (order billing setup spec, D4).
   */
  async findCandidateAccounts(
    scope: Scope,
    customerId: string,
    currencyCode: string,
  ): Promise<BillingAccount[]> {
    return this.em.find(
      BillingAccount,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        customerId,
        currencyCode: currencyCode.toUpperCase(),
        isActive: true,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'desc' } },
    )
  }

  async findAccountById(scope: Scope, id: string): Promise<BillingAccount | null> {
    return this.em.findOne(BillingAccount, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
  }

  async createAccount(scope: Scope, seed: AccountSeed): Promise<{ id: string }> {
    const result = await this.commandBus.execute('billing.accounts.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ...seed,
      },
      ctx: buildSystemCtx(this.container, scope),
    })
    return (result as { result?: { id: string } }).result ?? { id: '' }
  }

  // ─── Items ──────────────────────────────────────────────────────

  async findItemsBySubscription(scope: Scope, subscriptionId: string): Promise<BillingItem[]> {
    return this.em.find(BillingItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subscriptionId,
      deletedAt: null,
    } as never)
  }

  /** Items of several subscriptions in one query (empty input → no query). */
  async findItemsBySubscriptions(scope: Scope, subscriptionIds: string[]): Promise<BillingItem[]> {
    if (subscriptionIds.length === 0) return []
    return this.em.find(BillingItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subscriptionId: { $in: subscriptionIds },
      deletedAt: null,
    } as never)
  }

  async findItemsBySubscriptionItem(
    scope: Scope,
    subscriptionItemId: string,
  ): Promise<BillingItem[]> {
    return this.em.find(BillingItem, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subscriptionItemId,
      deletedAt: null,
    } as never)
  }

  async createItem(
    scope: Scope,
    payload: ItemCreatePayload,
  ): Promise<{ id: string; deduplicated: boolean }> {
    const result = await this.commandBus.execute('billing.items.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ...payload,
      },
      ctx: buildSystemCtx(this.container, scope),
    })
    const r = (result as { result?: { id: string; deduplicated: boolean } }).result
    return r ?? { id: '', deduplicated: false }
  }

  /**
   * Batch-create items in a single `billing.items.bulk_create`
   * command. Use this whenever a subscriber has more than one item
   * to create — it collapses N command-bus round-trips + N flushes
   * into one. Idempotent per `source_ref` exactly like `createItem`.
   *
   * No-ops on an empty payload so callers skip the length guard.
   */
  async bulkCreateItems(
    scope: Scope,
    items: ItemCreatePayload[],
  ): Promise<{
    created: number
    deduplicated: number
    items: Array<{ sourceRef: string | null; id: string; deduplicated: boolean }>
  }> {
    if (items.length === 0) {
      return { created: 0, deduplicated: 0, items: [] }
    }
    const result = await this.commandBus.execute('billing.items.bulk_create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        items,
      },
      ctx: buildSystemCtx(this.container, scope),
    })
    const r = (
      result as {
        result?: {
          created: number
          deduplicated: number
          items: Array<{ sourceRef: string | null; id: string; deduplicated: boolean }>
        }
      }
    ).result
    return r ?? { created: 0, deduplicated: 0, items: [] }
  }

  async updateItem(scope: Scope, payload: ItemUpdatePayload): Promise<{ id: string }> {
    const result = await this.commandBus.execute('billing.items.update', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ...payload,
      },
      ctx: buildSystemCtx(this.container, scope),
    })
    return (result as { result?: { id: string } }).result ?? { id: '' }
  }
}
