import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BillingAccount,
  BillingAccountBalance,
  BillingAccountTransaction,
  BillingAccountUsage,
  BillingItem,
} from '../data/entities'
import type { BalanceStatus, CreditStatus } from '../data/validators'
import {
  applyBalanceMovement,
  PREPAID_USAGE_SENTINEL_RUN_ID,
} from './balanceLedger'
import {
  computeBalanceStatus,
  resolveLowBalanceThreshold,
} from './balanceStatus'
import {
  computeCreditStatus,
  computeAvailableCredit,
  prepaidCreditUsed,
} from './creditStatus'
import { buildBalanceCrossingEvents, type DomainEvent } from './balanceEvents'
import { absMoney, negateMoney } from './money'
import {
  getLowBalanceThresholdDefault,
  getNearLimitBufferDefault,
} from './prepaidConfig'
import { rateUsageForItem, type TierBreakdownEntry } from './usageRater'

/**
 * Real-time prepaid consume (SPEC-002 P1).
 *
 * For a prepaid account, a usage upload is rated in real time, debited from
 * the balance, and the remaining balance is returned — *"I uploaded usage and
 * got my remaining balance back."* Usage is NEVER rejected: a missing price or
 * an exhausted balance still records the usage; we report status and let the
 * client throttle itself.
 *
 * The caller MUST run this inside an `em.transactional(...)` so the usage
 * insert, the atomic balance debit, and the transaction insert commit (or roll
 * back) together. Domain events are returned (not emitted) so the caller can
 * fire them AFTER the DB commit.
 */

export type PrepaidConsumeInput = {
  organizationId: string
  tenantId: string
  billAccountId: string
  uomCode: string
  quantity: number
  periodStart: Date
  periodEnd: Date
  lineDescription?: string | null
  sourceRef?: string | null
}

export type PrepaidConsumeResult = {
  id: string
  deduplicated: boolean
  ratedAmount: string
  currencyCode: string
  balance: string
  balanceStatus: BalanceStatus
  creditStatus: CreditStatus
  tierBreakdown: TierBreakdownEntry[]
  warning: string | null
}

export type PrepaidConsumeOutcome = {
  result: PrepaidConsumeResult
  events: DomainEvent[]
}

function breakdownFromMetadata(meta: Record<string, unknown> | null | undefined): TierBreakdownEntry[] {
  const b = meta?.usage_tier_breakdown
  return Array.isArray(b) ? (b as TierBreakdownEntry[]) : []
}

/**
 * Resolve the active `type=usage` Billing Item priced for a uom (exact match,
 * no conversion — same rule as the postpaid runner). Latest active item wins.
 */
async function findUsageItem(
  em: EntityManager,
  input: PrepaidConsumeInput,
): Promise<BillingItem | null> {
  return em.findOne(
    BillingItem,
    {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      billAccountId: input.billAccountId,
      type: 'usage',
      uomCode: input.uomCode,
      isActive: true,
      deletedAt: null,
    } as never,
    { orderBy: { createdAt: 'DESC' } },
  )
}

