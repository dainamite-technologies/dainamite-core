import type { AwilixContainer } from 'awilix'
import type { Scope } from './billingApiClient'
import type { CpqSubscriptionItem } from './chargeMapper'
import { resolveLineBillStart, type BillStartSetup } from './orderSetupResolution'
import { billStartSetupOf, type CpqBillingOrderSetupService } from '../services/orderSetupService'

/**
 * Order billing setup for the ARC subscribers (`amended`, `renewed`) — phase 2
 * of spec `2026-11-15-cpq-billing-connector-order-billing-setup` (D7).
 *
 * Added lines bill from: line override → CPQ service start → the order's
 * default bill start → the event's own date (amend: effective date; renew:
 * new term start). The account is always the subscription's existing one.
 */
export function arcItemBillStart(
  item: CpqSubscriptionItem,
  setup: BillStartSetup | null,
  eventDate: string,
): string {
  return resolveLineBillStart({
    orderLineId: item.orderLineId,
    serviceStartDate: item.startDate,
    setup,
    activationDate: eventDate,
  })
}

export async function loadArcBillStartSetup(
  container: AwilixContainer,
  scope: Scope,
  sourceOrderId: string | undefined,
): Promise<BillStartSetup | null> {
  if (!sourceOrderId) return null
  const service = container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
  return billStartSetupOf(await service.findSetup(scope, sourceOrderId))
}

/**
 * Lock the setup and record the account the added items went to. An order
 * may touch several subscriptions (one event each); the last one wins the
 * link shown on the order, the lock is what matters.
 */
export async function markArcSetupApplied(
  container: AwilixContainer,
  scope: Scope,
  input: { sourceOrderId: string | undefined; customerId: string; currencyCode: string; billingAccountId: string },
): Promise<void> {
  if (!input.sourceOrderId) return
  const service = container.resolve('cpqBillingOrderSetupService') as CpqBillingOrderSetupService
  await service.markApplied(scope, {
    orderId: input.sourceOrderId,
    customerId: input.customerId,
    currencyCode: input.currencyCode,
    billingAccountId: input.billingAccountId,
    accountMode: 'existing',
  })
}
