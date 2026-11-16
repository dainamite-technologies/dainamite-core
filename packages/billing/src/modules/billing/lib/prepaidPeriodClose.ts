import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BillingAccount,
  BillingAccountBalance,
  BillingAccountTransaction,
  BillingItem,
  BillingStatement,
  BillingRun,
} from '../data/entities'
import {
  addDays,
  advanceNextBillDate,
  deriveBillPeriod,
  isCycleDue,
  shiftCycles,
  type BillPeriod,
} from './billPeriod'
import { accountCycleSpec } from './accountCycle'
import { applyBalanceMovement } from './balanceLedger'
import { resolveLowBalanceThreshold } from './balanceStatus'
import {
  buildInvoiceLinesFromItems,
  buildRecurringLineDescriptors,
  type InvoiceLineDescriptor,
} from './invoiceWriter'
import { shouldIncludeItem, type SelectableItem } from './itemSelector'
import { computeRecurringLines, type RecurringSkip } from './servicePeriods'
import { absMoney, addMoney, fromUnits, subMoney, toUnits } from './money'
import {
  getLowBalanceThresholdDefault,
  getNearLimitBufferDefault,
  getPrepaidTaxPoint,
  getStatementEnabled,
} from './prepaidConfig'
import {
  buildVatSummary,
  resolvePrepaidDebit,
  type PrepaidDebit,
  type PrepaidTaxPoint,
  type VatSummaryRow,
} from './prepaidTaxPoint'
import { buildBalanceCrossingEvents, type DomainEvent } from './balanceEvents'
import { toIsoDate, toUtcMidnight } from './dateOnly'

/**
 * Prepaid period close (SPEC-002 P3, reworked by Spec F).
 *
 * A prepaid account never gets a payable draft invoice. For every due bill
 * date D (catch-up up to `asOfDate`, one rule for every trigger) the run:
 *   1. charges `recurring` items per their `charge_timing` and `prorate`
 *      (Spec F, F-D4 — the same `computeRecurringLines` the postpaid engine
 *      uses: in advance → `[D, D + cycle − 1]`, in arrears → `[D − cycle,
 *      D − 1]`) and `one_time` items on the first bill date whose window
 *      overlaps them, debiting the balance through the org's tax point
 *      (Spec F, F-D3 — `resolvePrepaidDebit`);
 *   2. builds a non-fiscal **BillingStatement** for `[D − cycle, D − 1]`
 *      (opening, top-ups, usage, charges taken at D, closing, per-line
 *      breakdown, VAT summary).
 *
 * Metered usage was rated + debited in real time during the period — it is
 * NOT re-rated here; the statement only summarises it.
 *
 * Bill date and item watermarks advance in memory, so test and dry runs
 * simulate every due cycle exactly like a real run; only persistence differs.
 *
 * Anti-duplicate guards: the per-item `billed_to_date` watermark, the
 * deterministic charge `source_ref`, and the statement unique
 * `(bill_account_id, period_start, period_end)`. A statement that already
 * exists for a period means that period was closed: the run skips the
 * statement, still applies (idempotent) charges, and advances — it never
 * leaves the account stuck behind an existing statement.
 */

export type PrepaidCloseMode = 'real' | 'test' | 'dry'

export type PrepaidCycleStatus = 'charged' | 'previewed' | 'empty' | 'skipped_existing'

/** Same shape as the postpaid `CycleRecord` (Spec F, P-D6) plus prepaid fields. */
export type PrepaidCycleRecord = {
  bill_date: string
  period_start: string
  period_end: string
  status: PrepaidCycleStatus
  line_count: number
  total_net: string
  /** What left the balance for this bill date (gross in `consumption` mode). */
  total_debit: string
  invoice_id: null
  statement_id: string | null
}

export type PrepaidSkippedItem = {
  item_id: string
  reason: string
  service_period_start: string | null
  service_period_end: string | null
}

export type PrepaidAccountWarnings = {
  skipped_items?: PrepaidSkippedItem[]
  catch_up_cap_reached?: boolean
}

export type PrepaidAccountResult =
  | {
      status: 'success' | 'success_with_warnings' | 'skipped_existing_statement'
      warnings: PrepaidAccountWarnings | null
      statementId: string | null
      cyclesEmitted: number
      cycles: PrepaidCycleRecord[]
      statementEvents: DomainEvent[]
    }
  | { status: 'failed'; errorMessage: string }

const CATCH_UP_HARD_CAP = 60
const SKIPPED_ITEMS_WARNING_CAP = 200
/** Skip reasons that are normal state, not worth surfacing on the outcome. */
const QUIET_SKIP_REASONS = new Set(['item-inactive', 'item-soft-deleted'])

