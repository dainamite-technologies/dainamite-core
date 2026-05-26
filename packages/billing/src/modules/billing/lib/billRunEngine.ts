import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  BillingAccount,
  BillingAccountUsage,
  BillingItem,
  BillRun,
  BillRunOutcome,
} from '../data/entities'
import { advanceNextBillDate, deriveBillPeriod, isCycleDue } from './billPeriod'
import {
  selectItemsForPeriod,
  type SelectableItem,
} from './itemSelector'
import {
  buildInvoiceLinesFromItems,
  writeDraftInvoice,
  type InvoiceLineDescriptor,
  type WriteMode,
} from './invoiceWriter'
import { withTenantLock } from './tenantLock'
import { processUsageForAccount } from './usageRunner'
import type { BillCycle } from '../data/validators'

/**
 * Bill Run engine — orchestrates one execution of the billing cycle for
 * a single tenant.
 *
 * Concurrency / locking:
 *   - The whole run is wrapped in `withTenantLock(...)`, which holds a
 *     transaction-scoped Postgres advisory lock keyed by
 *     `hash(tenant_id || ':billing-run')`. A second trigger fired while a
 *     run is in flight short-circuits with `TenantLockBusyError` (the
 *     command layer maps that to HTTP 409).
 *   - Within the outer transaction, every account is processed inside a
 *     nested `em.transactional(...)` (PG SAVEPOINT). A per-account failure
 *     rolls back only that account's work, leaving siblings unaffected.
 *
 * Run modes:
 *   - `real` (default) — persist drafts, advance `next_bill_date`, mark
 *     items `billed_to_date`. Production path.
 *   - `test` — persist drafts flagged with `metadata.test_run=true`, but
 *     do NOT advance state. Repeatable.
 *   - `dry`  — compute everything; persist nothing. Preview only.
 *
 * Catch-up:
 *   - Manual triggers may set `catchUp=true`. The engine then loops cycles
 *     per account until `next_bill_date > as_of_date`, emitting one draft
 *     per missed cycle (never combined).
 *   - Scheduled triggers always process exactly ONE cycle per account per
 *     run, regardless of how far behind the account is.
 *
 * Anti-duplicate guards (both run in every mode except `dry`):
 *   1. Open-draft check on `core/sales` invoice (per period boundary).
 *   2. `billed_to_date` per BillingItem.
 */

export type RunMode = WriteMode

export type RunBillRunParams = {
  tenantId: string
  organizationId: string
  asOfDate: Date
  triggeredBy: 'schedule' | 'manual'
  mode: RunMode
  scopedAccountIds?: string[]
  parentRunId?: string | null
  catchUp?: boolean
}

export type RunBillRunResult = {
  billRun: BillRun
  outcomes: BillRunOutcome[]
}

type AccountWarnings = {
  currency_mismatch_items?: string[]
  unmatched_usage_uoms?: string[]
}

type AccountProcessSuccess = {
  status: 'success' | 'success_with_warnings' | 'skipped_existing_draft'
  warnings: AccountWarnings | null
  draftInvoiceId: string | null
  cyclesEmitted: number
  usageRecordsRated: number
}

type AccountProcessFailed = {
  status: 'failed'
  errorMessage: string
}

type AccountProcessResult = AccountProcessSuccess | AccountProcessFailed

const SCHEDULED_CYCLE_LIMIT = 1
const CATCH_UP_HARD_CAP = 60 // safety net so a misconfigured account can't loop forever

export async function runBillRun(
  em: EntityManager,
  container: AwilixContainer,
  params: RunBillRunParams,
): Promise<RunBillRunResult> {
  return withTenantLock(
    em,
    { tenantId: params.tenantId, lockName: 'billing-run' },
    async (tem) => executeRunWithinLock(tem, container, params),
  )
}

