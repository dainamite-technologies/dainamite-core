import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingAllocation } from '../data/entities'
import type { AllocatedBy, AllocationSourceType } from '../data/validators'

/**
 * Allocation service (Spec C; generalised for Spec D credit memos).
 *
 * An allocation moves money from a SOURCE (`payment` → `billing_payments`, or
 * `credit_memo` → a posted credit memo in `billing_invoices`) to a receivable
 * (`invoice` / `debit_memo`). Rules:
 *
 *   - Receivable amounts are RECOMPUTED from Σ active allocations, never
 *     incremented: `paid_total` (payment sources), `credited_total` (credit
 *     memo sources), `outstanding = gross − paid − credited`, status
 *     `posted | partially_paid | paid | credited` (P-D2, Spec D P-D3).
 *   - A source's unallocated amount (payment `unallocated_amount`, credit memo
 *     `outstanding`) is decremented with a guarded UPDATE, so it can never go
 *     negative even if a caller forgets the account lock.
 *   - Callers hold `withAccountLock` (P-D3); every function here takes the
 *     transactional EntityManager of that lock.
 *   - Unallocated money of an account is ACCOUNT CREDIT; `applyAccountCredit`
 *     spends it on open receivables, oldest due date first (D12, P-D5).
 *
 * Money is handled in integer cents internally (2 dp documents).
 */

// ─── Pure helpers ────────────────────────────────────────────────

export function toCents(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value ?? '0')
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(4)
}

export type OpenReceivable = {
  id: string
  outstandingCents: number
  dueDate: string | null
  issueDate: string | null
  number: string
}

/** Oldest due date first (nulls last), then issue date, then number. */
export function sortOpenReceivables<T extends Omit<OpenReceivable, 'outstandingCents'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    if (a.issueDate !== b.issueDate) {
      if (!a.issueDate) return 1
      if (!b.issueDate) return -1
      return a.issueDate < b.issueDate ? -1 : 1
    }
    return a.number.localeCompare(b.number)
  })
}

/** Spreads `amountCents` over receivables in the given order, never above outstanding. */
export function planAllocation(
  amountCents: number,
  receivables: ReadonlyArray<Pick<OpenReceivable, 'id' | 'outstandingCents'>>,
): { allocations: Array<{ invoiceId: string; amountCents: number }>; remainderCents: number } {
  let remaining = Math.max(0, amountCents)
  const allocations: Array<{ invoiceId: string; amountCents: number }> = []
  for (const receivable of receivables) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Math.max(0, receivable.outstandingCents))
    if (take <= 0) continue
    allocations.push({ invoiceId: receivable.id, amountCents: take })
    remaining -= take
  }
  return { allocations, remainderCents: remaining }
}

export type ReceivableState = {
  status: string
  totalGrossCents: number
  paidCents: number
  creditedCents: number
}

/** Paid / credited / outstanding / status of a receivable from its allocation sums. */
export function recomputeReceivable(state: ReceivableState): {
  paidCents: number
  creditedCents: number
  outstandingCents: number
  status: string
} {
  const { totalGrossCents: gross, paidCents: paid, creditedCents: credited } = state
  const outstandingCents = Math.max(0, gross - paid - credited)
  if (state.status === 'draft') return { paidCents: paid, creditedCents: credited, outstandingCents, status: 'draft' }
  let status: string
  if (gross > 0 && outstandingCents === 0) status = credited >= gross ? 'credited' : 'paid'
  else if (paid + credited > 0) status = 'partially_paid'
  else status = 'posted'
  return { paidCents: paid, creditedCents: credited, outstandingCents, status }
}

/** Payment status from its allocation state (terminal / unmatched states are kept). */
export function paymentStatusFor(payment: {
  status: string
  billAccountId: string | null | undefined
  amountCents: number
  unallocatedCents: number
}): string {
  if (payment.status === 'ignored' || payment.status === 'converted_to_topup') return payment.status
  if (!payment.billAccountId) return 'unmatched'
  if (payment.unallocatedCents <= 0) return 'allocated'
  if (payment.unallocatedCents < payment.amountCents) return 'partially_allocated'
  return 'matched'
}

