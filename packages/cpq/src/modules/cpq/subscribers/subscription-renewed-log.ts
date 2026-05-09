/**
 * Placeholder persistent subscriber for `cpq.subscription.renewed`.
 * Standalone-renew only — merge-renew fires `cpq.subscription.merged`.
 */
export const metadata = {
  event: 'cpq.subscription.renewed',
  persistent: true,
  id: 'cpq-subscription-renewed-log',
}

export default async function handler(payload: Record<string, unknown>): Promise<void> {
  console.info(
    '[cpq.arc] renewed',
    payload.subscriptionId,
    'changeLog=' + payload.changeLogId,
    'order=' + payload.sourceOrderId,
  )
}