async function executeRunWithinLock(
  em: EntityManager,
  container: AwilixContainer,
  params: RunBillRunParams,
): Promise<RunBillRunResult> {
  const now = new Date()
  const billRun = em.create(BillRun, {
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    triggeredBy: params.triggeredBy,
    parentRunId: params.parentRunId ?? null,
    dryRun: params.mode === 'dry',
    testMode: params.mode === 'test',
    catchUp: Boolean(params.catchUp),
    scopedAccountIds: params.scopedAccountIds ?? null,
    asOfDate: params.asOfDate,
    startedAt: now,
    status: 'running',
    summary: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(billRun)
  await em.flush()

  const accounts = await selectTargetAccounts(em, params)
  const outcomes: BillRunOutcome[] = []
  let totalUsageRecordsRated = 0

  for (const account of accounts) {
    const processResult = await processAccountSafely(em, container, billRun, account, params)
    if (processResult.status !== 'failed') {
      totalUsageRecordsRated += processResult.usageRecordsRated
    }
    const outcome = em.create(BillRunOutcome, {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      billRunId: billRun.id,
      billAccountId: account.id,
      status: processResult.status,
      errorMessage: processResult.status === 'failed' ? processResult.errorMessage : null,
      warnings:
        processResult.status === 'failed'
          ? null
          : (processResult.warnings as Record<string, unknown> | null),
      draftInvoiceId: processResult.status === 'failed' ? null : processResult.draftInvoiceId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(outcome)
    await em.flush()
    outcomes.push(outcome)
  }

  billRun.status = computeFinalRunStatus(outcomes)
  billRun.finishedAt = new Date()
  billRun.updatedAt = billRun.finishedAt
  billRun.summary = buildRunSummary(outcomes, accounts.length, totalUsageRecordsRated)
  await em.flush()

  return { billRun, outcomes }
}

async function selectTargetAccounts(
  em: EntityManager,
  params: RunBillRunParams,
): Promise<BillingAccount[]> {
  const where: Record<string, unknown> = {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
    nextBillDate: { $lte: params.asOfDate },
  }
  if (params.scopedAccountIds && params.scopedAccountIds.length > 0) {
    where.id = { $in: params.scopedAccountIds }
  }
  return em.find(BillingAccount, where as never)
}

async function processAccountSafely(
  em: EntityManager,
  container: AwilixContainer,
  billRun: BillRun,
  account: BillingAccount,
  params: RunBillRunParams,
): Promise<AccountProcessResult> {
  try {
    return await em.transactional(async (subEm) => {
      return processAccount(subEm, container, billRun, account, params)
    })
  } catch (err) {
    return {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

async function processAccount(
  em: EntityManager,
  container: AwilixContainer,
  billRun: BillRun,
  account: BillingAccount,
  params: RunBillRunParams,
): Promise<AccountProcessResult> {
  const maxCycles =
    params.triggeredBy === 'schedule' || !params.catchUp
      ? SCHEDULED_CYCLE_LIMIT
      : CATCH_UP_HARD_CAP

  let cyclesEmitted = 0
  let lastDraftInvoiceId: string | null = null
  let totalUsageRatedThisAccount = 0
  const aggregatedWarnings: AccountWarnings = {}

  while (cyclesEmitted < maxCycles && isCycleDue(account.nextBillDate, params.asOfDate)) {
    const period = deriveBillPeriod(account.nextBillDate, account.billCycle as BillCycle)

    // Open-draft anti-duplicate — only applies when we'd actually persist.
    if (params.mode !== 'dry') {
      const existing = await findExistingDraftForPeriod(em, account, period)
      if (existing) {
        return {
          status: 'skipped_existing_draft',
          warnings: null,
          draftInvoiceId: existing,
          cyclesEmitted,
          usageRecordsRated: totalUsageRatedThisAccount,
        }
      }
    }

    const items = await em.find(BillingItem, {
      tenantId: account.tenantId,
      organizationId: account.organizationId,
      billAccountId: account.id,
      deletedAt: null,
    } as never)

    const usageItems = (items as BillingItem[]).filter((it) => it.type === 'usage')

    // Non-usage path: one_time + recurring filtered by the selector.
    const { included } = selectItemsForPeriod(items as SelectableItem[], period)
    const billableItems = included as unknown as BillingItem[]

    const currencyMismatchIds = billableItems
      .filter((it) => it.currencyMismatch)
      .map((it) => it.id)
    if (currencyMismatchIds.length > 0) {
      aggregatedWarnings.currency_mismatch_items = [
        ...(aggregatedWarnings.currency_mismatch_items ?? []),
        ...currencyMismatchIds,
      ]
    }
    const itemLines = buildInvoiceLinesFromItems(billableItems)

    // Usage path: aggregate matching usage records per uom_code, rate,
    // emit one line per matched usage item, warn about unmatched UoMs.
    const usageResult = await processUsageForAccount(em, account, period, usageItems)
    if (usageResult.unmatchedUoms.length > 0) {
      aggregatedWarnings.unmatched_usage_uoms = [
        ...(aggregatedWarnings.unmatched_usage_uoms ?? []),
        ...usageResult.unmatchedUoms,
      ]
    }

    const allLines: InvoiceLineDescriptor[] = [...itemLines, ...usageResult.lines]
    if (allLines.length === 0) {
      // Nothing to bill this cycle — still advance so the account moves
      // forward in real mode. In test / dry, no advance, so we'd loop
      // forever; break out.
      if (params.mode !== 'real') break
      account.nextBillDate = advanceNextBillDate(
        account.nextBillDate,
        account.billCycle as BillCycle,
      )
      account.lastBillDate = period.periodEnd
      account.updatedAt = new Date()
      cyclesEmitted += 1
      continue
    }

    const written = await writeDraftInvoice(em, container, {
      mode: params.mode,
      account,
      period,
      billRunId: billRun.id,
      lines: allLines,
    })
    lastDraftInvoiceId = written.invoiceId

    if (params.mode === 'real') {
      const now = new Date()
      for (const item of billableItems) {
        item.billedToDate = period.periodEnd
        item.updatedAt = now
      }
      // Mark consumed usage records — single bulk update so we don't
      // round-trip per record on accounts with thousands of usage rows.
      if (usageResult.matchedUoms.length > 0) {
        // Predicate-based bulk update: marks every still-unrated record
        // for the matched uoms in the account's period with a single
        // SQL UPDATE — no id list ever leaves Postgres. Stays
        // memory-bounded even for telco accounts with millions of
        // usage records per cycle (spec Performance Considerations
        // "Shape B").
        await em.nativeUpdate(
          BillingAccountUsage,
          {
            tenantId: account.tenantId,
            organizationId: account.organizationId,
            billAccountId: account.id,
            uomCode: { $in: usageResult.matchedUoms },
            ratedInBillRunId: null,
            periodEnd: { $lte: period.periodEnd },
            deletedAt: null,
          } as never,
          { ratedInBillRunId: billRun.id, updatedAt: now } as never,
        )
      }
      totalUsageRatedThisAccount += usageResult.ratedCount
      account.nextBillDate = advanceNextBillDate(
        account.nextBillDate,
        account.billCycle as BillCycle,
      )
      account.lastBillDate = period.periodEnd
      account.updatedAt = now
      await em.flush()
    } else {
      // Test / dry: do not advance state. One iteration only.
      break
    }

    cyclesEmitted += 1
  }

  const hasCurrencyWarnings =
    (aggregatedWarnings.currency_mismatch_items ?? []).length > 0
  const hasUnmatchedUsage =
    (aggregatedWarnings.unmatched_usage_uoms ?? []).length > 0
  const hasWarnings = hasCurrencyWarnings || hasUnmatchedUsage
  return {
    status: hasWarnings ? 'success_with_warnings' : 'success',
    warnings: hasWarnings ? aggregatedWarnings : null,
    draftInvoiceId: lastDraftInvoiceId,
    cyclesEmitted,
    usageRecordsRated: totalUsageRatedThisAccount,
  }
}

async function findExistingDraftForPeriod(
  em: EntityManager,
  account: BillingAccount,
  period: { periodStart: Date; periodEnd: Date },
): Promise<string | null> {
  const periodStartISO = period.periodStart.toISOString().slice(0, 10)
  const periodEndISO = period.periodEnd.toISOString().slice(0, 10)
  const rows = (await em.execute(
    `SELECT id FROM sales_invoices
     WHERE tenant_id = ?
       AND organization_id = ?
       AND deleted_at IS NULL
       AND status = 'draft'
       AND metadata->>'bill_account_id' = ?
       AND metadata->>'bill_period_start' = ?
       AND metadata->>'bill_period_end' = ?
     LIMIT 1`,
    [account.tenantId, account.organizationId, account.id, periodStartISO, periodEndISO],
  )) as unknown as Array<{ id: string }> | undefined
  if (!rows || rows.length === 0) return null
  return rows[0].id ?? null
}

function computeFinalRunStatus(
  outcomes: readonly BillRunOutcome[],
): BillRun['status'] {
  if (outcomes.length === 0) return 'completed'
  const anyFailed = outcomes.some((o) => o.status === 'failed')
  const anySuccess = outcomes.some(
    (o) => o.status === 'success' || o.status === 'success_with_warnings',
  )
  if (anyFailed && anySuccess) return 'partial_failure'
  if (anyFailed) return 'partial_failure'
  return 'completed'
}

function buildRunSummary(
  outcomes: readonly BillRunOutcome[],
  totalAccounts: number,
  usageRecordsRated: number,
): Record<string, unknown> {
  return {
    accounts_processed: totalAccounts,
    drafts_created: outcomes.filter(
      (o) => o.draftInvoiceId !== null && o.status !== 'skipped_existing_draft',
    ).length,
    drafts_skipped_existing: outcomes.filter((o) => o.status === 'skipped_existing_draft')
      .length,
    accounts_failed: outcomes.filter((o) => o.status === 'failed').length,
    accounts_with_warnings: outcomes.filter((o) => o.status === 'success_with_warnings')
      .length,
    usage_records_rated: usageRecordsRated,
  }
}
