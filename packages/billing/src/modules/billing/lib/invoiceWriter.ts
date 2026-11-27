import type { EntityManager } from '@mikro-orm/postgresql'
import { BillingInvoice, BillingInvoiceLine } from '../data/entities'
import type { BillingAccount, BillingItem } from '../data/entities'
import type { BillPeriod } from './billPeriod'
import type { RecurringLine } from './servicePeriods'
import { draftNumber, testNumber } from './numbering'
import { sumTotals } from './vat'
import { lineVat, priceBasisOf, unitPriceNetOf, type PriceBasis } from './lineAmounts'
import { parseCreditReason, type CreditReason } from './creditReason'

/**
 * Writes a billing-owned draft invoice (`billing_invoices` +
 * `billing_invoice_lines`) for one bill date of an account — Spec 0: billing
 * no longer records anything in core `sales`.
 *
 *   - Real drafts get a temporary `DRAFT-…` number; the series number is
 *     claimed only at post (gap-free numbering — no number is burnt by a
 *     deleted draft).
 *   - Test drafts get `TEST-…` and `test_run = true`; they are never posted.
 *   - Spec B (B-D2): every line carries its item's VAT rate; tax is rounded
 *     per line (half-up, 2 dp) and totals are sums of the rounded lines.
 *   - Spec F (F-D2): line amounts are on the item's `price_basis`; net / tax
 *     / gross come from `lineVat`, so a typed gross is reproduced exactly.
 */

export type WriteMode = 'real' | 'test' | 'dry'

export type InvoiceLineDescriptor = {
  /** Maps to `billing_invoice_lines.billing_item_id`. */
  billingItemId: string
  /** From the spec's `metadata.billing_type` for traceability. */
  billingType: 'one_time' | 'recurring' | 'usage'
  description: string
  /** Unit price on `priceBasis` (numeric string). The writer derives `unit_price_net`. */
  unitPrice: string
  /** Quantity (string for the numeric(18,4) column). */
  quantity: string
  /** Extended line amount on `priceBasis` (unit × quantity × proration). */
  lineAmount: string
  /** Spec F: the basis `unitPrice` / `lineAmount` are on (the item's `price_basis`). */
  priceBasis: PriceBasis
  /** Spec B: VAT rate in percent (numeric string), from the item. */
  taxRate: string
  /** Optional per-line metadata extension — e.g. usage tier breakdown. */
  metadataExtra?: Record<string, unknown>
  /**
   * Spec A: inclusive service period the line covers (recurring + usage).
   * Written to line metadata and used for the invoice's display period.
   */
  servicePeriodStart?: Date
  servicePeriodEnd?: Date
}

export type WriteInvoiceParams = {
  mode: WriteMode
  account: BillingAccount
  /** Spec A: the bill date this invoice is for — the dedupe key. */
  billDate: Date
  /** Display period: min/max of the line service periods (see `displayPeriod`). */
  period: BillPeriod
  billRunId: string
  lines: InvoiceLineDescriptor[]
}

export type WrittenInvoice = {
  invoiceId: string | null
  invoiceNumber: string | null
  totalNet: string
  totalGross: string
}

/** @deprecated kept for test-suite compatibility; the writer has no cache any more. */
export function __resetInvoiceWriterCacheForTests(): void {}

/** 2dp half-up rounding (survives 1.005-style binary edges). */
function roundHalfUp2dp(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

function format4dp(value: number): string {
  return roundHalfUp2dp(value).toFixed(4)
}

/** VAT rate of an item as a numeric string; items predating Spec B read as 0. */
export function itemTaxRate(item: Pick<BillingItem, 'taxRate'>): string {
  const rate = Number.parseFloat(String(item.taxRate ?? '0'))
  return Number.isFinite(rate) && rate >= 0 ? String(rate) : '0'
}

function isoDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10)
}

