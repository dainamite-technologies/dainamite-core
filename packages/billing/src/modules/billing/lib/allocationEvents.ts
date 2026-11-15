import { emitBillingEvent } from '../events'
import type { AllocationEffects, ArScope } from './allocation'

/**
 * Emits the events of an allocation change AFTER the transaction committed
 * (Spec C): one `billing.payment.allocated` / `unallocated` per payment
 * allocation row, and `billing.invoice.paid` / `partially_paid` / `credited` (Spec D) per receivable whose status changed.
 */
export async function emitAllocationEffects(scope: ArScope, effects: AllocationEffects): Promise<void> {
  for (const row of effects.created) {
    if (row.sourceType !== 'payment') continue
    await emitBillingEvent('billing.payment.allocated', { ...scope, paymentId: row.sourceId, invoiceId: row.invoiceId, allocationId: row.allocationId, amount: row.amount })
  }
  for (const row of effects.removed) {
    if (row.sourceType !== 'payment') continue
    await emitBillingEvent('billing.payment.unallocated', { ...scope, paymentId: row.sourceId, invoiceId: row.invoiceId, allocationId: row.allocationId, amount: row.amount })
  }
  // Last transition per invoice wins (several allocations can touch one invoice).
  const finalStatus = new Map<string, string>()
  for (const change of effects.invoiceStatusChanges) finalStatus.set(change.invoiceId, change.to)
  for (const [invoiceId, status] of finalStatus) {
    if (status === 'paid') await emitBillingEvent('billing.invoice.paid', { ...scope, invoiceId })
    else if (status === 'partially_paid') await emitBillingEvent('billing.invoice.partially_paid', { ...scope, invoiceId })
    else if (status === 'credited') await emitBillingEvent('billing.invoice.credited', { ...scope, invoiceId })
  }
}
