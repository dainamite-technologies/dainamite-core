import type { AwilixContainer } from 'awilix'
import type { Scope } from './billingApiClient'
import type { CpqOrderReader } from '../services/orderSetupService'

/**
 * The order number of the CPQ order behind an ARC event — the `reference`
 * of a generated credit reason ("Subscription amended (order SO-1234) …").
 *
 * Best-effort: the reason is informative, so a missing order id, an older
 * CPQ without the service, or a failed read yields `undefined` (the reason
 * is then rendered without a reference) instead of failing the subscriber.
 */
export async function resolveOrderReference(
  container: AwilixContainer,
  scope: Scope,
  sourceOrderId: string | null | undefined,
): Promise<string | undefined> {
  if (!sourceOrderId) return undefined
  try {
    const reader = container.resolve('cpqOrderService') as CpqOrderReader
    const order = await reader.getOrder(sourceOrderId, scope)
    const number = typeof order?.orderNumber === 'string' ? order.orderNumber.trim() : ''
    return number.length > 0 ? number : undefined
  } catch (err) {
    console.warn('[cpq_billing_connector] order number for credit reason unavailable', err)
    return undefined
  }
}
