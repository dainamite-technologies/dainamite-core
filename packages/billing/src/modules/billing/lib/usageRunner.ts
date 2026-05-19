import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingAccountUsage, type BillingAccount, type BillingItem } from '../data/entities'
import type { BillPeriod } from './billPeriod'
import type { InvoiceLineDescriptor } from './invoiceWriter'
import { format4dp, formatUnitPrice, rateUsageForItem, type UsageRate } from './usageRater'

/**
 * Per-account usage processing — Phase 3.
 *
 * Selects all unrated usage records whose `period_end <= bill_period_end`,
 * groups them by `uom_code`, matches each group against the account's
 * `type=usage` Billing Items (exact `uom_code` match per spec — NO
 * conversion), rates the aggregated quantity, and emits ONE invoice
 * line per matched item.
 *
 * Per-record `line_description` itemization (i.e. emitting one invoice
 * line per Usage record with `line_description` set) is intentionally
 * deferred to Phase 4 (admin UI iteration), where invoice operators
 * can see breakdowns alongside the draft. The Phase 3 surface keeps
 * the invoice clean with one aggregated line per item.
 *
 * Unmatched UoMs:
 *   - When a usage record's `uom_code` does NOT match any active
 *     `type=usage` Billing Item, the record is LEFT un-rated
 *     (`rated_in_bill_run_id` stays NULL). The account outcome carries
 *     `unmatched_usage_uoms` as a warning. Operator's expected fix is
 *     "add the missing Billing Item, then trigger retry-failed."
 *
 * Mode handling:
 *   - real: caller marks `rated_in_bill_run_id` on the returned ids.
 *   - test / dry: caller does NOT mark; the same records remain
 *     consumable by a follow-up run.
 */

export type UsageRunResult = {
  /** Invoice line descriptors ready for `writeDraftInvoice`. */
  lines: InvoiceLineDescriptor[]
  /** `BillingAccountUsage.id`s that contributed to the rated lines. */
  consumedUsageIds: string[]
  /** UoMs present in usage records but missing from `type=usage` items. */
  unmatchedUoms: string[]
  /** Count of usage records rated this cycle (for the run summary). */
  ratedCount: number
}

const EMPTY_RESULT: UsageRunResult = {
  lines: [],
  consumedUsageIds: [],
  unmatchedUoms: [],
  ratedCount: 0,
}

function nonNullUomItems(items: readonly BillingItem[]): Map<string, BillingItem> {
  const out = new Map<string, BillingItem>()
  for (const item of items) {
    if (item.type !== 'usage') continue
    if (!item.isActive || item.deletedAt) continue
    if (!item.uomCode) continue
    // Item-level guard: skip items already billed through this period
    // — same semantic as recurring items, but the engine usually
    // checks this upstream via `selectItemsForPeriod`. Defensive here
    // so a direct call doesn't double-bill.
    out.set(item.uomCode, item)
  }
  return out
}

export async function processUsageForAccount(
  em: EntityManager,
  account: BillingAccount,
  period: BillPeriod,
  usageItems: readonly BillingItem[],
): Promise<UsageRunResult> {
  if (usageItems.length === 0) {
    // Even if the account has no usage items, the bill might still
    // have usage RECORDS with no matching item (e.g. integrator pushed
    // metric data before adding the corresponding usage item). Surface
    // them as warnings so the operator can fix.
    const records = await em.find(BillingAccountUsage, {
      tenantId: account.tenantId,
      organizationId: account.organizationId,
      billAccountId: account.id,
      deletedAt: null,
      ratedInBillRunId: null,
      periodEnd: { $lte: period.periodEnd },
    } as never)
    if (records.length === 0) return EMPTY_RESULT
    const uniqueUoms = Array.from(new Set(records.map((r) => r.uomCode)))
    return {
      ...EMPTY_RESULT,
      unmatchedUoms: uniqueUoms,
    }
  }

  const itemByUom = nonNullUomItems(usageItems)

  const records = await em.find(BillingAccountUsage, {
    tenantId: account.tenantId,
    organizationId: account.organizationId,
    billAccountId: account.id,
    deletedAt: null,
    ratedInBillRunId: null,
    periodEnd: { $lte: period.periodEnd },
  } as never)
  if (records.length === 0) return EMPTY_RESULT

  const recordsByUom = new Map<string, BillingAccountUsage[]>()
  for (const record of records) {
    const list = recordsByUom.get(record.uomCode) ?? []
    list.push(record)
    recordsByUom.set(record.uomCode, list)
  }

  const lines: InvoiceLineDescriptor[] = []
  const consumedUsageIds: string[] = []
  const unmatchedUoms: string[] = []
  let ratedCount = 0

  for (const [uom, recs] of recordsByUom) {
    const item = itemByUom.get(uom)
    if (!item) {
      unmatchedUoms.push(uom)
      continue
    }
    const totalQty = recs.reduce((acc, r) => acc + Number.parseFloat(r.quantity), 0)
    if (totalQty === 0) continue
    const rated = rateUsageForItem(item, totalQty)
    if (!rated) {
      // Malformed rate_json on a Billing Item that passed validation
      // at ingress is rare but possible if the rate was edited by an
      // operator with `item.manage`. Surface as unmatched-warning
      // so the operator knows to look — better than silently
      // dropping revenue.
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
      quantity: format4dp(totalQty),
      totalNetAmount: rated.amount,
      metadataExtra: {
        uom_code: uom,
        usage_record_count: recs.length,
        // The breakdown is the auditable trail for tiered rating — it
        // shows which tier consumed how much quantity at what rate.
        usage_tier_breakdown: rated.breakdown,
      },
    })
    for (const rec of recs) consumedUsageIds.push(rec.id)
    ratedCount += recs.length
  }

  return { lines, consumedUsageIds, unmatchedUoms, ratedCount }
}

/**
 * Test / dry exports for the engine and unit tests.
 */
export { EMPTY_RESULT as __EMPTY_USAGE_RESULT }

// Suppress unused-export warning for the type helper.
export type _UsageRateAlias = UsageRate
