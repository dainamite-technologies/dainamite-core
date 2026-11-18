import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingPayment, BillingPaymentImport } from '../data/entities'
import { withAccountLock } from './accountLock'
import {
  allocate,
  applyAccountCredit,
  emptyEffects,
  loadOpenReceivables,
  mergeEffects,
  toCents,
  type AllocationEffects,
  type ArScope,
} from './allocation'
import { parsePaymentCsv, sourceRefsForRows, type PaymentCsvRow } from './paymentCsv'
import { extractInvoiceTokens, matchPayment, type MatchDecision, type MatchableDocument } from './paymentMatcher'

/**
 * CSV payment import (Spec C, C-D4):
 *
 *   1. parse (row errors are reported, never fatal);
 *   2. duplicate guard — one query for the file's source refs (P-D7);
 *   3. one batched invoice-number lookup for every token of the file (P-D6);
 *   4. create the import batch + one `BillingPayment` per new row;
 *   5. per account, inside `withAccountLock`: allocate to the referenced
 *      invoices (oldest due first), then spend any remainder as credit on the
 *      account's other open receivables (D12);
 *   6. finalise the batch counts from the payments' final statuses.
 *
 * Returns the summary plus the allocation effects; the caller emits events
 * after everything committed.
 */

export type ImportCounts = {
  allocated: number
  partially_allocated: number
  matched: number
  unmatched: number
  duplicate: number
  rejected: number
}

export type ImportSummary = {
  importId: string
  fileName: string
  rowCount: number
  counts: ImportCounts
  errors: Array<{ row: number; message: string }>
}

const MAX_STORED_ERRORS = 200

async function existingSourceRefs(em: EntityManager, scope: ArScope, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const rows = (await em.execute(
    `SELECT source_ref FROM billing_payments
      WHERE tenant_id = ? AND organization_id = ? AND deleted_at IS NULL AND source_ref = ANY(?::text[])`,
    [scope.tenantId, scope.organizationId, `{${refs.map((r) => `"${r}"`).join(',')}}`],
  )) as unknown as Array<{ source_ref: string }>
  return new Set((rows ?? []).map((row) => row.source_ref))
}

/** Batched lookup of every number-like token of the file (one query). */
export async function lookupDocumentsByNumber(
  em: EntityManager,
  scope: ArScope,
  references: Array<string | null>,
): Promise<Map<string, MatchableDocument>> {
  const tokens = [...new Set(references.flatMap((ref) => extractInvoiceTokens(ref)))]
  if (tokens.length === 0) return new Map()
  const rows = (await em.execute(
    `SELECT i.id, i.number, i.bill_account_id, a.billing_mode, i.currency_code, i.document_type, i.status, i.outstanding
       FROM billing_invoices i
       JOIN billing_accounts a ON a.id = i.bill_account_id AND a.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND i.organization_id = ? AND i.deleted_at IS NULL AND i.test_run = false
        AND i.series IS NOT NULL
        AND upper(i.number) = ANY(?::text[])`,
    [scope.tenantId, scope.organizationId, `{${tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(',')}}`],
  )) as unknown as Array<{
    id: string
    number: string
    bill_account_id: string
    billing_mode: string
    currency_code: string
    document_type: string
    status: string
    outstanding: string
  }>
  const map = new Map<string, MatchableDocument>()
  for (const row of rows ?? []) {
    map.set(row.number.toUpperCase(), {
      invoiceId: row.id,
      number: row.number,
      billAccountId: row.bill_account_id,
      billingMode: row.billing_mode,
      currencyCode: row.currency_code,
      documentType: row.document_type,
      status: row.status,
      outstanding: row.outstanding,
    })
  }
  return map
}

type Planned = { payment: BillingPayment; decision: MatchDecision }

/** Allocates one matched payment inside the account lock (referenced invoices first, then credit). */
async function settlePayment(tem: EntityManager, scope: ArScope, planned: Planned): Promise<AllocationEffects> {
  const effects = emptyEffects()
  const { payment, decision } = planned
  if (decision.outcome === 'unmatched') return effects
  const account = { id: decision.billAccountId, currencyCode: payment.currencyCode }
  const source = { type: 'payment' as const, id: payment.id }
  if (decision.outcome === 'allocate') {
    let available = toCents(payment.amount)
    const receivables = await loadOpenReceivables(tem, scope, account, decision.invoiceIds)
    for (const receivable of receivables) {
      if (available <= 0) break
      const take = Math.min(available, receivable.outstandingCents)
      if (take <= 0) continue
      mergeEffects(effects, await allocate(tem, scope, { source, invoiceId: receivable.id, amountCents: take, by: 'auto' }))
      available -= take
    }
  }
  mergeEffects(effects, await applyAccountCredit(tem, scope, account, { onlySources: [source] }))
  return effects
}

