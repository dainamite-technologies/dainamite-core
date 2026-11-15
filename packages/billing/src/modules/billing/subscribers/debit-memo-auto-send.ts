import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { autoSendInvoice } from './invoice-auto-send'

/** Auto-send of posted debit memos for accounts with `auto_send_invoice` (Spec D, P-D9). */
export const metadata = {
  event: 'billing.debit_memo.posted',
  persistent: true,
  id: 'billing-debit-memo-auto-send',
}

export default async function handle(payload: { invoiceId?: string; tenantId?: string; organizationId?: string }): Promise<void> {
  const container = await createRequestContainer()
  await autoSendInvoice((container.resolve('em') as EntityManager).fork(), payload)
}
