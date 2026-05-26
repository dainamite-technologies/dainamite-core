import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope, type AccountSeed } from '../lib/billingApiClient'
import { mapSubscriptionItemsToBillingItems } from '../lib/chargeMapper'
import type { CpqSubscriptionItem } from '../lib/chargeMapper'

/**
 * Subscriber: `cpq.subscription.activated` → billing onboarding.
 *
 * `@dainamite/cpq` emits this event when a new-sale order is activated
 * (`cpqOrderService.activateOrder`).
 *
 * Behaviour when fired:
 *   1. Get-or-create the Billing Account for `(tenant, org, customerId)`.
 *      Missing account → shell account with placeholders (operator
 *      must configure before billing fires). `nextBillDate` defaults
 *      to today + one month so the Bill Run won't bill an under-
 *      configured account until the operator advances it.
 *   2. For every charge on every CPQ subscription item, create a
 *      Billing Item via `billing.items.create`. `source_ref` is the
 *      deterministic `cpq-<subId>-<subItemId>-<chargeType>` key, so
 *      re-firing the activation event hits the idempotency guard
 *      instead of duplicating items.
 *
 * Errors propagate to the persistent queue worker, which retries
 * per the OM queue contract.
 */

export const metadata = {
  event: 'cpq.subscription.activated',
  persistent: true,
  id: 'cpq-billing-connector:subscription-activated',
}

type ActivatedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  currencyCode: string
  /** Optional richer customer fields — used when present, otherwise placeholders. */
  customerName?: string
  invoiceEmail?: string
  invoiceLanguage?: string
  invoiceAddress?: Record<string, unknown>
  billCycle?: 'monthly' | 'quarterly' | 'annually' | 'weekly'
  billCycleAnchor?: string
  nextBillDate?: string
  taxId?: string | null
  items: CpqSubscriptionItem[]
  /** Activation date — used as bill_start_date on every created item. */
  activationDate?: string
}

function isoDateAddMonths(months: number): string {
  // Clamp the day to the last valid day of the target month so Jan 31 + 1
  // month → Feb 28/29 (not Mar 3, which is what `setUTCMonth` alone would
  // produce by overflowing into the next month).
  const d = new Date()
  const targetYear = d.getUTCFullYear()
  const targetMonth = d.getUTCMonth() + months
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(d.getUTCDate(), lastDayOfTargetMonth))
  d.setUTCMonth(targetMonth)
  return d.toISOString().slice(0, 10)
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildAccountSeed(payload: ActivatedPayload): AccountSeed {
  return {
    customerId: payload.customerId,
    name: payload.customerName ?? `Customer ${payload.customerId}`,
    currencyCode: payload.currencyCode,
    billCycle: payload.billCycle ?? 'monthly',
    billCycleAnchor: payload.billCycleAnchor ?? '1',
    invoiceEmail:
      payload.invoiceEmail ?? `billing+${payload.customerId}@invalid.local`,
    invoiceLanguage: payload.invoiceLanguage ?? 'en',
    invoiceAddress: payload.invoiceAddress ?? {
      line1: 'TBD',
      city: 'TBD',
      postal_code: 'TBD',
      country: 'XX',
    },
    nextBillDate: payload.nextBillDate
      ? new Date(payload.nextBillDate)
      : new Date(isoDateAddMonths(1)),
    taxId: payload.taxId ?? null,
  }
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
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  const account = await billingApi.getOrCreateAccount(scope, buildAccountSeed(payload))

  const billStartDate = payload.activationDate ?? todayIsoDate()
  const itemPayloads = mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: payload.items,
    billStartDate,
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
