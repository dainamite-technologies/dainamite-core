import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingAccount } from '../data/entities'
import { withAccountLock } from '../lib/accountLock'
import { applyAccountCredit } from '../lib/allocation'
import { emitAllocationEffects } from '../lib/allocationEvents'

/**
 * Credit auto-apply on post (Spec C, D12): when an invoice is posted, any
 * unapplied credit of its account (overpayments, unallocated payments,
 * open credit memos) is spent on the account's open receivables, oldest due
 * date first. Persistent and safe to re-run (it only spends what is left).
 */

export const metadata = {
  event: 'billing.invoice.posted',
  persistent: true,
  id: 'billing-invoice-apply-credit',
}

export type PostedPayload = { billAccountId?: string; tenantId?: string; organizationId?: string }

export async function applyCreditForAccount(em: EntityManager, payload: PostedPayload): Promise<number> {
  if (!payload?.billAccountId || !payload.tenantId || !payload.organizationId) return 0
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const account = await em.findOne(BillingAccount, { id: payload.billAccountId, ...scope } as never)
  if (!account || account.billingMode === 'prepaid') return 0
  const effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId: account.id }, (tem) =>
    applyAccountCredit(tem, scope, { id: account.id, currencyCode: account.currencyCode }),
  )
  await emitAllocationEffects(scope, effects)
  return effects.created.length
}

export default async function handle(payload: PostedPayload): Promise<void> {
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  await applyCreditForAccount(em, payload)
}