// ─── Effects (emitted by callers after commit) ───────────────────

export type InvoiceStatusChange = { invoiceId: string; from: string; to: string }

export type AllocationEffects = {
  created: Array<{ allocationId: string; sourceType: AllocationSourceType; sourceId: string; invoiceId: string; amount: string }>
  removed: Array<{ allocationId: string; sourceType: AllocationSourceType; sourceId: string; invoiceId: string; amount: string }>
  invoiceStatusChanges: InvoiceStatusChange[]
}

export function emptyEffects(): AllocationEffects {
  return { created: [], removed: [], invoiceStatusChanges: [] }
}

export function mergeEffects(target: AllocationEffects, extra: AllocationEffects): AllocationEffects {
  target.created.push(...extra.created)
  target.removed.push(...extra.removed)
  target.invoiceStatusChanges.push(...extra.invoiceStatusChanges)
  return target
}

// ─── DB service (inside withAccountLock) ─────────────────────────

export type ArScope = { tenantId: string; organizationId: string }

export type AllocationSource = { type: AllocationSourceType; id: string }

type ReceivableRow = {
  id: string
  bill_account_id: string
  currency_code: string
  status: string
  document_type: string
  test_run: boolean
  total_gross: string
  outstanding: string
  due_date: string | null
  issue_date: string | null
  number: string
}

type SourceRow = {
  id: string
  bill_account_id: string | null
  currency_code: string
  unallocated: string
  status: string
}

const RECEIVABLE_TYPES = ['invoice', 'debit_memo']
const OPEN_STATUSES = ['posted', 'partially_paid']

