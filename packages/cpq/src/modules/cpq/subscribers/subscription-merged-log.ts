/**
 * Placeholder persistent subscriber for `cpq.subscription.merged`.
 * Fires once per merge group, on the new merge sub M.
 */
export const metadata = {
  event: 'cpq.subscription.merged',
  persistent: true,
  id: 'cpq-subscription-merged-log',
}

export default async function handler(payload: Record<string, unknown>): Promise<void> {
  const sources = Array.isArray(payload.mergedFromSubscriptionIds)
    ? payload.mergedFromSubscriptionIds.length
    : 0
  console.info(
    '[cpq.arc] merged',
    payload.subscriptionId,
    `from ${sources} sources`,
    'changeLog=' + payload.changeLogId,
    'order=' + payload.sourceOrderId,
  )
}