export async function consumePrepaidUsage(
  em: EntityManager,
  account: BillingAccount,
  input: PrepaidConsumeInput,
): Promise<PrepaidConsumeOutcome> {
  const currencyCode = account.currencyCode
  const threshold = resolveLowBalanceThreshold(
    await readAccountThreshold(em, input),
    await getLowBalanceThresholdDefault(em),
  )
  const nearLimitBuffer = await getNearLimitBufferDefault(em)
  const creditLimit = account.creditLimit ?? '0'

  // ─── Idempotency: a duplicate sourceRef never double-debits ────
  if (input.sourceRef) {
    const existing = await em.findOne(BillingAccountUsage, {
      tenantId: input.tenantId,
      billAccountId: input.billAccountId,
      sourceRef: input.sourceRef,
      deletedAt: null,
    })
    if (existing) {
      const txn = await em.findOne(BillingAccountTransaction, {
        tenantId: input.tenantId,
        billAccountId: input.billAccountId,
        usageId: existing.id,
        deletedAt: null,
      })
      const balance = txn?.balanceAfter ?? (await readCurrentBalance(em, input))
      const ratedAmount = txn ? absMoney(txn.amount) : '0.0000'
      const warning = (txn?.metadata?.warning as string | undefined) ?? null
      return {
        result: {
          id: existing.id,
          deduplicated: true,
          ratedAmount,
          currencyCode,
          balance,
          balanceStatus: computeBalanceStatus(balance, threshold),
          creditStatus: computeCreditStatus(
            computeAvailableCredit(creditLimit, prepaidCreditUsed(balance)),
            nearLimitBuffer,
            prepaidCreditUsed(balance),
          ),
          tierBreakdown: breakdownFromMetadata(txn?.metadata),
          warning,
        },
        events: [],
      }
    }
  }

  // ─── 3. Persist the usage record (rated at ingest = sentinel) ──
  const now = new Date()
  const usage = em.create(BillingAccountUsage, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    billAccountId: input.billAccountId,
    uomCode: input.uomCode,
    quantity: input.quantity.toFixed(4),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lineDescription: input.lineDescription ?? null,
    sourceRef: input.sourceRef ?? null,
    // Stamped immediately so a postpaid-style run never re-rates it.
    ratedInBillRunId: PREPAID_USAGE_SENTINEL_RUN_ID,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(usage)
  await em.flush()

  // ─── 4. Rate against the matching usage item ───────────────────
  const item = await findUsageItem(em, input)
  let ratedAmount = '0.0000'
  let breakdown: TierBreakdownEntry[] = []
  let warning: string | null = null
  if (!item) {
    warning = 'no_matching_item'
  } else {
    const rated = rateUsageForItem(item, input.quantity)
    if (!rated) {
      warning = 'unratable'
    } else {
      ratedAmount = rated.amount
      breakdown = rated.breakdown
    }
  }

  // ─── 5–7. Atomic debit + paired transaction (signed amount) ────
  const movement = await applyBalanceMovement(em, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    billAccountId: input.billAccountId,
    currencyCode,
    type: 'usage',
    amount: negateMoney(ratedAmount),
    description: buildDescription(item, input, warning),
    usageId: usage.id,
    billingItemId: item?.id ?? null,
    sourceRef: input.sourceRef ?? null,
    metadata: {
      uom_code: input.uomCode,
      usage_tier_breakdown: breakdown,
      ...(warning ? { warning } : {}),
    },
  })

  const { balanceBefore, balanceAfter } = movement

  // ─── 8. Status + crossing events ──────────────────────────────
  const balanceStatus = computeBalanceStatus(balanceAfter, threshold)
  const scope = {
    billAccountId: input.billAccountId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    currencyCode,
  }
  const events: DomainEvent[] = buildBalanceCrossingEvents({
    scope,
    balanceBefore,
    balanceAfter,
    threshold,
    creditLimit,
    nearLimitBuffer,
  })

  // Optional per-debit signal (excluded from workflow triggers).
  events.push({
    id: 'billing.usage.rated',
    payload: {
      ...scope,
      balance: balanceAfter,
      usageId: usage.id,
      transactionId: movement.transaction.id,
      ratedAmount,
      balanceStatus,
    },
  })

  const usedAfter = prepaidCreditUsed(balanceAfter)
  const creditStatus = computeCreditStatus(
    computeAvailableCredit(creditLimit, usedAfter),
    nearLimitBuffer,
    usedAfter,
  )

  return {
    result: {
      id: usage.id,
      deduplicated: false,
      ratedAmount,
      currencyCode,
      balance: balanceAfter,
      balanceStatus,
      creditStatus,
      tierBreakdown: breakdown,
      warning,
    },
    events,
  }
}

function buildDescription(
  item: BillingItem | null,
  input: PrepaidConsumeInput,
  warning: string | null,
): string {
  if (input.lineDescription) return input.lineDescription
  const qty = input.quantity.toLocaleString('en-US')
  if (!item) return `Usage — ${qty} ${input.uomCode} (no matching item)`
  if (warning === 'unratable') return `Usage — ${qty} ${input.uomCode} (unratable)`
  return `${item.description} — ${qty} ${input.uomCode}`
}

async function readAccountThreshold(
  em: EntityManager,
  input: PrepaidConsumeInput,
): Promise<string | null> {
  const row = await em.findOne(BillingAccountBalance, {
    tenantId: input.tenantId,
    billAccountId: input.billAccountId,
  })
  return row?.lowBalanceThreshold ?? null
}

async function readCurrentBalance(
  em: EntityManager,
  input: PrepaidConsumeInput,
): Promise<string> {
  const row = await em.findOne(BillingAccountBalance, {
    tenantId: input.tenantId,
    billAccountId: input.billAccountId,
  })
  return row?.balance ?? '0.0000'
}