export type ProcessPrepaidParams = {
  asOfDate: Date
  mode: PrepaidCloseMode
  triggeredBy: 'schedule' | 'manual'
}

type ChargeLine = {
  descriptor: InvoiceLineDescriptor
  amounts: PrepaidDebit
  sourceRef: string
}

type CycleContext = {
  mode: PrepaidCloseMode
  taxPoint: PrepaidTaxPoint
  statementEnabled: boolean
  threshold: string
  nearLimitBuffer: string
  creditLimit: string
}

function chargeSourceRef(line: InvoiceLineDescriptor, kind: 'charge' | 'credit'): string {
  if (line.billingType === 'one_time') return `one_time-${line.billingItemId}`
  const start = line.servicePeriodStart ? toIsoDate(line.servicePeriodStart) : 'na'
  const end = line.servicePeriodEnd ? toIsoDate(line.servicePeriodEnd) : 'na'
  return `recurring-${line.billingItemId}-${kind}-${start}-${end}`
}

function money4(value: number): string {
  return fromUnits(Math.round(value * 10000))
}

function toSkipWarning(skip: RecurringSkip): PrepaidSkippedItem {
  return {
    item_id: skip.billingItemId,
    reason: skip.reason,
    service_period_start: skip.servicePeriodStart ? toIsoDate(skip.servicePeriodStart) : null,
    service_period_end: skip.servicePeriodEnd ? toIsoDate(skip.servicePeriodEnd) : null,
  }
}

function toCharge(descriptor: InvoiceLineDescriptor, kind: 'charge' | 'credit', taxPoint: PrepaidTaxPoint): ChargeLine {
  return {
    descriptor,
    amounts: resolvePrepaidDebit({
      lineAmount: descriptor.lineAmount,
      priceBasis: descriptor.priceBasis,
      taxRate: descriptor.taxRate,
      taxPoint,
    }),
    sourceRef: chargeSourceRef(descriptor, kind),
  }
}

