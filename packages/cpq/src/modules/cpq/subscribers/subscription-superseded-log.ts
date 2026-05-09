/**
 * Placeholder persistent subscriber for `cpq.subscription.superseded`.
 * Fires once per merge source — payload carries `mergedIntoSubscriptionId`
 * pointing at the new merge sub M.
 */
export const metadata = {
  event: 'cpq.subscription.superseded',
  persistent: true,
  id: 'cpq-subscription-superseded-log',
}

export default async function handler(payload: Record<string, unknown>): Promise<void> {
  console.info(
    '[cpq.arc] superseded',
    payload.subscriptionId,
    'mergedInto=' + payload.mergedIntoSubscriptionId,
    'changeLog=' + payload.changeLogId,
  )
}
