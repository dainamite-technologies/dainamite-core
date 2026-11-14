import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  BillingAccount,
  BillingAccountUsage,
  BillingItem,
  BillingRun,
  BillingRunOutcome,
} from '../data/entities'
import {
  addDays,
  advanceNextBillDate,
  cloneAtMidnight,
  deriveBillPeriod,
  isCycleDue,
  shiftCycles,
  type BillPeriod,
} from './billPeriod'
import { shouldIncludeItem, type SelectableItem } from './itemSelector'
import {
  buildInvoiceLinesFromItems,
  buildRecurringLineDescriptors,
  displayPeriod,
  writeDraftInvoice,
  type InvoiceLineDescriptor,
  type WriteMode,
} from './invoiceWriter'
import { computeRecurringLines, type RecurringSkip } from './servicePeriods'
import { withTenantLock } from './tenantLock'
import { processUsageForAccount } from './usageRunner'
import { processPrepaidAccount } from './prepaidPeriodClose'
import type { DomainEvent } from './balanceEvents'
import { emitBillingEvent, type BillingEventId } from '../events'
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
 * Cycles (Spec A): every run — manual or scheduled, any mode — bills ALL
 * due bill dates up to `asOfDate`, one draft per bill date (never
 * combined), capped at `CATCH_UP_HARD_CAP` per account. The account's
 * `next_bill_date` and each recurring item's `billed_to_date` watermark are
 * advanced in memory cycle by cycle; only `real` persists them:
 *   - `real` — persist drafts, advance `next_bill_date` / watermarks, mark
 *     usage rated. Production path.
 *   - `test` — persist drafts flagged `metadata.test_run=true` for every
 *     cycle, but do NOT advance state. Repeatable.
 *   - `dry`  — compute every cycle; persist nothing. Preview only.
 *
 * Recurring items are priced by `servicePeriods.computeRecurringLines`
 * (in advance / in arrears, proration, credits). `one_time` items use the
 * selector; usage is always billed in arrears for `[D − cycle, D − 1]`.
 *
 * Anti-duplicate guards (every mode except `dry`):
 *   1. Open draft for the same `(account, bill_date, test_run)`.
 *   2. `billed_to_date` per BillingItem (the watermark).
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
}

export type RunBillRunResult = {
  billRun: BillingRun
  outcomes: BillingRunOutcome[]
}

type RunOutput = RunBillRunResult & {
  /** Prepaid statement / crossing events to emit AFTER the outer tx commits. */
  pendingEvents: DomainEvent[]
}

type SkippedItemWarning = {
  item_id: string
  reason: string
  service_period_start: string | null
  service_period_end: string | null
}

type AccountWarnings = {
  currency_mismatch_items?: string[]
  unmatched_usage_uoms?: string[]
  /** Spec A: bill dates whose draft has a negative total (credits > charges). */
  negative_total_bill_dates?: string[]
  /** Spec A: the account hit CATCH_UP_HARD_CAP; later cycles wait for the next run. */
  catch_up_cap_reached?: boolean
  /** Spec A: diagnostic — partial periods not prorated, no-credit ends, caps. */
  skipped_items?: SkippedItemWarning[]
}

export type CycleStatus = 'invoiced' | 'previewed' | 'empty' | 'skipped_existing'

export type CycleRecord = {
  bill_date: string
  period_start: string | null
  period_end: string | null
  status: CycleStatus
  line_count: number
  total_net: string
  invoice_id: string | null
}

type AccountProcessSuccess = {
  status:
    | 'success'
    | 'success_with_warnings'
    | 'skipped_existing_draft'
    | 'skipped_existing_statement'
  warnings: AccountWarnings | Record<string, unknown> | null
  draftInvoiceId: string | null
  // SPEC-002: prepaid accounts produce a statement instead of a draft invoice.
  statementId?: string | null
  statementEvents?: DomainEvent[]
  cyclesEmitted: number
  usageRecordsRated: number
  /** Spec A: per-bill-date breakdown (postpaid). */
  cycles?: CycleRecord[]
}

type AccountProcessFailed = {
  status: 'failed'
  errorMessage: string
}