export async function processPrepaidAccount(
  em: EntityManager,
  account: BillingAccount,
  billRun: BillingRun,
  params: ProcessPrepaidParams,
): Promise<PrepaidAccountResult> {
  const scope = { tenantId: account.tenantId, organizationId: account.organizationId }
  const cycle = accountCycleSpec(account)
  const balanceRow = await em.findOne(BillingAccountBalance, {
    tenantId: account.tenantId,
    billAccountId: account.id,
  })
  const ctx: CycleContext = {
    mode: params.mode,
    taxPoint: await getPrepaidTaxPoint(em, scope),
    statementEnabled: await getStatementEnabled(em, scope),
    threshold: resolveLowBalanceThreshold(
      balanceRow?.lowBalanceThreshold ?? null,
      await getLowBalanceThresholdDefault(em, scope),
    ),
    nearLimitBuffer: await getNearLimitBufferDefault(em, scope),
    creditLimit: account.creditLimit ?? '0',
  }

  const items = (await em.find(BillingItem, {
    tenantId: account.tenantId,
    organizationId: account.organizationId,
    billAccountId: account.id,
    deletedAt: null,
  } as never)) as BillingItem[]
  const recurringItems = items.filter((it) => it.type === 'recurring')
  const oneTimeItems = items.filter((it) => it.type === 'one_time')

  // In-memory cycle state — persisted per cycle only in real mode.
  const watermarks = new Map<string, Date | null>(
    recurringItems.map((it) => [it.id, it.billedToDate ? toUtcMidnight(it.billedToDate) : null]),
  )
  const billedOneTimes = new Set<string>(oneTimeItems.filter((it) => it.billedToDate).map((it) => it.id))
  let billDate = toUtcMidnight(account.nextBillDate)
  // End of the last closed period — starts the next one (alignment periods).
  let lastBilled: Date | null = account.lastBillDate ? toUtcMidnight(account.lastBillDate) : null
  // Chain opening → closing across cycles. Null on the first cycle →
  // resolved from the prior statement / ledger.
  let previousClosing: string | null = null

  const cycles: PrepaidCycleRecord[] = []
  const skippedItems: PrepaidSkippedItem[] = []
  const warnings: PrepaidAccountWarnings = {}
  const statementEvents: DomainEvent[] = []
  let lastStatementId: string | null = null

  const pushSkips = (skips: readonly RecurringSkip[]) => {
    for (const skip of skips) {
      if (QUIET_SKIP_REASONS.has(skip.reason)) continue
      if (skippedItems.length < SKIPPED_ITEMS_WARNING_CAP) skippedItems.push(toSkipWarning(skip))
    }
  }

  while (isCycleDue(billDate, params.asOfDate)) {
    if (cycles.length >= CATCH_UP_HARD_CAP) {
      warnings.catch_up_cap_reached = true
      break
    }
    const nextBillDate = advanceNextBillDate(billDate, cycle)
    const period = deriveBillPeriod(billDate, cycle, lastBilled)

    // ── Recurring: service periods against the in-memory watermarks ──
    const charges: ChargeLine[] = []
    const watermarkUpdates = new Map<string, Date | null>()
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
      const descriptors = buildRecurringLineDescriptors(item, computed.lines)
      descriptors.forEach((descriptor, index) => {
        charges.push(toCharge(descriptor, computed.lines[index]?.kind ?? 'charge', ctx.taxPoint))
      })
    }

    // ── One-time: first bill date whose [D − cycle, D + cycle − 1] window
    //    overlaps (same rule as postpaid) ──
    const oneTimeWindow: BillPeriod = {
      periodStart: shiftCycles(billDate, cycle, -1),
      periodEnd: addDays(nextBillDate, -1),
    }
    const oneTimesThisCycle = oneTimeItems.filter(
      (it) => !billedOneTimes.has(it.id) && shouldIncludeItem(it as SelectableItem, oneTimeWindow).include,
    )
    for (const descriptor of buildInvoiceLinesFromItems(oneTimesThisCycle)) {
      charges.push(toCharge(descriptor, 'charge', ctx.taxPoint))
    }

    const closed = await closePrepaidPeriod(em, account, billRun, { billDate, period, charges, previousClosing }, ctx)
    previousClosing = closed.closingBalance
    statementEvents.push(...closed.events)
    if (closed.statementId) lastStatementId = closed.statementId
    cycles.push(closed.record)

    // Advance the in-memory state (every mode); persist in real mode only.
    for (const [itemId, watermark] of watermarkUpdates) watermarks.set(itemId, watermark)
    for (const item of oneTimesThisCycle) billedOneTimes.add(item.id)
    if (params.mode === 'real') {
      const now = new Date()
      for (const item of recurringItems) {
        if (!watermarkUpdates.has(item.id)) continue
        item.billedToDate = watermarkUpdates.get(item.id) ?? null
        item.updatedAt = now
      }
      for (const item of oneTimesThisCycle) {
        item.billedToDate = period.periodEnd
        item.updatedAt = now
      }
      account.nextBillDate = nextBillDate
      account.lastBillDate = period.periodEnd
      account.updatedAt = now
      await em.flush()
    }
    billDate = nextBillDate
    lastBilled = period.periodEnd
  }

  const finalWarnings: PrepaidAccountWarnings = {
    ...warnings,
    ...(skippedItems.length ? { skipped_items: skippedItems } : {}),
  }
  return {
    status: warnings.catch_up_cap_reached ? 'success_with_warnings' : 'success',
    warnings: Object.keys(finalWarnings).length ? finalWarnings : null,
    statementId: lastStatementId,
    cyclesEmitted: cycles.filter((c) => c.status === 'charged' || c.status === 'previewed').length,
    cycles,
    statementEvents,
  }
}

type ClosePeriodInput = {
  billDate: Date
  period: BillPeriod
  charges: ChargeLine[]
  previousClosing: string | null
}

type ClosePeriodResult = {
  record: PrepaidCycleRecord
  /** The statement CREATED by this close (null when skipped or not written). */
  statementId: string | null
  closingBalance: string
  events: DomainEvent[]
}

type DebitBreakdownEntry = {
  billing_item_id: string
  billing_type: string
  description: string
  quantity: string
  /** What left the balance (kept as `amount` for older statement readers). */
  amount: string
  net: string
  tax: string
  tax_rate: string
  service_period_start: string | null
  service_period_end: string | null
  proration: unknown
}

