import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  BillingAccount,
  BillingDraftInvoiceEdit,
  BillingInvoice,
  BillingInvoiceLine,
} from '../data/entities'
import { emitBillingEvent, type BillingEventId } from '../events'
import { buildPostpaidCreditCrossingEvents } from '../lib/accountStatus'
import { buildSellerSnapshot, getBillingSettings, missingSellerFields, numberMaskFor, taxRateColumn } from '../lib/billingSettings'
import { claimDocumentNumber } from '../lib/numbering'
import { buildBuyerSnapshot } from '../lib/documentParties'
import { freezeInvoicePdf } from '../lib/pdf/invoicePdf'
import { accountLockKey } from '../lib/accountLock'
import { allocate, applyAccountCredit, emptyEffects, mergeEffects, toCents } from '../lib/allocation'
import { emitAllocationEffects } from '../lib/allocationEvents'
import { seriesFor } from '../lib/documentTypes'
import { creditFits, loadCorrectionTotals } from '../lib/memoGuards'
import { sendInvoice, type SendInvoiceResult } from '../lib/invoiceDelivery'
import { computeDueDate, resolvePaymentTermsDays } from '../lib/dueDate'
import { lineAmountsFromNet, sumTotals } from '../lib/vat'
import {
  billingInvoiceAddLineSchema,
  billingInvoiceEditLineSchema,
  billingInvoicePostSchema,
  billingInvoiceRemoveLineSchema,
  billingInvoiceSendSchema,
  billingWipeTestInvoicesSchema,
  type BillingInvoiceAddLineInput,
  type BillingInvoiceEditLineInput,
  type BillingInvoicePostInput,
  type BillingInvoiceRemoveLineInput,
  type BillingInvoiceSendInput,
  type BillingWipeTestInvoicesInput,
} from '../data/validators'

