import type { EntityManager } from '@mikro-orm/postgresql'
import { type BillingAccount, type BillingItem } from '../data/entities'
import type { BillPeriod } from './billPeriod'
import type { InvoiceLineDescriptor } from './invoiceWriter'
import { format4dp, formatUnitPrice, rateUsageForItem, type UsageRate } from './usageRater'

/**
 * Per-account usage processing — Phase 3.
 *
 * ## Scale design
 *
 * This module's hot path runs once per account per Bill Run. For
 * telco / infra customers the spec's "Shape B" scenario projects
 * **millions of usage records per account per cycle**. A naive
 * `em.find(BillingAccountUsage, …)` materialises every row in JS
 * memory before we can sum, which OOMs on those tenants.
 *
 * Phase 4f refactor: replace the load-all-then-aggregate path with a
 * single Postgres `GROUP BY uom_code` aggregate. Memory is now bounded
 * by `O(distinct uom_codes per account)` (a small number, typically
 * 1-20) rather than `O(records)`. The corresponding "mark as rated"
 * UPDATE happens engine-side via a `uom_code IN (…)` predicate so we
 * never enumerate ids into memory either.
 *
 * ## Spec behaviour
 *
 * Selects all unrated usage records whose `period_end <= bill_period_end`,
 * groups them by `uom_code`, matches each group against the account's
 * `type=usage` Billing Items (exact `uom_code` match per spec — NO
 * conversion), rates the aggregated quantity, and emits ONE invoice
 * line per matched item.
 *
 * Per-record `line_description` itemization is deferred to a follow-up
 * (would require a non-aggregate path; the engine keeps the invoice
 * clean with one aggregated line per item for now).
 *
 * Unmatched UoMs:
 *   - When usage records exist for a `uom_code` that does NOT match
 *     any active `type=usage` Billing Item, those records are LEFT
 *     un-rated (`rated_in_bill_run_id` stays NULL) and the uom is
 *     surfaced in `unmatchedUoms` so the account outcome carries it
 *     as `success_with_warnings`. Operator's fix: add the missing
 *     Billing Item, then trigger retry-failed.
 *
 * Mode handling:
 *   - real: the engine marks `rated_in_bill_run_id` on records matching
 *     the returned `matchedUoms` via a single bulk UPDATE.
 *   - test / dry: the engine skips the UPDATE; same usage stays
 *     consumable by a follow-up run.
 */

export type UsageRunResult = {
  /** Invoice line descriptors ready for `writeDraftInvoice`. */
  lines: InvoiceLineDescriptor[]
  /**
   * `uom_code`s the engine should mark as rated. The engine issues a
   * single `UPDATE ... WHERE uom_code IN (matchedUoms) AND <scope>`
   * after this returns — no id list materialisation.
   */
  matchedUoms: string[]
  /** UoMs present in usage records but missing from `type=usage` items. */
  unmatchedUoms: string[]
  /** Count of usage records rated this cycle (for the run summary). */
  ratedCount: number
}

const EMPTY_RESULT: UsageRunResult = {
  lines: [],
  matchedUoms: [],
  unmatchedUoms: [],
  ratedCount: 0,
}

function nonNullUomItems(items: readonly BillingItem[]): Map<string, BillingItem> {
  const out = new Map<string, BillingItem>()
  for (const item of items) {
    if (item.type !== 'usage') continue
    if (!item.isActive || item.deletedAt) continue
    if (!item.uomCode) continue
    out.set(item.uomCode, item)
  }
  return out
}

type UsageAggregateRow = {
  uom_code: string
  total_quantity: string
  record_count: string
}

/**
 * Single Postgres aggregate: bucket unrated usage records by `uom_code`,
 * sum the quantities, count the records. Returns one row per uom — a
 * small, bounded result set regardless of how many millions of records
 * the account actually has.
 *
 * The matching index is the partial index on
 * `(bill_account_id, uom_code, rated_in_bill_run_id, period_end)` shipped
 * in Phase 0's migration — both the filter and the GROUP BY land on
 * the same index.
 */
async function fetchUsageAggregate(
  em: EntityManager,
  account: BillingAccount,
  period: BillPeriod,
): Promise<UsageAggregateRow[]> {
  const rows = (await em.execute(
    `SELECT uom_code,
            SUM(quantity)::text AS total_quantity,
            COUNT(*)::text     AS record_count
     FROM billing_account_usage
     WHERE tenant_id = ?
       AND organization_id = ?
       AND bill_account_id = ?
       AND deleted_at IS NULL
       AND rated_in_bill_run_id IS NULL
       AND period_end <= ?
     GROUP BY uom_code`,
    [account.tenantId, account.organizationId, account.id, period.periodEnd],
  )) as unknown as UsageAggregateRow[] | undefined
  return rows ?? []
}

export async function processUsageForAccount(
  em: EntityManager,
  account: BillingAccount,
  period: BillPeriod,
  usageItems: readonly BillingItem[],
): Promise<UsageRunResult> {
  const aggregateRows = await fetchUsageAggregate(em, account, period)
  if (aggregateRows.length === 0) return EMPTY_RESULT

  const itemByUom = nonNullUomItems(usageItems)

  const lines: InvoiceLineDescriptor[] = []
  const matchedUoms: string[] = []
  const unmatchedUoms: string[] = []
  let ratedCount = 0

  for (const row of aggregateRows) {
    const uom = row.uom_code
    const totalQuantity = Number.parseFloat(row.total_quantity)
    const recordCount = Number.parseInt(row.record_count, 10)

    const item = itemByUom.get(uom)
    if (!item) {
      unmatchedUoms.push(uom)
      continue
    }
    if (!Number.isFinite(totalQuantity) || totalQuantity === 0) continue

    const rated = rateUsageForItem(item, totalQuantity)
    if (!rated) {
      // Malformed rate_json on a passing-validation item is rare but
      // possible if an operator hand-edited it. Surface as unmatched
      // so the operator knows to look rather than silently dropping
      // revenue.
      unmatchedUoms.push(uom)
      continue
    }

    const isSimpleFlat = !('model' in (item.rateJson as Record<string, unknown>))
    const unitPriceNet = isSimpleFlat
      ? formatUnitPrice((item.rateJson as { unit_price: number }).unit_price)
      : '0'
    lines.push({
      billingItemId: item.id,
      billingType: 'usage',
      description: item.description,
      unitPriceNet,
      quantity: format4dp(totalQuantity),
      totalNetAmount: rated.amount,
      metadataExtra: {
        uom_code: uom,
        usage_record_count: recordCount,
        usage_tier_breakdown: rated.breakdown,
      },
    })
    matchedUoms.push(uom)
    ratedCount += Number.isFinite(recordCount) ? recordCount : 0
  }

  return { lines, matchedUoms, unmatchedUoms, ratedCount }
}

export { EMPTY_RESULT as __EMPTY_USAGE_RESULT }

// Suppress unused-export warning for the type alias.
export type _UsageRateAlias = UsageRate
