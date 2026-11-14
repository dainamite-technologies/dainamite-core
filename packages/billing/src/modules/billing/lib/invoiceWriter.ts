import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  SalesInvoice,
  SalesInvoiceLine,
} from '@open-mercato/core/modules/sales/data/entities'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import type { BillingAccount, BillingItem } from '../data/entities'
import type { BillPeriod } from './billPeriod'
import type { RecurringLine } from './servicePeriods'
import {
  __resetInvoiceStatusCacheForTests,
  resolveInvoiceStatusEntryId,
} from './invoiceStatus'

/**
 * Writes a `core/sales` draft invoice for a billing account's bill period.
 *
 * Two notable deviations from the spec, documented in CHANGELOG / spec:
 *
 *   1. `SalesInvoice.invoice_number` is `NOT NULL` in the upstream
 *      schema, but the spec says "sequence number assigned at Post."
 *      Real-mode invoices get a real number via
 *      `salesDocumentNumberGenerator.generate({ kind: 'invoice' })` at
 *      *draft create time* — the spec's intent (gap-free numbering via
 *      atomic SQL upsert) is preserved; the timing differs because the
 *      upstream column is `NOT NULL`. "Post" then just transitions
 *      status `draft → posted`.
 *
 *   2. Test-mode invoices use a `TEST-<uuid>` placeholder number (not
 *      the real sequence) so test runs do not burn production numbers
 *      and can be repeated idempotently.
 *
 * VAT is NOT computed here — `core/sales`'s tax service owns the
 * per-line `tax_rate` / `tax_amount` calculation, and runs on POST.
 * Drafts therefore carry zeroes in the tax columns; the totals reflect
 * net amounts only.
 */

export type WriteMode = 'real' | 'test' | 'dry'

export type InvoiceLineDescriptor = {
  /** Maps to billing_item_id on the resulting SalesInvoiceLine.metadata. */
  billingItemId: string
  /** From the spec's `metadata.billing_type` for traceability. */
  billingType: 'one_time' | 'recurring' | 'usage'
  description: string
  /** Net unit price (numeric string for SalesInvoiceLine.unit_price_net). */
  unitPriceNet: string
  /** Quantity (string for the numeric(18,4) column). */
  quantity: string
  /** Total net (string). */
  totalNetAmount: string
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
}

const DRAFT_INVOICE_STATUS_VALUE = 'draft'

/**
 * Test hook — clears the shared resolver's status cache so the engine
 * test suite stays deterministic across mocked-EM environments.
 */
export function __resetInvoiceWriterCacheForTests(): void {
  __resetInvoiceStatusCacheForTests()
}

function generateTestInvoiceNumber(): string {
  // Match the pattern operators search by: `TEST-` prefix + random
  // suffix so the test wipe-out endpoint can filter via `LIKE 'TEST-%'`
  // (defensive — primary filter is `metadata.test_run=true`).
  const random = Math.floor(Math.random() * 1e9)
    .toString(16)
    .padStart(8, '0')
  return `TEST-${Date.now().toString(16)}-${random}`
}

/**
 * 2dp half-up rounding that survives binary floating-point edge cases
 * (e.g. `1.005 * 100 === 100.49999...` would otherwise round DOWN to
 * `1.00` under naive `Math.round`). The `+ EPSILON` nudge pushes
 * representations like 100.4999...8 up to the true half-up boundary.
 * Matches the spec's "2 decimal places, half-up" rounding policy.
 */
function roundHalfUp2dp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function format4dp(value: number): string {
  return roundHalfUp2dp(value).toFixed(4)
}

function sumNetTotal(lines: InvoiceLineDescriptor[]): string {
  let total = 0
  for (const line of lines) {
    total += Number.parseFloat(line.totalNetAmount)
  }
  return format4dp(total)
}