/**
 * Billing invoice commands (Spec 0 — billing-owned `billing_invoices`).
 *
 * Post:
 *   1. Refuses non-drafts and test-run drafts.
 *   2. Refuses when the seller settings are incomplete (Spec B, P-D4 — a
 *      posted invoice must be printable); no number is consumed.
 *   3. In ONE transaction: claims the next number of the `invoice` series
 *      (gap-free — a rollback releases it), freezes the buyer / seller
 *      snapshots, sets `issue_date`, `due_date` (issue + payment terms),
 *      `posted_at`, `outstanding = total_gross`, `status = posted`, and keeps
 *      the replaced `DRAFT-…` number in `metadata.draft_number`.
 *   4. After commit: freezes the PDF as an attachment (best effort), then
 *      fires `billing.invoice.posted` + one
 *      `billing.invoice.line_posted` per line, then the postpaid credit
 *      crossing events.
 *
 * Once posted a document is immutable; corrections are credit / debit memos
 * (Spec D). Draft lines can be edited / added / removed with an audit row.
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

type PostResult = {
  invoiceId: string
  invoiceNumber: string
  status: 'posted'
  lineCount: number
}

function isoDate(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString().slice(0, 10) : null
}

function todayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// Re-exported for existing callers; lives in lib/documentParties.ts (shared with the PDF).
export { buildBuyerSnapshot }

const postInvoiceCommand: CommandHandler<BillingInvoicePostInput, PostResult> = {
  id: 'billing.invoices.post',

  async execute(rawInput, ctx) {
    const parsed = billingInvoicePostSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }

    const em = getEm(ctx)
    const invoice = await em.findOne(BillingInvoice, {
      id: parsed.invoiceId,
      ...scope,
      deletedAt: null,
    } as never)
    if (!invoice) {
      throw new CrudHttpError(404, { error: 'Invoice not found' })
    }
    if (invoice.status !== 'draft') {
      throw new CrudHttpError(409, {
        error: 'Only draft invoices can be posted',
        code: 'billing.invoice.not_draft',
        currentStatus: invoice.status,
      })
    }
    if (invoice.testRun) {
      // Test invoices live for inspection only — posting them would leak test
      // data into accounting. Wipe them instead (POST /api/billing/test-invoices/wipe).
      throw new CrudHttpError(409, {
        error: 'Test-mode invoices cannot be posted',
        code: 'billing.invoice.test_run',
      })
    }

    const account = await em.findOne(BillingAccount, {
      id: invoice.billAccountId,
      ...scope,
    } as never)
    if (!account) {
      throw new CrudHttpError(409, { error: 'Billing account not found', code: 'billing.invoice.account_missing' })
    }
    const settings = await getBillingSettings(em, scope)
    const missing = missingSellerFields(settings)
    if (missing.length > 0) {
      throw new CrudHttpError(409, {
        error: 'Fill in the seller details in billing settings before posting invoices',
        code: 'billing.settings.incomplete',
        missing,
      })
    }
    const isCreditMemo = invoice.documentType === 'credit_memo'
    const series = seriesFor(invoice.documentType)
    const issueDate = todayUtc()
    // Receivables (invoices, debit memos) are due after the terms; a credit
    // memo is a credit source with no due date (Spec D).
    const dueDate = isCreditMemo
      ? null
      : computeDueDate(issueDate, resolvePaymentTermsDays(account.paymentTermsDays, settings.defaultPaymentTermsDays))
    const settlement = emptyEffects()

    try {
      await em.transactional(async (tem) => {
        // Re-read inside the transaction and lock the row, so two concurrent
        // posts of the same draft can't both claim a number.
        const target = await (tem as EntityManager).findOne(
          BillingInvoice,
          { id: invoice.id, ...scope, deletedAt: null } as never,
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        )
        if (!target || target.status !== 'draft') {
          throw new CrudHttpError(409, {
            error: 'Only draft invoices can be posted',
            code: 'billing.invoice.not_draft',
            currentStatus: target?.status ?? null,
          })
        }
        // Spec C/D: every receivables change of an account is serialised by
        // the per-account lock (same key as `withAccountLock`).
        await (tem as EntityManager).execute('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [
          accountLockKey({ tenantId: scope.tenantId, billAccountId: target.billAccountId }),
        ])
        let original: BillingInvoice | null = null
        if (isCreditMemo) {
          original = target.correctsInvoiceId
            ? await (tem as EntityManager).findOne(BillingInvoice, { id: target.correctsInvoiceId, ...scope, deletedAt: null } as never)
            : null
          if (!original) {
            throw new CrudHttpError(409, { error: 'The corrected invoice no longer exists', code: 'billing.memo.invalid_original' })
          }
          // Cumulative guard (P-D4), authoritative here under the lock.
          const corrections = await loadCorrectionTotals(tem as EntityManager, scope, original.id, { excludeId: target.id })
          if (!creditFits(toCents(original.totalGross), corrections, toCents(target.totalGross))) {
            throw new CrudHttpError(409, {
              error: 'The credit exceeds what is left to credit on this invoice',
              code: 'billing.memo.exceeds_invoice',
            })
          }
        }
        const claimed = await claimDocumentNumber(
          tem as EntityManager,
          scope,
          series,
          numberMaskFor(settings, series),
          issueDate,
        )
        const now = new Date()
        target.metadata = { ...(target.metadata ?? {}), draft_number: target.number }
        target.number = claimed.number
        target.series = series
        target.issueDate = issueDate
        target.dueDate = dueDate
        target.postedAt = now
        target.buyerSnapshot = buildBuyerSnapshot(account)
        target.sellerSnapshot = buildSellerSnapshot(settings)
        target.status = 'posted'
        target.paidTotal = '0'
        target.outstanding = target.totalGross
        target.updatedAt = now
        await tem.flush()
        if (isCreditMemo && original) {
          // Settle the corrected invoice first (P-D5), the remainder becomes
          // account credit spent on other open receivables (D12).
          const source = { type: 'credit_memo' as const, id: target.id }
          const take = Math.min(toCents(target.totalGross), toCents(original.outstanding))
          if (take > 0 && ['posted', 'partially_paid'].includes(original.status)) {
            mergeEffects(
              settlement,
              await allocate(tem as EntityManager, scope, { source, invoiceId: original.id, amountCents: take, by: 'credit' }),
            )
          }
          mergeEffects(
            settlement,
            await applyAccountCredit(tem as EntityManager, scope, { id: target.billAccountId, currencyCode: target.currencyCode }, {
              onlySources: [source],
            }),
          )
          const fresh = (await (tem as EntityManager).execute(
            `SELECT status, outstanding FROM billing_invoices WHERE id = ?`,
            [target.id],
          )) as unknown as Array<{ status: string; outstanding: string }>
          if (fresh?.[0]) {
            target.status = fresh[0].status
            target.outstanding = fresh[0].outstanding
          }
        }
        Object.assign(invoice, {
          number: target.number,
          series: target.series,
          issueDate: target.issueDate,
          dueDate: target.dueDate,
          metadata: target.metadata,
          buyerSnapshot: target.buyerSnapshot,
          sellerSnapshot: target.sellerSnapshot,
          postedAt: target.postedAt,
          status: target.status,
          outstanding: target.outstanding,
        })
      })
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        // The mask produced a number already issued (e.g. after a mask change
        // within a period). The transaction rolled back; nothing was posted.
        throw new CrudHttpError(409, {
          error: 'The invoice number mask produced a number that is already in use',
          code: 'billing.invoice.number_conflict',
        })
      }
      throw err
    }

    const lines = await em.find(BillingInvoiceLine, {
      invoiceId: invoice.id,
      ...scope,
      deletedAt: null,
    } as never)

    // Spec B: freeze the PDF after the commit, before announcing the post (the
    // auto-send subscriber attaches it). A render / storage failure never rolls
    // the post back — the first download renders and freezes it instead.
    try {
      await freezeInvoicePdf(em, invoice)
    } catch (err) {
      console.error('[billing.invoices.post] PDF could not be frozen; it will be rendered on first download', invoice.id, err)
    }

    // Side effects fire AFTER the DB commit so downstream subscribers never
    // observe a "posted" event for an invoice the DB doesn't reflect.
    // `billing.invoice.posted` is for invoices only; memos have their own
    // events with the same payload (Spec D, P-D9).
    const postedEvent: BillingEventId =
      invoice.documentType === 'credit_memo'
        ? 'billing.credit_memo.posted'
        : invoice.documentType === 'debit_memo'
          ? 'billing.debit_memo.posted'
          : 'billing.invoice.posted'
    await emitAllocationEffects(scope, settlement)
    await emitBillingEvent(postedEvent, {
      correctsInvoiceId: invoice.correctsInvoiceId ?? null,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      documentType: invoice.documentType,
      tenantId: invoice.tenantId,
      organizationId: invoice.organizationId,
      grandTotalNet: invoice.subtotalNet,
      grandTotalGross: invoice.totalGross,
      currencyCode: invoice.currencyCode,
      billRunId: invoice.billRunId ?? null,
      billAccountId: invoice.billAccountId,
      billDate: isoDate(invoice.billDate),
      billPeriodStart: isoDate(invoice.periodStart),
      billPeriodEnd: isoDate(invoice.periodEnd),
      issueDate: isoDate(invoice.issueDate),
      dueDate: isoDate(invoice.dueDate),
      lineCount: lines.length,
    })
    for (const line of lines) {
      await emitBillingEvent('billing.invoice.line_posted', {
        invoiceId: invoice.id,
        invoiceLineId: line.id,
        billingItemId: line.billingItemId ?? null,
        billingType: line.billingType,
        description: line.description,
        unitPriceNet: line.unitPriceNet,
        quantity: line.quantity,
        totalNetAmount: line.netAmount,
        tenantId: invoice.tenantId,
        organizationId: invoice.organizationId,
      })
    }

    // SPEC-002 P6: a newly-posted invoice raises the account's outstanding
    // exposure — emit billing.credit.over_limit on the upward crossing.
    // Billing never blocks; the consuming flow decides what to do.
    if (!isCreditMemo) {
      const creditEvents = await buildPostpaidCreditCrossingEvents(em, account, invoice.outstanding)
      for (const ev of creditEvents) {
        await emitBillingEvent(ev.id as BillingEventId, ev.payload, { persistent: true })
      }
    }

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      status: 'posted',
      lineCount: lines.length,
    }
  },
}

// ─── Draft edit / add / remove ───────────────────────────────────
//
// Three commands sharing the same shape:
//   1. Assert the invoice is still a draft (refuse otherwise).
//   2. Mutate the line / collection.
//   3. Write a `BillingDraftInvoiceEdit` audit row carrying before+after
//      snapshots (`null` on the "no prior state" / "no resulting state" side).
//   4. Recompute the invoice totals from the surviving lines.
//
// The audit row is append-only; once written, never updated.

function roundHalfUp2dp(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

function format4dp(value: number): string {
  return roundHalfUp2dp(value).toFixed(4)
}

async function assertDraftInvoice(
  em: EntityManager,
  params: { invoiceId: string; tenantId: string; organizationId: string },
): Promise<BillingInvoice> {
  const invoice = await em.findOne(BillingInvoice, {
    id: params.invoiceId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  } as never)
  if (!invoice) {
    throw new CrudHttpError(404, { error: 'Invoice not found' })
  }
  if (invoice.status !== 'draft') {
    throw new CrudHttpError(409, {
      error: 'Only draft invoices can be edited',
      code: 'billing.invoice.not_draft',
      currentStatus: invoice.status,
    })
  }
  return invoice
}

type LineSnapshot = {
  id: string
  description: string
  quantity: string
  unitPriceNet: string
  taxRate: string
  netAmount: string
  taxAmount: string
  grossAmount: string
  metadata: Record<string, unknown> | null
}

function snapshotLine(line: BillingInvoiceLine): LineSnapshot {
  return {
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet,
    taxRate: line.taxRate,
    netAmount: line.netAmount,
    taxAmount: line.taxAmount,
    grossAmount: line.grossAmount,
    metadata: line.metadata ?? null,
  }
}

/** Sets net / tax / gross on a line from its net amount and tax rate. */
function applyLineAmounts(line: BillingInvoiceLine, net: number): void {
  const amounts = lineAmountsFromNet(net, Number.parseFloat(line.taxRate) || 0)
  line.netAmount = format4dp(amounts.net)
  line.taxAmount = format4dp(amounts.tax)
  line.grossAmount = format4dp(amounts.gross)
}