function isoDay(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

async function loadReceivable(tem: EntityManager, scope: ArScope, invoiceId: string): Promise<ReceivableRow | null> {
  const rows = (await tem.execute(
    `SELECT id, bill_account_id, currency_code, status, document_type, test_run, total_gross, outstanding,
            due_date, issue_date, number
       FROM billing_invoices
      WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [invoiceId, scope.tenantId, scope.organizationId],
  )) as unknown as ReceivableRow[]
  return rows?.[0] ?? null
}

async function loadSource(tem: EntityManager, scope: ArScope, source: AllocationSource): Promise<SourceRow | null> {
  const sql =
    source.type === 'payment'
      ? `SELECT id, bill_account_id, currency_code, unallocated_amount AS unallocated, status
           FROM billing_payments
          WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`
      : `SELECT id, bill_account_id, currency_code, outstanding AS unallocated, status
           FROM billing_invoices
          WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL
            AND document_type = 'credit_memo'`
  const rows = (await tem.execute(sql, [source.id, scope.tenantId, scope.organizationId])) as unknown as SourceRow[]
  return rows?.[0] ?? null
}

/** Guarded decrement (negative `deltaCents` restores). 0 rows → insufficient. */
async function adjustSourceUnallocated(
  tem: EntityManager,
  scope: ArScope,
  source: AllocationSource,
  deltaCents: number,
): Promise<boolean> {
  const amount = fromCents(Math.abs(deltaCents))
  if (source.type === 'payment') {
    const rows = (await tem.execute(
      deltaCents >= 0
        ? `UPDATE billing_payments
              SET unallocated_amount = unallocated_amount - ?::numeric, updated_at = now()
            WHERE id = ? AND tenant_id = ? AND organization_id = ? AND unallocated_amount >= ?::numeric
          RETURNING id`
        : `UPDATE billing_payments
              SET unallocated_amount = LEAST(amount, unallocated_amount + ?::numeric), updated_at = now()
            WHERE id = ? AND tenant_id = ? AND organization_id = ?
          RETURNING id`,
      deltaCents >= 0
        ? [amount, source.id, scope.tenantId, scope.organizationId, amount]
        : [amount, source.id, scope.tenantId, scope.organizationId],
    )) as unknown as Array<{ id: string }>
    if (!rows?.length) return false
    await tem.execute(
      `UPDATE billing_payments
          SET status = CASE
                WHEN unallocated_amount <= 0 THEN 'allocated'
                WHEN unallocated_amount < amount THEN 'partially_allocated'
                ELSE 'matched' END
        WHERE id = ? AND status IN ('matched', 'partially_allocated', 'allocated')`,
      [source.id],
    )
    return true
  }
  // Credit memo: its `outstanding` is the unallocated credit (Spec D, P-D5).
  const rows = (await tem.execute(
    deltaCents >= 0
      ? `UPDATE billing_invoices
            SET outstanding = outstanding - ?::numeric,
                status = CASE WHEN outstanding - ?::numeric <= 0 THEN 'paid' ELSE 'posted' END,
                updated_at = now()
          WHERE id = ? AND tenant_id = ? AND organization_id = ? AND document_type = 'credit_memo'
            AND outstanding >= ?::numeric
        RETURNING id`
      : `UPDATE billing_invoices
            SET outstanding = LEAST(total_gross, outstanding + ?::numeric), status = 'posted', updated_at = now()
          WHERE id = ? AND tenant_id = ? AND organization_id = ? AND document_type = 'credit_memo'
        RETURNING id`,
    deltaCents >= 0
      ? [amount, amount, source.id, scope.tenantId, scope.organizationId, amount]
      : [amount, source.id, scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ id: string }>
  return Boolean(rows?.length)
}

/** Recomputes paid / credited / outstanding / status of a receivable from its active allocations. */
export async function recomputeInvoice(
  tem: EntityManager,
  scope: ArScope,
  invoiceId: string,
): Promise<InvoiceStatusChange | null> {
  const invoice = await loadReceivable(tem, scope, invoiceId)
  if (!invoice || !RECEIVABLE_TYPES.includes(invoice.document_type)) return null
  const sums = (await tem.execute(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE source_type = 'payment'), 0) AS paid,
            COALESCE(SUM(amount) FILTER (WHERE source_type = 'credit_memo'), 0) AS credited
       FROM billing_allocations
      WHERE invoice_id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [invoiceId, scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ paid: string; credited: string }>
  const next = recomputeReceivable({
    status: invoice.status,
    totalGrossCents: toCents(invoice.total_gross),
    paidCents: toCents(sums?.[0]?.paid),
    creditedCents: toCents(sums?.[0]?.credited),
  })
  await tem.execute(
    `UPDATE billing_invoices
        SET paid_total = ?::numeric, credited_total = ?::numeric, outstanding = ?::numeric, status = ?, updated_at = now()
      WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
    [
      fromCents(next.paidCents),
      fromCents(next.creditedCents),
      fromCents(next.outstandingCents),
      next.status,
      invoiceId,
      scope.tenantId,
      scope.organizationId,
    ],
  )
  return next.status !== invoice.status ? { invoiceId, from: invoice.status, to: next.status } : null
}

export async function allocate(
  tem: EntityManager,
  scope: ArScope,
  params: { source: AllocationSource; invoiceId: string; amountCents: number; by: AllocatedBy; userId?: string | null },
): Promise<AllocationEffects> {
  const effects = emptyEffects()
  if (params.amountCents <= 0) {
    throw new CrudHttpError(400, { error: 'Allocation amount must be positive', code: 'billing.allocation.invalid_amount' })
  }
  const [source, invoice] = await Promise.all([
    loadSource(tem, scope, params.source),
    loadReceivable(tem, scope, params.invoiceId),
  ])
  if (!source) throw new CrudHttpError(404, { error: 'Payment source not found', code: 'billing.allocation.source_missing' })
  if (!invoice) throw new CrudHttpError(404, { error: 'Invoice not found', code: 'billing.allocation.invoice_missing' })
  if (!source.bill_account_id || source.bill_account_id !== invoice.bill_account_id) {
    throw new CrudHttpError(409, {
      error: 'Payment and invoice belong to different accounts',
      code: 'billing.allocation.account_mismatch',
    })
  }
  if (source.currency_code !== invoice.currency_code) {
    throw new CrudHttpError(409, { error: 'Currencies differ', code: 'billing.allocation.currency_mismatch' })
  }
  if (
    invoice.test_run ||
    !RECEIVABLE_TYPES.includes(invoice.document_type) ||
    !OPEN_STATUSES.includes(invoice.status)
  ) {
    throw new CrudHttpError(409, { error: 'Invoice is not open for payment', code: 'billing.allocation.invoice_not_open' })
  }
  if (params.amountCents > toCents(invoice.outstanding)) {
    throw new CrudHttpError(409, {
      error: 'Allocation exceeds the invoice outstanding amount',
      code: 'billing.allocation.exceeds_outstanding',
    })
  }
  const decremented = await adjustSourceUnallocated(tem, scope, params.source, params.amountCents)
  if (!decremented) {
    throw new CrudHttpError(409, {
      error: 'Not enough unallocated amount',
      code: 'billing.allocation.insufficient_unallocated',
    })
  }
  const now = new Date()
  const row = tem.create(BillingAllocation, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    sourceType: params.source.type,
    sourceId: params.source.id,
    invoiceId: params.invoiceId,
    billAccountId: invoice.bill_account_id,
    amount: fromCents(params.amountCents),
    currencyCode: invoice.currency_code,
    allocatedBy: params.by,
    userId: params.userId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  tem.persist(row)
  await tem.flush()
  effects.created.push({
    allocationId: row.id,
    sourceType: params.source.type,
    sourceId: params.source.id,
    invoiceId: params.invoiceId,
    amount: row.amount,
  })
  const change = await recomputeInvoice(tem, scope, params.invoiceId)
  if (change) effects.invoiceStatusChanges.push(change)
  return effects
}

export async function unallocate(
  tem: EntityManager,
  scope: ArScope,
  params: { allocationId: string; userId?: string | null },
): Promise<AllocationEffects> {
  const effects = emptyEffects()
  const rows = (await tem.execute(
    `UPDATE billing_allocations
        SET deleted_at = now(), updated_at = now(), deallocated_by_user_id = ?
      WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL
    RETURNING id, source_type, source_id, invoice_id, amount`,
    [params.userId ?? null, params.allocationId, scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ id: string; source_type: AllocationSourceType; source_id: string; invoice_id: string; amount: string }>
  const removed = rows?.[0]
  if (!removed) throw new CrudHttpError(404, { error: 'Allocation not found', code: 'billing.allocation.not_found' })
  await adjustSourceUnallocated(tem, scope, { type: removed.source_type, id: removed.source_id }, -toCents(removed.amount))
  effects.removed.push({
    allocationId: removed.id,
    sourceType: removed.source_type,
    sourceId: removed.source_id,
    invoiceId: removed.invoice_id,
    amount: removed.amount,
  })
  const change = await recomputeInvoice(tem, scope, removed.invoice_id)
  if (change) effects.invoiceStatusChanges.push(change)
  return effects
}

/** Open receivables of an account in auto-apply order. */
export async function loadOpenReceivables(
  tem: EntityManager,
  scope: ArScope,
  account: { id: string; currencyCode: string },
  onlyIds?: string[],
): Promise<OpenReceivable[]> {
  const params: unknown[] = [scope.tenantId, scope.organizationId, account.id, account.currencyCode]
  let idFilter = ''
  if (onlyIds && onlyIds.length > 0) {
    idFilter = ` AND id = ANY(?::uuid[])`
    params.push(`{${onlyIds.join(',')}}`)
  }
  const rows = (await tem.execute(
    `SELECT id, outstanding, due_date, issue_date, number
       FROM billing_invoices
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ? AND currency_code = ?
        AND deleted_at IS NULL AND test_run = false
        AND document_type IN ('invoice', 'debit_memo')
        AND status IN ('posted', 'partially_paid')
        AND outstanding > 0${idFilter}`,
    params,
  )) as unknown as Array<{ id: string; outstanding: string; due_date: unknown; issue_date: unknown; number: string }>
  return sortOpenReceivables(
    (rows ?? []).map((row) => ({
      id: row.id,
      outstandingCents: toCents(row.outstanding),
      dueDate: isoDay(row.due_date),
      issueDate: isoDay(row.issue_date),
      number: row.number,
    })),
  )
}

/** Credit sources of an account (unallocated payments + open credit memos), oldest first. */
export async function loadCreditSources(
  tem: EntityManager,
  scope: ArScope,
  account: { id: string; currencyCode: string },
): Promise<Array<{ source: AllocationSource; availableCents: number }>> {
  const rows = (await tem.execute(
    `SELECT 'payment' AS source_type, id, unallocated_amount AS available, received_at AS at, created_at
       FROM billing_payments
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ? AND currency_code = ?
        AND deleted_at IS NULL AND status IN ('matched', 'partially_allocated') AND unallocated_amount > 0
     UNION ALL
     SELECT 'credit_memo' AS source_type, id, outstanding AS available, issue_date AS at, created_at
       FROM billing_invoices
      WHERE tenant_id = ? AND organization_id = ? AND bill_account_id = ? AND currency_code = ?
        AND deleted_at IS NULL AND test_run = false AND document_type = 'credit_memo'
        AND status = 'posted' AND outstanding > 0
     ORDER BY at ASC, created_at ASC`,
    [
      scope.tenantId,
      scope.organizationId,
      account.id,
      account.currencyCode,
      scope.tenantId,
      scope.organizationId,
      account.id,
      account.currencyCode,
    ],
  )) as unknown as Array<{ source_type: AllocationSourceType; id: string; available: string }>
  return (rows ?? []).map((row) => ({
    source: { type: row.source_type, id: row.id },
    availableCents: toCents(row.available),
  }))
}

/**
 * Spends the account's credit on its open receivables (D12): sources oldest
 * first, receivables oldest due first. `onlySources` restricts the spend
 * (e.g. the payment just imported); default = all credit of the account.
 */
export async function applyAccountCredit(
  tem: EntityManager,
  scope: ArScope,
  account: { id: string; currencyCode: string },
  opts: { onlySources?: AllocationSource[]; by?: AllocatedBy } = {},
): Promise<AllocationEffects> {
  const effects = emptyEffects()
  let sources = await loadCreditSources(tem, scope, account)
  if (opts.onlySources) {
    const wanted = new Set(opts.onlySources.map((s) => `${s.type}:${s.id}`))
    sources = sources.filter((s) => wanted.has(`${s.source.type}:${s.source.id}`))
  }
  if (sources.length === 0) return effects
  const receivables = await loadOpenReceivables(tem, scope, account)
  for (const credit of sources) {
    let available = credit.availableCents
    for (const receivable of receivables) {
      if (available <= 0) break
      const take = Math.min(available, receivable.outstandingCents)
      if (take <= 0) continue
      mergeEffects(
        effects,
        await allocate(tem, scope, {
          source: credit.source,
          invoiceId: receivable.id,
          amountCents: take,
          by: opts.by ?? 'credit',
        }),
      )
      receivable.outstandingCents -= take
      available -= take
    }
  }
  return effects
}

/** Unapplied credit of an account (Σ unallocated payments + open credit memos). */
export async function getAccountCredit(
  em: EntityManager,
  scope: ArScope,
  account: { id: string; currencyCode: string },
): Promise<string> {
  const sources = await loadCreditSources(em, scope, account)
  return fromCents(sources.reduce((sum, s) => sum + s.availableCents, 0))
}
