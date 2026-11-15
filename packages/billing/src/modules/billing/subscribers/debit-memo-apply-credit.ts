import { applyCreditForAccount, type PostedPayload } from './invoice-apply-credit'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'

/** Credit auto-apply when a debit memo is posted (Spec D, P-D6) — same handler as for invoices. */
export const metadata = {
  event: 'billing.debit_memo.posted',
  persistent: true,
  id: 'billing-debit-memo-apply-credit',
}

export default async function handle(payload: PostedPayload): Promise<void> {
  const container = await createRequestContainer()
  await applyCreditForAccount((container.resolve('em') as EntityManager).fork(), payload)
}