async function recomputeInvoiceTotals(em: EntityManager, invoice: BillingInvoice): Promise<void> {
  const lines = await em.find(BillingInvoiceLine, {
    invoiceId: invoice.id,
    tenantId: invoice.tenantId,
    organizationId: invoice.organizationId,
    deletedAt: null,
  } as never)
  const totals = sumTotals(
    lines.map((line) => ({
      net: Number.parseFloat(line.netAmount),
      tax: Number.parseFloat(line.taxAmount),
      gross: Number.parseFloat(line.grossAmount),
    })),
  )
  invoice.subtotalNet = totals.subtotalNet
  invoice.taxTotal = totals.taxTotal
  invoice.totalGross = totals.totalGross
  invoice.outstanding = totals.totalGross
  invoice.updatedAt = new Date()
}

function getUserIdFromCtx(ctx: CommandRuntimeContext): string {
  const userId = (ctx.auth?.sub as string | undefined) ?? null
  // `BillingDraftInvoiceEdit.user_id` is NOT NULL. System-driven edits fall
  // back to a sentinel UUID; operator edits always have ctx.auth.sub.
  return userId ?? '00000000-0000-0000-0000-000000000000'
}

const editDraftLineCommand: CommandHandler<
  BillingInvoiceEditLineInput,
  { invoiceId: string; invoiceLineId: string; auditId: string }