async function closePrepaidPeriod(
  em: EntityManager,
  account: BillingAccount,
  billRun: BillingRun,
  input: ClosePeriodInput,
  ctx: CycleContext,
): Promise<ClosePeriodResult> {
  const { period, charges } = input
  const periodStartIso = toIsoDate(period.periodStart)
  const periodEndIso = toIsoDate(period.periodEnd)

  // Statement anti-duplicate (real only — test / dry never write statements).
  // Date-only parameters go as ISO strings (P-D5).
  const existingStatement =
    ctx.mode === 'real'
      ? await em.findOne(BillingStatement, {
          tenantId: account.tenantId,
          billAccountId: account.id,
          periodStart: periodStartIso,
          periodEnd: periodEndIso,
        } as never)
      : null

  // Ledger window of this statement: (previous bill date, this bill date] —
  // i.e. from the day after the previous bill date up to and including the
  // bill date D itself. Charges are taken AT D, so money that arrives on D
  // (a top-up made on the bill date) belongs to the same statement as the
  // charges — never an opening balance that pretends the account was short.
  // Consecutive windows stay contiguous: [D_prev + 1, D + 1).
  const windowStart = addDays(period.periodStart, 1)
  const windowEnd = addDays(input.billDate, 1) // exclusive upper bound
  const openingBalance = await resolveOpeningBalance(em, account, windowStart, period, input.previousClosing)
  const totalTopups = await sumByTypeInWindow(em, account, 'topup', windowStart, windowEnd)
  const totalUsage = absMoney(await sumByTypeInWindow(em, account, 'usage', windowStart, windowEnd))
  // Manual adjustments / reversals in the window — SIGNED. A first-class term
  // so the statement stays self-consistent and the chain never drifts.
  const totalAdjustments = addMoney(
    await sumByTypeInWindow(em, account, 'adjustment', windowStart, windowEnd),
    await sumByTypeInWindow(em, account, 'reversal', windowStart, windowEnd),
  )

  let totalRecurring = '0.0000'
  let totalNet = '0.0000'
  const breakdown: DebitBreakdownEntry[] = []
  const chargeTransactionIds: string[] = []
  let balanceBefore: string | null = null
  let balanceAfter: string | null = null

  for (const charge of charges) {
    const { descriptor, amounts } = charge
    const debit = money4(amounts.debit)
    totalRecurring = addMoney(totalRecurring, debit)
    totalNet = addMoney(totalNet, money4(amounts.net))
    const metadata = {
      bill_date: toIsoDate(input.billDate),
      bill_period_start: periodStartIso,
      bill_period_end: periodEndIso,
      bill_run_id: billRun.id,
      service_period_start: descriptor.servicePeriodStart ? toIsoDate(descriptor.servicePeriodStart) : null,
      service_period_end: descriptor.servicePeriodEnd ? toIsoDate(descriptor.servicePeriodEnd) : null,
      net: money4(amounts.net),
      tax: money4(amounts.tax),
      tax_rate: String(amounts.taxRate),
      tax_point: ctx.taxPoint,
      ...(descriptor.metadataExtra ?? {}),
    }
    breakdown.push({
      billing_item_id: descriptor.billingItemId,
      billing_type: descriptor.billingType,
      description: descriptor.description,
      quantity: descriptor.quantity,
      amount: debit,
      net: metadata.net,
      tax: metadata.tax,
      tax_rate: metadata.tax_rate,
      service_period_start: metadata.service_period_start,
      service_period_end: metadata.service_period_end,
      proration: (descriptor.metadataExtra as { proration?: unknown } | undefined)?.proration ?? null,
    })
    if (ctx.mode !== 'real') continue
    const movement = await applyBalanceMovement(em, {
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      billAccountId: account.id,
      currencyCode: account.currencyCode,
      // Credits back (an item ended inside a charged period) stay typed as the
      // charge they reverse: adjustments are summed by date window on
      // statements and would be counted twice.
      type: descriptor.billingType === 'one_time' ? 'one_time' : 'recurring',
      amount: fromUnits(-toUnits(debit)),
      description: descriptor.description,
      billingItemId: descriptor.billingItemId,
      sourceRef: charge.sourceRef,
      metadata,
    })
    if (balanceBefore === null) balanceBefore = movement.balanceBefore
    balanceAfter = movement.balanceAfter
    if (!movement.deduplicated) chargeTransactionIds.push(movement.transaction.id)
  }
  if (ctx.mode === 'real' && charges.length > 0) await em.flush()

  // closing = opening + top-ups + adjustments − usage − charges.
  const closingBalance = subMoney(
    subMoney(addMoney(addMoney(openingBalance, totalTopups), totalAdjustments), totalUsage),
    totalRecurring,
  )
  const vatSummary: VatSummaryRow[] = buildVatSummary(
    charges.map((c) => c.amounts),
    ctx.taxPoint,
  )

  const events: DomainEvent[] =
    balanceBefore !== null && balanceAfter !== null
      ? buildBalanceCrossingEvents({
          scope: {
            billAccountId: account.id,
            tenantId: account.tenantId,
            organizationId: account.organizationId,
            currencyCode: account.currencyCode,
          },
          balanceBefore,
          balanceAfter,
          threshold: ctx.threshold,
          creditLimit: ctx.creditLimit,
          nearLimitBuffer: ctx.nearLimitBuffer,
        })
      : []

  let createdStatementId: string | null = null
  if (ctx.mode === 'real' && ctx.statementEnabled && !existingStatement) {
    const now = new Date()
    const statement = em.create(BillingStatement, {
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      billAccountId: account.id,
      billRunId: billRun.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      currencyCode: account.currencyCode,
      openingBalance,
      totalTopups,
      totalUsage,
      totalRecurring,
      totalAdjustments,
      closingBalance,
      debitBreakdown: { items: breakdown, bill_date: toIsoDate(input.billDate), tax_point: ctx.taxPoint },
      vatSummary,
      status: 'generated',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(statement)
    await em.flush()
    createdStatementId = statement.id
    if (chargeTransactionIds.length > 0) {
      await em.nativeUpdate(
        BillingAccountTransaction,
        { id: { $in: chargeTransactionIds } } as never,
        { statementId: createdStatementId } as never,
      )
    }
    events.push({
      id: 'billing.statement.generated',
      payload: {
        statementId: createdStatementId,
        billAccountId: account.id,
        tenantId: account.tenantId,
        organizationId: account.organizationId,
        billRunId: billRun.id,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        currencyCode: account.currencyCode,
        openingBalance,
        closingBalance,
        totalTopups,
        totalUsage,
        totalRecurring,
        totalAdjustments,
      },
    })
  }

  let status: PrepaidCycleStatus
  if (ctx.mode !== 'real') status = charges.length > 0 ? 'previewed' : 'empty'
  else if (existingStatement && chargeTransactionIds.length === 0) status = 'skipped_existing'
  else status = chargeTransactionIds.length > 0 ? 'charged' : 'empty'

  return {
    record: {
      bill_date: toIsoDate(input.billDate),
      period_start: periodStartIso,
      period_end: periodEndIso,
      status,
      line_count: charges.length,
      total_net: totalNet,
      total_debit: totalRecurring,
      invoice_id: null,
      statement_id: createdStatementId ?? existingStatement?.id ?? null,
    },
    statementId: createdStatementId,
    closingBalance,
    events,
  }
}

/**
 * Resolve a period's opening balance by chaining from the prior statement's
 * closing (the spec's "chains cleanly"), with a ledger fallback for the very
 * first statement. Charges are stamped at run time (after the window), so a
 * `SUM(amount WHERE created_at < period_start)` would drop the prior
 * period's charges and break the chain. Resolution order:
 *   1. previous cycle's closing (catch-up, in this run),
 *   2. the prior persisted statement's closing (month-over-month),
 *   3. the ledger balance before the first-ever statement window.
 */
async function resolveOpeningBalance(
  em: EntityManager,
  account: BillingAccount,
  windowStart: Date,
  period: BillPeriod,
  previousClosing: string | null,
): Promise<string> {
  if (previousClosing !== null) return previousClosing
  const prior = await em.findOne(
    BillingStatement,
    {
      tenantId: account.tenantId,
      organizationId: account.organizationId,
      billAccountId: account.id,
      periodEnd: { $lt: toIsoDate(period.periodStart) },
    } as never,
    { orderBy: { periodEnd: 'DESC' } },
  )
  if (prior) return fromUnits(toUnits(prior.closingBalance))
  // First-ever statement: the ledger balance just before its window (only
  // top-ups / usage exist before the first close, so created_at is safe).
  return sumAmountsBefore(em, account, windowStart)
}

/** Balance at `before` = SUM(amount) of transactions created strictly before it. */
async function sumAmountsBefore(em: EntityManager, account: BillingAccount, before: Date): Promise<string> {
  const rows = (await em.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_account_transactions
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
        AND deleted_at IS NULL AND created_at < ?`,
    [account.tenantId, account.organizationId, account.id, before],
  )) as unknown as Array<{ total: string }>
  return fromUnits(toUnits(rows?.[0]?.total ?? 0))
}

/** SUM(amount) for one transaction type within [from, to). */
async function sumByTypeInWindow(
  em: EntityManager,
  account: BillingAccount,
  type: string,
  from: Date,
  to: Date,
): Promise<string> {
  const rows = (await em.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_account_transactions
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ?
        AND deleted_at IS NULL AND type = ?
        AND created_at >= ? AND created_at < ?`,
    [account.tenantId, account.organizationId, account.id, type, from, to],
  )) as unknown as Array<{ total: string }>
  return fromUnits(toUnits(rows?.[0]?.total ?? 0))
}
