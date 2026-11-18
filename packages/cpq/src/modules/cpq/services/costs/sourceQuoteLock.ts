import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqInventorySubscription, CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'

/**
 * Activation locks (ARC costs spec Q2, App Spec I-12 / US-5.2). One helper for everything that has to be
 * serialized with an order's activation: the activation itself and, later, the post-conversion cost
 * re-confirmation.
 *
 * Lock order, always, inside ONE transaction (a lock is held until that transaction commits or rolls back):
 *   1. the order configuration row (taken by `activateOrder` itself, to read the order's status),
 *   2. the source quote configuration row (`lockSourceQuote`) - the very row `withQuotePricingWrite` locks,
 *   3. the target subscription rows, sorted by id (`lockSubscriptions`), ARC orders only.
 * A fixed order avoids deadlocks between two activations of one subscription and between an activation and a
 * re-confirmation. No `pricingRevision` bump and no event: a lock is not a change.
 *
 * Both helpers must run on the transaction EM; outside a transaction a row lock is released immediately.
 */

/**
 * Locks the source quote row (`PESSIMISTIC_WRITE`, re-read from the database) and returns it. A null / absent id
 * (an order without a source quote) locks nothing and returns null; a quote that no longer exists returns null.
 */
export async function lockSourceQuote(
  tx: EntityManager,
  sourceQuoteId: string | null | undefined,
  scope: TenantScope,
): Promise<CpqQuoteConfiguration | null> {
  if (!sourceQuoteId) return null
  return tx.findOne(CpqQuoteConfiguration, {
    id: sourceQuoteId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
}

/** Subscription ids in lock order: unique, ascending. */
export const subscriptionLockOrder = (ids: Iterable<string>): string[] => [...new Set(ids)].sort()

/**
 * Locks the given subscription rows (`PESSIMISTIC_WRITE`, re-read from the database), in ascending id order, and
 * returns them in that order. Ids that match no row are simply absent from the result: the caller's own apply
 * step reports a missing subscription.
 */
export async function lockSubscriptions(
  tx: EntityManager,
  subscriptionIds: Iterable<string>,
  scope: TenantScope,
): Promise<CpqInventorySubscription[]> {
  const ordered = subscriptionLockOrder(subscriptionIds)
  if (ordered.length === 0) return []
  return tx.find(CpqInventorySubscription, {
    id: { $in: ordered },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, orderBy: { id: 'asc' } })
}