> = {
  id: 'billing.invoices.edit_draft_line',

  async execute(rawInput, ctx) {
    const parsed = billingInvoiceEditLineSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const invoice = await assertDraftInvoice(em, parsed)

    const line = await em.findOne(BillingInvoiceLine, {
      id: parsed.invoiceLineId,
      invoiceId: invoice.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    } as never)
    if (!line) {
      throw new CrudHttpError(404, { error: 'Invoice line not found' })
    }

    const before = snapshotLine(line)
    let audit: BillingDraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        if (parsed.changes.description !== undefined) line.description = parsed.changes.description
        if (parsed.changes.quantity !== undefined) line.quantity = format4dp(parsed.changes.quantity)
        if (parsed.changes.unitPriceNet !== undefined) line.unitPriceNet = format4dp(parsed.changes.unitPriceNet)
        if (parsed.changes.taxRate !== undefined) line.taxRate = taxRateColumn(parsed.changes.taxRate)
        // An explicit total override wins; otherwise unit price × quantity.
        const net =
          parsed.changes.totalNetAmount !== undefined
            ? parsed.changes.totalNetAmount
            : Number.parseFloat(line.unitPriceNet) * Number.parseFloat(line.quantity)
        applyLineAmounts(line, net)
        line.updatedAt = new Date()
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        audit = em.create(BillingDraftInvoiceEdit, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          invoiceId: invoice.id,
          invoiceLineId: line.id,
          userId: getUserIdFromCtx(ctx),
          action: 'line_edited',
          beforeJson: before as Record<string, unknown>,
          afterJson: snapshotLine(line) as Record<string, unknown>,
          createdAt: new Date(),
        })
        em.persist(audit)
      },
    ])

    return { invoiceId: invoice.id, invoiceLineId: line.id, auditId: audit!.id }
  },
}

