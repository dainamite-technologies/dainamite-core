import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingTopup } from '../data/entities'
import type { TopupStatus } from '../data/validators'

/**
 * Transition a registered top-up to a terminal non-captured status
 * (failed / cancelled / expired) in response to the sibling gateway events.
 *
 * Finding a BillingTopup by `payment_id` IS the guard: a non-top-up payment
 * (e.g. a postpaid invoice, whose paymentId is the invoice id) matches no
 * BillingTopup, so this is a silent no-op for everyone else. A captured
 * top-up is never downgraded.
 */
export async function transitionTopupByPaymentId(
  em: EntityManager,
  scope: { paymentId: string; tenantId: string; organizationId: string },
  toStatus: Extract<TopupStatus, 'failed' | 'cancelled' | 'expired'>,
): Promise<BillingTopup | null> {
  const topup = await em.findOne(BillingTopup, {
    paymentId: scope.paymentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!topup) return null
  if (topup.status === 'captured' || topup.status === toStatus) return topup
  topup.status = toStatus
  topup.updatedAt = new Date()
  await em.flush()
  return topup
}
