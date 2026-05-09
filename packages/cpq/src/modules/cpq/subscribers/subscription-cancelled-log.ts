/**
 * Placeholder persistent subscriber for `cpq.subscription.cancelled`.
 * Cancel quote payload includes ETF + reason metadata.
 */
export const metadata = {
  event: 'cpq.subscription.cancelled',
  persistent: true,
  id: 'cpq-subscription-cancelled-log',
}

export default async function handler(payload: Record<string, unknown>): Promise<void> {
  console.info(
    '[cpq.arc] cancelled',
    payload.subscriptionId,
    'reason=' + (payload.reasonCode ?? 'none'),
    'etf=' + (payload.etfAmount ?? 'none'),
    'changeLog=' + payload.changeLogId,
  )
}