export async function writeDraftInvoice(
  em: EntityManager,
  container: AwilixContainer,
  params: WriteInvoiceParams,
): Promise<WrittenInvoice> {
  const totalNet = sumNetTotal(params.lines)

  if (params.mode === 'dry') {
    // Compute totals; persist nothing.
    return { invoiceId: null, invoiceNumber: null, totalNet }
  }

  const { account, period, billRunId, lines, mode } = params

  let invoiceNumber: string
  if (mode === 'test') {
    invoiceNumber = generateTestInvoiceNumber()
  } else {
    const numberGenerator = container.resolve(
      'salesDocumentNumberGenerator',
    ) as SalesDocumentNumberGenerator
    const generated = await numberGenerator.generate({
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      kind: 'invoice',
    })
    invoiceNumber = generated.number
  }

  const statusEntryId = await resolveInvoiceStatusEntryId(
    em,
    account.tenantId,
    account.organizationId,
    'draft',
  )

  const now = new Date()
  const invoice = em.create(SalesInvoice, {
    organizationId: account.organizationId,
    tenantId: account.tenantId,
    invoiceNumber,
    statusEntryId,
    status: DRAFT_INVOICE_STATUS_VALUE,
    issueDate: now,
    currencyCode: account.currencyCode,
    subtotalNetAmount: totalNet,
    subtotalGrossAmount: totalNet, // gross == net for drafts (tax computed on post)
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    grandTotalNetAmount: totalNet,
    grandTotalGrossAmount: totalNet,
    paidTotalAmount: '0',
    outstandingAmount: totalNet,
    metadata: {
      bill_run_id: billRunId,
      bill_account_id: account.id,
      bill_date: isoDate(params.billDate),
      bill_period_start: period.periodStart.toISOString().slice(0, 10),
      bill_period_end: period.periodEnd.toISOString().slice(0, 10),
      test_run: mode === 'test' ? true : undefined,
    },
    createdAt: now,
    updatedAt: now,
  })
  em.persist(invoice)

  let lineNumber = 1
  for (const line of lines) {
    const invoiceLine = em.create(SalesInvoiceLine, {
      invoice,
      organizationId: account.organizationId,
      tenantId: account.tenantId,
      lineNumber: lineNumber++,
      kind: 'product',
      description: line.description,
      quantity: line.quantity,
      normalizedQuantity: line.quantity,
      currencyCode: account.currencyCode,
      unitPriceNet: line.unitPriceNet,
      unitPriceGross: line.unitPriceNet, // gross == net until tax computed on post
      discountAmount: '0',
      discountPercent: '0',
      taxRate: '0',
      taxAmount: '0',
      totalNetAmount: line.totalNetAmount,
      totalGrossAmount: line.totalNetAmount,
      metadata: {
        billing_item_id: line.billingItemId,
        billing_type: line.billingType,
        ...(line.servicePeriodStart ? { service_period_start: isoDate(line.servicePeriodStart) } : {}),
        ...(line.servicePeriodEnd ? { service_period_end: isoDate(line.servicePeriodEnd) } : {}),
        ...(line.metadataExtra ?? {}),
      },
    })
    em.persist(invoiceLine)
  }

  await em.flush()

  return { invoiceId: invoice.id, invoiceNumber, totalNet }
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
        unitPriceNet: amount,
        quantity: '1',
        totalNetAmount: amount,
      })
    } else if (item.type === 'recurring') {
      const rate = item.rateJson as { unit_price?: number } | null
      if (!rate || typeof rate.unit_price !== 'number') continue
      const unitPrice = format4dp(rate.unit_price)
      lines.push({
        billingItemId: item.id,
        billingType: 'recurring',
        description: item.description,
        unitPriceNet: unitPrice,
        quantity: '1',
        totalNetAmount: unitPrice,
      })
    }
  }
  return lines
}

function isoDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10)
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
  item: Pick<BillingItem, 'id' | 'description' | 'chargeTiming'>,
  lines: readonly RecurringLine[],
): InvoiceLineDescriptor[] {
  return lines.map((line) => {
    const amount = format4dp(line.amount)
    const dated = line.proration !== null || line.kind === 'credit'
    return {
      billingItemId: item.id,
      billingType: 'recurring' as const,
      description: dated
        ? `${item.description} · ${isoDate(line.servicePeriodStart)} – ${isoDate(line.servicePeriodEnd)}`
        : item.description,
      unitPriceNet: amount,
      quantity: '1',
      totalNetAmount: amount,
      servicePeriodStart: line.servicePeriodStart,
      servicePeriodEnd: line.servicePeriodEnd,
      metadataExtra: {
        charge_timing: item.chargeTiming,
        ...(line.proration
          ? { proration: { active_days: line.proration.activeDays, period_days: line.proration.periodDays } }
          : {}),
        ...(line.kind === 'credit' ? { credit_for: item.id } : {}),
      },
    }
  })
}
