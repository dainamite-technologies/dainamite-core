/**
 * Placeholder persistent subscriber for `cpq.subscription.amended`.
 *
 * Logs the payload for human review until downstream billing /
 * notification modules subscribe with real handlers (XD-250).
 */
export const metadata = {
  event: 'cpq.subscription.amended',
  persistent: true,
  id: 'cpq-subscription-amended-log',
}

export default async function handler(payload: Record<string, unknown>): Promise<void> {
  console.info(
    '[cpq.arc] amended',
    payload.subscriptionId,
    'changeLog=' + payload.changeLogId,
    'order=' + payload.sourceOrderId,
  )
}