const addDraftLineCommand: CommandHandler<
  BillingInvoiceAddLineInput,
  { invoiceId: string; invoiceLineId: string; auditId: string }
> = {
  id: 'billing.invoices.add_draft_line',

  async execute(rawInput, ctx) {
    const parsed = billingInvoiceAddLineSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const invoice = await assertDraftInvoice(em, parsed)

    const existing = await em.find(BillingInvoiceLine, {
      invoiceId: invoice.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    } as never)
    const nextLineNumber = existing.reduce((max, l) => Math.max(max, l.lineNumber), 0) + 1

    const now = new Date()
    const line = em.create(BillingInvoiceLine, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      invoiceId: invoice.id,
      lineNumber: nextLineNumber,
      billingItemId: parsed.billingItemId ?? null,
      billingType: parsed.billingType ?? 'manual',
      description: parsed.description,
      quantity: format4dp(parsed.quantity),
      unitPriceNet: format4dp(parsed.unitPriceNet),
      // Spec B: explicit rate, else the organization default.
      taxRate:
        parsed.taxRate !== undefined
          ? taxRateColumn(parsed.taxRate)
          : (await getBillingSettings(em, parsed)).defaultTaxRate,
      netAmount: '0',
      taxAmount: '0',
      grossAmount: '0',
      metadata: { operator_added: true },
      createdAt: now,
      updatedAt: now,
    })
    applyLineAmounts(line, parsed.unitPriceNet * parsed.quantity)
    let audit: BillingDraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        em.persist(line)
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        audit = em.create(BillingDraftInvoiceEdit, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          invoiceId: invoice.id,
          invoiceLineId: line.id,
          userId: getUserIdFromCtx(ctx),
          action: 'line_added',
          beforeJson: null,
          afterJson: snapshotLine(line) as Record<string, unknown>,
          createdAt: new Date(),
        })
        em.persist(audit)
      },
    ])

    return { invoiceId: invoice.id, invoiceLineId: line.id, auditId: audit!.id }
  },
}

