import { detectBalanceCrossing } from './balanceStatus'
import { detectCreditCrossing, prepaidCreditUsed } from './creditStatus'

/**
 * Shared balance/credit threshold-crossing → domain-event builder (SPEC-002).
 *
 * Every balance movement that can change status — real-time usage debit, a
 * manual adjustment, a period-close recurring charge — runs through this so
 * the "fire only on the relevant downward/upward crossing" rule lives in
 * exactly one place. The events are returned (not emitted) so callers fire
 * them AFTER the DB commit.
 */

export type DomainEvent = { id: string; payload: Record<string, unknown> }

export type BalanceEventScope = {
  billAccountId: string
  tenantId: string
  organizationId: string
  currencyCode: string
}

export function buildBalanceCrossingEvents(params: {
  scope: BalanceEventScope
  balanceBefore: string
  balanceAfter: string
  threshold: string
  creditLimit: string
  nearLimitBuffer: string
}): DomainEvent[] {
  const { scope, balanceBefore, balanceAfter, threshold, creditLimit, nearLimitBuffer } = params
  const events: DomainEvent[] = []
  const base = {
    billAccountId: scope.billAccountId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    currencyCode: scope.currencyCode,
    balance: balanceAfter,
  }

  const balanceCrossing = detectBalanceCrossing(balanceBefore, balanceAfter, threshold)
  if (balanceCrossing.exhaustedCrossedDown) {
    events.push({ id: 'billing.balance.exhausted', payload: { ...base } })
  }
  if (balanceCrossing.lowCrossedDown) {
    events.push({
      id: 'billing.balance.low',
      payload: { ...base, lowBalanceThreshold: threshold },
    })
  }

  const usedBefore = prepaidCreditUsed(balanceBefore)
  const usedAfter = prepaidCreditUsed(balanceAfter)
  const creditCrossing = detectCreditCrossing({
    creditLimit,
    nearLimitBuffer,
    usedBefore,
    usedAfter,
  })
  if (creditCrossing.overLimitCrossedUp) {
    events.push({
      id: 'billing.credit.over_limit',
      payload: { ...base, creditLimit, creditUsed: usedAfter },
    })
  }
  if (creditCrossing.nearLimitCrossedUp) {
    events.push({
      id: 'billing.credit.near_limit',
      payload: { ...base, creditLimit, creditUsed: usedAfter },
    })
  }

  return events
}
