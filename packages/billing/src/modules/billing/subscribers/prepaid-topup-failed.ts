import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { transitionTopupByPaymentId } from '../lib/topupTransition'

/**
 * Subscriber: `payment_gateways.payment.failed` → BillingTopup → failed.
 * No-op for any non-top-up payment (no matching BillingTopup). No balance
 * movement.
 */

export const metadata = {
  event: 'payment_gateways.payment.failed',
  persistent: true,
  id: 'billing-prepaid-topup-failed',
}

type Payload = { paymentId?: string; tenantId?: string; organizationId?: string }

export default async function handle(payload: Payload): Promise<void> {
  if (!payload?.paymentId || !payload.tenantId || !payload.organizationId) return
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  await transitionTopupByPaymentId(
    em,
    {
      paymentId: payload.paymentId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
    'failed',
  )
}