const removeDraftLineCommand: CommandHandler<
  BillingInvoiceRemoveLineInput,
  { invoiceId: string; invoiceLineId: string; auditId: string }
> = {
  id: 'billing.invoices.remove_draft_line',

  async execute(rawInput, ctx) {
    const parsed = billingInvoiceRemoveLineSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const invoice = await assertDraftInvoice(em, parsed)
    const line = await em.findOne(BillingInvoiceLine, {
      id: parsed.invoiceLineId,
      invoiceId: invoice.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    } as never)
    if (!line) {
      throw new CrudHttpError(404, { error: 'Invoice line not found' })
    }

    const before = snapshotLine(line)
    let audit: BillingDraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        em.remove(line)
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        audit = em.create(BillingDraftInvoiceEdit, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          invoiceId: invoice.id,
          invoiceLineId: null,
          userId: getUserIdFromCtx(ctx),
          action: 'line_removed',
          beforeJson: before as Record<string, unknown>,
          afterJson: null,
          createdAt: new Date(),
        })
        em.persist(audit)
      },
    ])

    return { invoiceId: invoice.id, invoiceLineId: parsed.invoiceLineId, auditId: audit!.id }
  },
}

// ─── Wipe test invoices ──────────────────────────────────────────
//
// Hard-deletes test-run drafts (`test_run = true`) and their lines,
// optionally scoped to one Bill Run so an operator can wipe a specific test
// run without touching other test data.

const wipeTestInvoicesCommand: CommandHandler<BillingWipeTestInvoicesInput, { invoicesRemoved: number }> = {
  id: 'billing.invoices.wipe_test',

  async execute(rawInput, ctx) {
    const parsed = billingWipeTestInvoicesSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const params: unknown[] = [parsed.tenantId, parsed.organizationId]
    let billRunClause = ''
    if (parsed.billRunId) {
      billRunClause = ' AND bill_run_id = ?'
      params.push(parsed.billRunId)
    }
    const removed = await em.transactional(async (tem) => {
      const rows = (await tem.execute(
        `SELECT id FROM billing_invoices
         WHERE tenant_id = ? AND organization_id = ? AND test_run = true${billRunClause}`,
        params,
      )) as unknown as Array<{ id: string }> | undefined
      const ids = (rows ?? []).map((r) => r.id)
      if (ids.length === 0) return 0
      const placeholders = ids.map(() => '?').join(',')
      await tem.execute(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (${placeholders})`, ids)
      await tem.execute(`DELETE FROM billing_invoices WHERE id IN (${placeholders})`, ids)
      return ids.length
    })
    return { invoicesRemoved: removed }
  },
}

registerCommand(postInvoiceCommand)
registerCommand(editDraftLineCommand)
registerCommand(addDraftLineCommand)
registerCommand(removeDraftLineCommand)
registerCommand(wipeTestInvoicesCommand)

export {
  postInvoiceCommand,
  editDraftLineCommand,
  addDraftLineCommand,
  removeDraftLineCommand,
  wipeTestInvoicesCommand,
}

/**
 * `billing.invoices.send` — emails a posted document with its frozen PDF
 * (Spec B). Every attempt is logged in `metadata.deliveries`; a transport
 * failure returns `status: 'failed'` instead of throwing. Not undoable: an
 * email cannot be recalled.
 */
const sendInvoiceCommand: CommandHandler<BillingInvoiceSendInput, SendInvoiceResult> = {
  id: 'billing.invoices.send',

  async execute(rawInput, ctx) {
    const parsed = billingInvoiceSendSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    return sendInvoice(getEm(ctx), { ...parsed, trigger: 'manual' })
  },
}

registerCommand(sendInvoiceCommand)

export { sendInvoiceCommand }
