import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope, type AccountSeed } from '../lib/billingApiClient'
import { mapSubscriptionItemsToBillingItems } from '../lib/chargeMapper'
import type { CpqSubscriptionItem } from '../lib/chargeMapper'
import {
  buildAccountSeedValues,
  earliestIsoDate,
  isUsableAccount,
  pickDefaultAccount,
  resolveLineBillStart,
  todayIsoDate,
  toIsoDate,
  type BillCycle,
} from '../lib/orderSetupResolution'
import type { AccountOverrides } from '../data/validators'
import type { CpqBillingOrderSetupService } from '../services/orderSetupService'

/**
 * Subscriber: `cpq.subscription.activated` → billing onboarding.
 *
 * `@dainamite/cpq` emits this event when a new-sale order is activated
 * (`cpqOrderService.activateOrder`).
 *
 * Behaviour when fired (spec `2026-11-15-cpq-billing-connector-order-billing-setup`):
 *   1. Resolve the Billing Account:
 *      - the account a previous run of this event already used (idempotent
 *        re-fire), else
 *      - the operator's choice in the order billing setup (`existing` →
 *        that account if still usable; `new` → create with the operator's
 *        overrides), else
 *      - the newest active account of the customer in the order's currency,
 *        else create one. A new account's fields come from operator override
 *        → customer data on the event (sales order snapshot) → placeholder.
 *   2. Record the account on the setup row (`applied_at`) before creating
 *      items, so a retry after a partial failure reuses it.
 *   3. Create one Billing Item per charge. Bill start per line: operator
 *      override → CPQ service start → the order's default bill start →
 *      activation date. `source_ref` is the deterministic
 *      `cpq-<subId>-<subItemId>-<chargeType>` key, so a re-fired event hits
 *      billing's idempotency guard instead of duplicating items.
 *
 * Errors propagate to the persistent queue worker, which retries
 * per the OM queue contract.
 */

export const metadata = {
  event: 'cpq.subscription.activated',
  persistent: true,
  id: 'cpq-billing-connector:subscription-activated',
}

export type ActivatedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  /** 'company' | 'person'. Omitted → billing defaults to 'company'. */
  customerKind?: 'company' | 'person'
  currencyCode: string
  /** CPQ order id (`CpqOrderConfiguration.id`) — the key of the order billing setup. */
  sourceOrderId?: string
  /** Optional customer fields (CPQ: sales order snapshot) — used when present, otherwise placeholders. */
  customerName?: string
  invoiceEmail?: string
  invoiceLanguage?: string
  invoiceAddress?: Record<string, unknown>
  billCycle?: BillCycle
  billCycleAnchor?: string
  nextBillDate?: string
  taxId?: string | null
  items: CpqSubscriptionItem[]
  /** Activation date (`YYYY-MM-DD`) — the last fallback of every item's bill start. */
  activationDate?: string
}

/** The order billing setup fields the subscriber reads. */
export type AppliedSetup = {
  accountMode: 'existing' | 'new'
  billingAccountId?: string | null
  accountOverrides?: AccountOverrides | null
  defaultBillStartDate?: string | null
  lineBillStarts?: Record<string, string> | null
  appliedBillingAccountId?: string | null
}

export function buildAccountSeed(
  payload: ActivatedPayload,
  options: { overrides?: AccountOverrides | null; earliestBillStart?: string | null } = {},
): AccountSeed {
  const values = buildAccountSeedValues({
    defaults: payload,
    currencyCode: payload.currencyCode,
    overrides: options.overrides,
    earliestBillStart: options.earliestBillStart,
    activationDate: payload.activationDate,
  })
  return { ...values, nextBillDate: new Date(values.nextBillDate) }
}

export function itemBillStart(
  item: CpqSubscriptionItem,
  setup: AppliedSetup | null,
  activationDate: string,
): string {
  return resolveLineBillStart({
    orderLineId: item.orderLineId,
    serviceStartDate: item.startDate,
    setup,
    activationDate,
  })
}

type AccountPort = Pick<BillingApiClient, 'findAccountById' | 'findCandidateAccounts' | 'createAccount'>