export async function importPayments(
  em: EntityManager,
  params: { scope: ArScope; fileName: string; content: string; userId?: string | null },
): Promise<{ summary: ImportSummary; effects: AllocationEffects; paymentIds: string[] }> {
  const { scope } = params
  const parsed = parsePaymentCsv(params.content)
  if (parsed.fatal) {
    throw new CrudHttpError(400, { error: parsed.fatal, code: 'billing.payment_import.invalid_file' })
  }
  const refs = sourceRefsForRows(scope, parsed.rows)
  const existing = await existingSourceRefs(em, scope, refs)
  const fresh: Array<{ row: PaymentCsvRow; sourceRef: string }> = []
  let duplicates = 0
  parsed.rows.forEach((row, i) => {
    if (existing.has(refs[i])) duplicates += 1
    else fresh.push({ row, sourceRef: refs[i] })
  })

  const documents = await lookupDocumentsByNumber(em, scope, fresh.map((f) => f.row.reference))
  const now = new Date()
  const batch = em.create(BillingPaymentImport, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fileName: params.fileName,
    rowCount: parsed.rows.length + parsed.errors.length,
    userId: params.userId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(batch)
  await em.flush()

  const planned: Planned[] = fresh.map(({ row, sourceRef }) => {
    const decision = matchPayment({ reference: row.reference, currency: row.currency }, documents)
    const payment = em.create(BillingPayment, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      receivedAt: new Date(`${row.receivedAt}T00:00:00Z`),
      amount: row.amount,
      currencyCode: row.currency,
      reference: row.reference,
      payerName: row.payerName,
      payerAccount: row.payerAccount,
      source: 'csv',
      importId: batch.id,
      billAccountId: decision.billAccountId,
      status: decision.outcome === 'unmatched' ? 'unmatched' : 'matched',
      unallocatedAmount: row.amount,
      matchReason: decision.outcome === 'allocate' ? null : decision.reason,
      sourceRef,
      metadata: { csv_line: row.line },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(payment)
    return { payment, decision }
  })
  await em.flush()

  // Settle per account, one lock per account (operations queue per account).
  const effects = emptyEffects()
  const byAccount = new Map<string, Planned[]>()
  for (const item of planned) {
    if (item.decision.outcome === 'unmatched') continue
    const list = byAccount.get(item.decision.billAccountId) ?? []
    list.push(item)
    byAccount.set(item.decision.billAccountId, list)
  }
  for (const [billAccountId, items] of byAccount) {
    await withAccountLock(em, { tenantId: scope.tenantId, billAccountId }, async (tem) => {
      for (const item of items) mergeEffects(effects, await settlePayment(tem, scope, item))
    })
  }

  const paymentIds = planned.map((p) => p.payment.id)
  const statuses = paymentIds.length
    ? ((await em.execute(
        `SELECT status, COUNT(*)::int AS n FROM billing_payments
          WHERE tenant_id = ? AND organization_id = ? AND import_id = ? GROUP BY status`,
        [scope.tenantId, scope.organizationId, batch.id],
      )) as unknown as Array<{ status: string; n: number }>)
    : []
  const count = (status: string) => Number(statuses.find((s) => s.status === status)?.n ?? 0)
  const counts: ImportCounts = {
    allocated: count('allocated'),
    partially_allocated: count('partially_allocated'),
    matched: count('matched'),
    unmatched: count('unmatched'),
    duplicate: duplicates,
    rejected: parsed.errors.length,
  }
  const errors = parsed.errors.slice(0, MAX_STORED_ERRORS)
  await em.nativeUpdate(BillingPaymentImport, { id: batch.id } as never, { counts, errors, updatedAt: new Date() } as never)

  return {
    summary: { importId: batch.id, fileName: params.fileName, rowCount: batch.rowCount, counts, errors },
    effects,
    paymentIds,
  }
}