export async function writeDraftInvoice(
  em: EntityManager,
  params: WriteInvoiceParams,
): Promise<WrittenInvoice> {
  const amounts = params.lines.map((line) =>
    lineVat({ amount: line.lineAmount, priceBasis: line.priceBasis, taxRate: line.taxRate }),
  )
  const totals = sumTotals(amounts)

  if (params.mode === 'dry') {
    // Compute totals; persist nothing.
    return { invoiceId: null, invoiceNumber: null, totalNet: totals.subtotalNet, totalGross: totals.totalGross }
  }

  const { account, period, billRunId, lines, mode } = params
  const invoiceNumber = mode === 'test' ? testNumber() : draftNumber()
  const now = new Date()

  const invoice = em.create(BillingInvoice, {
    organizationId: account.organizationId,
    tenantId: account.tenantId,
    billAccountId: account.id,
    documentType: 'invoice',
    number: invoiceNumber,
    series: null,
    status: 'draft',
    testRun: mode === 'test',
    billRunId,
    billDate: params.billDate,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    currencyCode: account.currencyCode,
    subtotalNet: totals.subtotalNet,
    taxTotal: totals.taxTotal,
    totalGross: totals.totalGross,
    paidTotal: '0',
    creditedTotal: '0',
    outstanding: totals.totalGross,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(invoice)
  await em.flush() // need the invoice id for the lines

  lines.forEach((line, index) => {
    const amount = amounts[index]
    em.persist(
      em.create(BillingInvoiceLine, {
        organizationId: account.organizationId,
        tenantId: account.tenantId,
        invoiceId: invoice.id,
        lineNumber: index + 1,
        billingItemId: line.billingItemId,
        billingType: line.billingType,
        description: line.description,
        quantity: line.quantity,
        unitPriceNet:
          line.priceBasis === 'gross' ? unitPriceNetOf(line.unitPrice, 'gross', line.taxRate) : line.unitPrice,
        taxRate: line.taxRate,
        netAmount: format4dp(amount.net),
        taxAmount: format4dp(amount.tax),
        grossAmount: format4dp(amount.gross),
        servicePeriodStart: line.servicePeriodStart ?? null,
        servicePeriodEnd: line.servicePeriodEnd ?? null,
        metadata: line.metadataExtra ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    )
  })
  await em.flush()

  return { invoiceId: invoice.id, invoiceNumber, totalNet: totals.subtotalNet, totalGross: totals.totalGross }
}

/**
 * Build the InvoiceLineDescriptor list for a single account's eligible
 * items (the result of `itemSelector.selectItemsForPeriod`). One line
 * per item; `usage` items are excluded earlier by the selector.
 *
 * Per-type pricing per the spec's `BillingItem → InvoiceLine mapping`:
 *   - `one_time`: unit_price = amount, quantity = 1
 *   - `recurring`: unit_price = unit_price, quantity = 1
 *     (one full cycle per bill period; catch-up emits separate drafts
 *     per missed cycle, never combined)
 */
export function buildInvoiceLinesFromItems(
  items: readonly BillingItem[],
): InvoiceLineDescriptor[] {
  const lines: InvoiceLineDescriptor[] = []
  for (const item of items) {
    if (item.type === 'one_time') {
      const rate = item.rateJson as { amount?: number } | null
      if (!rate || typeof rate.amount !== 'number') continue
      // For one_time the per-unit price IS the total — quantity is 1.
      // Both fields therefore carry the same value, with the 2dp
      // half-up policy applied (unit price + line total are the same
      // numeric column at numeric(18,4)).
      const amount = format4dp(rate.amount)
      lines.push({
        billingItemId: item.id,
        billingType: 'one_time',
        description: item.description,
        unitPrice: amount,
        quantity: '1',
        lineAmount: amount,
        priceBasis: priceBasisOf(item.priceBasis),
        taxRate: itemTaxRate(item),
      })
    } else if (item.type === 'recurring') {
      const rate = item.rateJson as { unit_price?: number } | null
      if (!rate || typeof rate.unit_price !== 'number') continue
      const unitPrice = format4dp(rate.unit_price)
      lines.push({
        billingItemId: item.id,
        billingType: 'recurring',
        description: item.description,
        unitPrice,
        quantity: '1',
        lineAmount: unitPrice,
        priceBasis: priceBasisOf(item.priceBasis),
        taxRate: itemTaxRate(item),
      })
    }
  }
  return lines
}

/**
 * Display period of an invoice: min start / max end over the lines' service
 * periods, falling back to `fallback` (the arrears window) when no line
 * carries one (e.g. a one_time-only invoice).
 */
export function displayPeriod(lines: readonly InvoiceLineDescriptor[], fallback: BillPeriod): BillPeriod {
  let start: Date | null = null
  let end: Date | null = null
  for (const line of lines) {
    if (line.servicePeriodStart && (!start || line.servicePeriodStart < start)) start = line.servicePeriodStart
    if (line.servicePeriodEnd && (!end || line.servicePeriodEnd > end)) end = line.servicePeriodEnd
  }
  return { periodStart: start ?? fallback.periodStart, periodEnd: end ?? fallback.periodEnd }
}

/**
 * Spec A: invoice lines for computed recurring service periods (charges and
 * credits). Full-period charges keep the bare item description; partial
 * periods and credits append the covered dates so the line is
 * self-explanatory on any document (language-neutral — the PDF renders
 * localized labels later).
 */
export function buildRecurringLineDescriptors(
  item: Pick<BillingItem, 'id' | 'description' | 'chargeTiming' | 'taxRate' | 'priceBasis'> &
    Partial<Pick<BillingItem, 'creditReason' | 'billingPeriodUnit' | 'billingPeriodInterval'>>,
  lines: readonly RecurringLine[],
): InvoiceLineDescriptor[] {
  // Part 2 (D8): the customer-facing reason travels with the credit lines,
  // frozen into line metadata at bill time.
  const creditReason = parseCreditReason(item.creditReason ?? null)
  const ownPeriod = Boolean(item.billingPeriodUnit)
  return lines.map((line) => {
    const amount = format4dp(line.amount)
    const quantity = line.quantity ?? 1
    const unitAmount = format4dp(line.unitAmount ?? line.amount)
    const phase = line.phase ?? null
    const reason = line.reason ?? null
    // Dated when the line is not one plain full account period: prorated,
    // credit, phased ("Internet — Promo 50% · …"), grouped or on its own period.
    const dated = line.proration !== null || line.kind === 'credit' || phase !== null || quantity > 1 || ownPeriod || reason !== null
    const label = phase?.name ? `${item.description} — ${phase.name}` : item.description
    const lineReason = reason ? statusCreditReason(reason) : line.kind === 'credit' ? creditReason : null
    return {
      billingItemId: item.id,
      billingType: 'recurring' as const,
      description: dated ? `${label} · ${isoDate(line.servicePeriodStart)} – ${isoDate(line.servicePeriodEnd)}` : label,
      unitPrice: quantity > 1 ? unitAmount : amount,
      quantity: String(quantity),
      lineAmount: amount,
      // Proration and credit lines inherit the item's rate (Spec B) and basis (Spec F).
      priceBasis: priceBasisOf(item.priceBasis),
      taxRate: itemTaxRate(item),
      servicePeriodStart: line.servicePeriodStart,
      servicePeriodEnd: line.servicePeriodEnd,
      metadataExtra: {
        charge_timing: item.chargeTiming,
        ...(line.proration
          ? { proration: { active_days: line.proration.activeDays, period_days: line.proration.periodDays } }
          : {}),
        ...(quantity > 1 || ownPeriod
          ? {
              billing_period: {
                unit: item.billingPeriodUnit ?? null,
                interval: item.billingPeriodInterval ?? null,
                count: quantity,
              },
            }
          : {}),
        ...(phase
          ? { phase: { sequence: phase.index, name: phase.name, price_type: phase.priceType, value: phase.value } }
          : {}),
        ...(reason
          ? {
              item_status: {
                status_period_id: reason.statusPeriodId,
                status: reason.status,
                from_date: isoDate(reason.fromDate),
                to_date: reason.toDate ? isoDate(reason.toDate) : null,
                effect: reason.kind === 'status' ? 'credit' : 'recharge',
              },
            }
          : {}),
        ...(line.kind === 'credit' ? { credit_for: item.id } : {}),
        ...(lineReason ? { credit_reason: lineReason } : {}),
      },
    }
  })
}

/** Credit reason of a status line: the operator's words, else "Paused 10 Jan – 19 Jan" (rendered per language). */
function statusCreditReason(reason: NonNullable<RecurringLine['reason']>): CreditReason {
  if (reason.text) return { kind: 'text', text: reason.text }
  return {
    kind: 'code',
    code: reason.kind === 'status_reversal' ? 'item_status_reversed' : reason.status === 'suspended' ? 'item_suspended' : 'item_paused',
    params: {
      effectiveDate: isoDate(reason.fromDate),
      ...(reason.toDate ? { untilDate: isoDate(reason.toDate) } : {}),
    },
  }
}