/** Step 1 of the handler. Exported for tests; `billing` is a port so it can be faked. */
export async function resolveBillingAccount(params: {
  billing: AccountPort
  scope: Scope
  payload: ActivatedPayload
  setup: AppliedSetup | null
  earliestBillStart: string | null
}): Promise<{ id: string; accountMode: 'existing' | 'new' }> {
  const { billing, scope, payload, setup, earliestBillStart } = params
  const target = { customerId: payload.customerId, currencyCode: payload.currencyCode }

  // Re-fired event: reuse what the first run created or picked.
  if (setup?.appliedBillingAccountId) {
    const applied = await billing.findAccountById(scope, setup.appliedBillingAccountId)
    if (applied) return { id: applied.id, accountMode: setup.accountMode }
  }

  if (setup?.accountMode === 'existing' && setup.billingAccountId) {
    const chosen = await billing.findAccountById(scope, setup.billingAccountId)
    if (isUsableAccount(chosen, target)) return { id: chosen.id, accountMode: 'existing' }
    console.warn(
      '[cpq-billing-connector] chosen billing account is no longer usable; falling back to defaults',
      { orderId: payload.sourceOrderId, billingAccountId: setup.billingAccountId },
    )
  }

  const create = async (overrides: AccountOverrides | null) => {
    const created = await billing.createAccount(scope, buildAccountSeed(payload, { overrides, earliestBillStart }))
    if (!created.id) throw new Error('[cpq-billing-connector] billing.accounts.create returned no id')
    return { id: created.id, accountMode: 'new' as const }
  }

  if (setup?.accountMode === 'new') return create(setup.accountOverrides ?? null)

  const candidates = await billing.findCandidateAccounts(scope, payload.customerId, payload.currencyCode)
  const reuse = pickDefaultAccount(candidates, target)
  if (reuse) return { id: reuse.id, accountMode: 'existing' }
  return create(null)
}

export default async function handle(payload: ActivatedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId || !payload.customerId) {
    return
  }
  if (!payload.subscriptionId || !Array.isArray(payload.items) || payload.items.length === 0) {
    return
  }

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const setupService = container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const setupRow = payload.sourceOrderId ? await setupService.findSetup(scope, payload.sourceOrderId) : null
  const setup: AppliedSetup | null = setupRow
    ? {
        accountMode: setupRow.accountMode,
        billingAccountId: setupRow.billingAccountId ?? null,
        accountOverrides: (setupRow.accountOverrides ?? {}) as AccountOverrides,
        defaultBillStartDate: toIsoDate(setupRow.defaultBillStartDate),
        lineBillStarts: setupRow.lineBillStarts ?? {},
        appliedBillingAccountId: setupRow.appliedBillingAccountId ?? null,
      }
    : null

  const activationDate = toIsoDate(payload.activationDate) ?? todayIsoDate()
  const billStartFor = (item: CpqSubscriptionItem) => itemBillStart(item, setup, activationDate)
  const earliestBillStart = earliestIsoDate(payload.items.map(billStartFor))

  const account = await resolveBillingAccount({
    billing: billingApi,
    scope,
    payload,
    setup,
    earliestBillStart,
  })

  if (payload.sourceOrderId) {
    await setupService.markApplied(scope, {
      orderId: payload.sourceOrderId,
      customerId: payload.customerId,
      currencyCode: payload.currencyCode,
      billingAccountId: account.id,
      accountMode: account.accountMode,
    })
  }

  const itemPayloads = mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.items,
    billStartDate: activationDate,
    billStartDateFor: billStartFor,
  })

  // Bulk-create — one command for the whole subscription's charges
  // instead of one round-trip per charge. Idempotent per source_ref,
  // so a re-fired activation event is a no-op.
  await billingApi.bulkCreateItems(
    scope,
    itemPayloads.map((item) => ({
      billAccountId: account.id,
      type: item.type,
      billStartDate: item.billStartDate,
      description: item.description,
      rateJson: item.rateJson,
      subscriptionId: item.subscriptionId,
      subscriptionItemId: item.subscriptionItemId,
      sourceRef: item.sourceRef,
    })),
  )
}