type AccountProcessResult = AccountProcessSuccess | AccountProcessFailed

export const CATCH_UP_HARD_CAP = 60 // safety net so a misconfigured account can't loop forever
const SKIPPED_ITEMS_WARNING_CAP = 200
/** Skip reasons that are normal state, not worth surfacing on the outcome. */
const QUIET_SKIP_REASONS = new Set(['item-inactive', 'item-soft-deleted'])

export async function runBillRun(
  em: EntityManager,
  container: AwilixContainer,
  params: RunBillRunParams,
): Promise<RunBillRunResult> {
  const output = await withTenantLock(
    em,
    { tenantId: params.tenantId, lockName: 'billing-run' },
    async (tem) => executeRunWithinLock(tem, container, params),
  )
  // Emit prepaid statement / crossing events ONLY after the outer transaction
  // (held by withTenantLock) has committed — emitting inside the lock would let
  // a consumer observe an uncommitted statement or a phantom event on rollback.
  for (const ev of output.pendingEvents) {
    await emitBillingEvent(ev.id as BillingEventId, ev.payload, { persistent: true })
  }
  return { billRun: output.billRun, outcomes: output.outcomes }
}

async function executeRunWithinLock(
  em: EntityManager,
  container: AwilixContainer,
  params: RunBillRunParams,
): Promise<RunOutput> {
  const now = new Date()
  const billRun = em.create(BillingRun, {
    organizationId: params.organizationId,
    tenantId: params.tenantId,
    triggeredBy: params.triggeredBy,
    parentRunId: params.parentRunId ?? null,
    dryRun: params.mode === 'dry',
    testMode: params.mode === 'test',
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
  const outcomes: BillingRunOutcome[] = []
  const pendingEvents: DomainEvent[] = []
  let totalUsageRecordsRated = 0

  for (const account of accounts) {
    const processResult = await processAccountSafely(em, container, billRun, account, params)
    if (processResult.status !== 'failed') {
      totalUsageRecordsRated += processResult.usageRecordsRated
    }
    const outcome = em.create(BillingRunOutcome, {
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
      statementId: processResult.status === 'failed' ? null : (processResult.statementId ?? null),
      cycles: processResult.status === 'failed' ? null : (processResult.cycles ?? null),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(outcome)
    await em.flush()
    outcomes.push(outcome)

    // Collect statement / crossing events — runBillRun emits them AFTER the
    // outer tx commits (see runBillRun), never from inside the lock.
    if (processResult.status !== 'failed' && processResult.statementEvents) {
      pendingEvents.push(...processResult.statementEvents)
    }
  }

  billRun.status = computeFinalRunStatus(outcomes)
  billRun.finishedAt = new Date()
  billRun.updatedAt = billRun.finishedAt
  billRun.summary = buildRunSummary(outcomes, accounts.length, totalUsageRecordsRated)
  await em.flush()

  return { billRun, outcomes, pendingEvents }
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
  billRun: BillingRun,
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
  billRun: BillingRun,
  account: BillingAccount,
  params: RunBillRunParams,
): Promise<AccountProcessResult> {
  // SPEC-002: a prepaid account never gets a payable draft invoice. It still
  // runs in the Bill Run, but charges recurring / one_time items to the
  // balance and produces a non-fiscal consumption statement.
  if (account.billingMode === 'prepaid') {
    const result = await processPrepaidAccount(em, account, billRun, {
      asOfDate: params.asOfDate,
      mode: params.mode,
      triggeredBy: params.triggeredBy,
    })
    if (result.status === 'failed') {
      return { status: 'failed', errorMessage: result.errorMessage }
    }
    return {
      status: result.status,
      warnings: result.warnings,
      draftInvoiceId: null,
      statementId: result.statementId,
      statementEvents: result.statementEvents,
      cyclesEmitted: result.cyclesEmitted,
      usageRecordsRated: 0,
    }
  }

  return processPostpaidAccount(em, container, billRun, account, params)
}

function isoDate(date: Date): string {
  return cloneAtMidnight(date).toISOString().slice(0, 10)
}

function toSkipWarning(skip: RecurringSkip): SkippedItemWarning {
  return {
    item_id: skip.billingItemId,
    reason: skip.reason,
    service_period_start: skip.servicePeriodStart ? isoDate(skip.servicePeriodStart) : null,
    service_period_end: skip.servicePeriodEnd ? isoDate(skip.servicePeriodEnd) : null,
  }
}

/**
 * Postpaid cycle loop (Spec A). Items are loaded once; the bill date and
 * the per-item watermarks advance in memory so test / dry can simulate every
 * due cycle exactly like real does — only persistence differs by mode.
 */
async function processPostpaidAccount(
  em: EntityManager,
  container: AwilixContainer,
  billRun: BillingRun,
  account: BillingAccount,
  params: RunBillRunParams,
): Promise<AccountProcessResult> {
  const cycle = account.billCycle as BillCycle
  const testRun = params.mode === 'test'
  const items = (await em.find(BillingItem, {
    tenantId: account.tenantId,
    organizationId: account.organizationId,
    billAccountId: account.id,
    deletedAt: null,
  } as never)) as BillingItem[]
  const recurringItems = items.filter((it) => it.type === 'recurring')
  const oneTimeItems = items.filter((it) => it.type === 'one_time')
  const usageItems = items.filter((it) => it.type === 'usage')

  // In-memory cycle state — persisted per cycle only in real mode.
  const watermarks = new Map<string, Date | null>(
    recurringItems.map((it) => [it.id, it.billedToDate ? cloneAtMidnight(it.billedToDate) : null]),
  )
  const billedOneTimes = new Set<string>(oneTimeItems.filter((it) => it.billedToDate).map((it) => it.id))
  let billDate = cloneAtMidnight(account.nextBillDate)
  // Usage already counted by an earlier cycle of THIS run (test / dry never
  // mark records, so later simulated cycles must not re-count them).
  let usageCountedThrough: Date | null = null

  const cycles: CycleRecord[] = []
  const warnings: AccountWarnings = {}
  const skippedItems: SkippedItemWarning[] = []
  let lastDraftInvoiceId: string | null = null
  let usageRecordsRated = 0

  const pushSkips = (skips: readonly RecurringSkip[]) => {
    for (const skip of skips) {
      if (QUIET_SKIP_REASONS.has(skip.reason)) continue
      if (skippedItems.length < SKIPPED_ITEMS_WARNING_CAP) skippedItems.push(toSkipWarning(skip))
    }
  }
  const addWarning = (key: 'currency_mismatch_items' | 'unmatched_usage_uoms' | 'negative_total_bill_dates', values: string[]) => {
    if (values.length === 0) return
    warnings[key] = Array.from(new Set([...(warnings[key] ?? []), ...values]))
  }

  while (isCycleDue(billDate, params.asOfDate)) {
    if (cycles.length >= CATCH_UP_HARD_CAP) {
      warnings.catch_up_cap_reached = true
      break
    }
    const nextBillDate = advanceNextBillDate(billDate, cycle)
    const arrearsPeriod: BillPeriod = deriveBillPeriod(billDate, cycle)

    // ── Recurring: service periods against the in-memory watermarks ──
    const lines: InvoiceLineDescriptor[] = []
    const watermarkUpdates = new Map<string, Date | null>()
    const chargedItems: BillingItem[] = []
    for (const item of recurringItems) {
      const unitPrice = (item.rateJson as { unit_price?: number } | null)?.unit_price
      if (typeof unitPrice !== 'number') continue
      const computed = computeRecurringLines(
        {
          id: item.id,
          chargeTiming: item.chargeTiming ?? 'in_advance',
          prorate: item.prorate ?? true,
          billStartDate: item.billStartDate,
          billEndDate: item.billEndDate ?? null,
          billedToDate: watermarks.get(item.id) ?? null,
          unitPrice,
          isActive: item.isActive,
          deletedAt: item.deletedAt ?? null,
        },
        { billDate, cycle },
      )
      pushSkips(computed.skipped)
      if (computed.newBilledToDate?.getTime() !== watermarks.get(item.id)?.getTime()) {
        watermarkUpdates.set(item.id, computed.newBilledToDate)
      }
      if (computed.lines.length > 0) {
        lines.push(...buildRecurringLineDescriptors(item, computed.lines))
        chargedItems.push(item)
      }
    }

    // ── One-time: first bill date whose [D − cycle, D + cycle − 1] window overlaps ──
    const oneTimeWindow: BillPeriod = {
      periodStart: shiftCycles(billDate, cycle, -1),
      periodEnd: addDays(nextBillDate, -1),
    }
    const oneTimesThisCycle = oneTimeItems.filter(
      (it) => !billedOneTimes.has(it.id) && shouldIncludeItem(it as SelectableItem, oneTimeWindow).include,
    )
    lines.push(...buildInvoiceLinesFromItems(oneTimesThisCycle))
    chargedItems.push(...oneTimesThisCycle)

    // ── Usage: always in arrears ──
    const usageResult = await processUsageForAccount(em, account, arrearsPeriod, usageItems, {
      after: usageCountedThrough,
    })
    addWarning('unmatched_usage_uoms', usageResult.unmatchedUoms)
    lines.push(
      ...usageResult.lines.map((line) => ({
        ...line,
        servicePeriodStart: arrearsPeriod.periodStart,
        servicePeriodEnd: arrearsPeriod.periodEnd,
      })),
    )
    addWarning(
      'currency_mismatch_items',
      chargedItems.filter((it) => it.currencyMismatch).map((it) => it.id),
    )

    const period = displayPeriod(lines, arrearsPeriod)
    const record: CycleRecord = {
      bill_date: isoDate(billDate),
      period_start: lines.length ? isoDate(period.periodStart) : null,
      period_end: lines.length ? isoDate(period.periodEnd) : null,
      status: 'empty',
      line_count: lines.length,
      total_net: '0.0000',
      invoice_id: null,
    }

    // ── Dedupe: an open draft already exists for this bill date ──
    const existing =
      params.mode === 'dry' ? null : await findExistingDraftForBillDate(em, account, billDate, testRun)
    if (existing && params.mode === 'real') {
      // Real state is inconsistent (draft written, account not advanced) —
      // stop here without advancing, as before Spec A.
      cycles.push({ ...record, status: 'skipped_existing', invoice_id: existing })
      return {
        status: 'skipped_existing_draft',
        warnings: finalizeWarnings(warnings, skippedItems),
        draftInvoiceId: existing,
        cyclesEmitted: cycles.filter((c) => c.status === 'invoiced').length,
        usageRecordsRated,
        cycles,
      }
    }

    if (existing) {
      cycles.push({ ...record, status: 'skipped_existing', invoice_id: existing })
    } else if (lines.length > 0) {
      const written = await writeDraftInvoice(em, container, {
        mode: params.mode,
        account,
        billDate,
        period,
        billRunId: billRun.id,
        lines,
      })
      if (written.invoiceId) lastDraftInvoiceId = written.invoiceId
      if (Number.parseFloat(written.totalNet) < 0) addWarning('negative_total_bill_dates', [record.bill_date])
      cycles.push({
        ...record,
        status: params.mode === 'dry' ? 'previewed' : 'invoiced',
        total_net: written.totalNet,
        invoice_id: written.invoiceId,
      })
    } else {
      cycles.push(record)
    }

    // ── Advance state: in memory always, persisted in real mode ──
    for (const [itemId, date] of watermarkUpdates) watermarks.set(itemId, date)
    for (const it of oneTimesThisCycle) billedOneTimes.add(it.id)
    usageCountedThrough = arrearsPeriod.periodEnd

    if (params.mode === 'real') {
      const now = new Date()
      for (const item of recurringItems) {
        if (!watermarkUpdates.has(item.id)) continue
        item.billedToDate = watermarkUpdates.get(item.id) ?? null
        item.updatedAt = now
      }
      for (const item of oneTimesThisCycle) {
        item.billedToDate = oneTimeWindow.periodEnd
        item.updatedAt = now
      }
      if (usageResult.matchedUoms.length > 0) {
        // Predicate-based bulk update: marks every still-unrated record for
        // the matched uoms up to the period end with a single SQL UPDATE —
        // no id list ever leaves Postgres (spec Performance "Shape B").
        await em.nativeUpdate(
          BillingAccountUsage,
          {
            tenantId: account.tenantId,
            organizationId: account.organizationId,
            billAccountId: account.id,
            uomCode: { $in: usageResult.matchedUoms },
            ratedInBillRunId: null,
            periodEnd: { $lte: arrearsPeriod.periodEnd },
            deletedAt: null,
          } as never,
          { ratedInBillRunId: billRun.id, updatedAt: now } as never,
        )
        usageRecordsRated += usageResult.ratedCount
      }
      account.nextBillDate = nextBillDate
      account.lastBillDate = arrearsPeriod.periodEnd
      account.updatedAt = now
      await em.flush()
    }

    billDate = nextBillDate
  }

  const finalWarnings = finalizeWarnings(warnings, skippedItems)
  return {
    status: hasRealWarnings(warnings) ? 'success_with_warnings' : 'success',
    warnings: finalWarnings,
    draftInvoiceId: lastDraftInvoiceId,
    cyclesEmitted: cycles.filter((c) => c.status === 'invoiced').length,
    usageRecordsRated,
    cycles,
  }
}

function finalizeWarnings(
  warnings: AccountWarnings,
  skippedItems: SkippedItemWarning[],
): AccountWarnings | null {
  const merged: AccountWarnings = { ...warnings, ...(skippedItems.length ? { skipped_items: skippedItems } : {}) }
  return Object.keys(merged).length > 0 ? merged : null
}

/** Skipped items are diagnostics; they don't downgrade the outcome status. */
function hasRealWarnings(warnings: AccountWarnings): boolean {
  return Boolean(
    warnings.currency_mismatch_items?.length ||
      warnings.unmatched_usage_uoms?.length ||
      warnings.negative_total_bill_dates?.length ||
      warnings.catch_up_cap_reached,
  )
}

/**
 * Open draft for `(account, bill_date, test_run)`. Test drafts never block
 * real drafts and vice versa. *(Spec 0 replaces this lookup with a unique
 * index on the billing-owned invoice table.)*
 */
async function findExistingDraftForBillDate(
  em: EntityManager,
  account: BillingAccount,
  billDate: Date,
  testRun: boolean,
): Promise<string | null> {
  const rows = (await em.execute(
    `SELECT id FROM sales_invoices
     WHERE tenant_id = ?
       AND organization_id = ?
       AND deleted_at IS NULL
       AND status = 'draft'
       AND metadata->>'bill_account_id' = ?
       AND metadata->>'bill_date' = ?
       AND coalesce(metadata->>'test_run', 'false') = ?
     LIMIT 1`,
    [account.tenantId, account.organizationId, account.id, isoDate(billDate), testRun ? 'true' : 'false'],
  )) as unknown as Array<{ id: string }> | undefined
  if (!rows || rows.length === 0) return null
  return rows[0].id ?? null
}

function computeFinalRunStatus(
  outcomes: readonly BillingRunOutcome[],
): BillingRun['status'] {
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
  outcomes: readonly BillingRunOutcome[],
  totalAccounts: number,
  usageRecordsRated: number,
): Record<string, unknown> {
  const allCycles = outcomes.flatMap((o) => (Array.isArray(o.cycles) ? (o.cycles as CycleRecord[]) : []))
  return {
    accounts_processed: totalAccounts,
    // Spec A: one draft per invoiced cycle (catch-up writes several per account).
    drafts_created: allCycles.filter((c) => c.status === 'invoiced' && c.invoice_id).length,
    cycles_processed: allCycles.length,
    drafts_skipped_existing: outcomes.filter((o) => o.status === 'skipped_existing_draft')
      .length,
    // SPEC-002 prepaid period close.
    statements_created: outcomes.filter(
      (o) => o.statementId !== null && o.status !== 'skipped_existing_statement',
    ).length,
    statements_skipped_existing: outcomes.filter(
      (o) => o.status === 'skipped_existing_statement',
    ).length,
    accounts_failed: outcomes.filter((o) => o.status === 'failed').length,
    accounts_with_warnings: outcomes.filter((o) => o.status === 'success_with_warnings')
      .length,
    usage_records_rated: usageRecordsRated,
  }
}
