import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingInvoice, BillingInvoiceLine } from '../data/entities'
import {
  billingDraftDeleteSchema,
  billingMemoCreateSchema,
  type BillingDraftDeleteInput,
  type BillingMemoCreateInput,
} from '../data/validators'
import { getBillingSettings, taxRateColumn } from '../lib/billingSettings'
import { canCorrect, isMemo } from '../lib/documentTypes'
import { creditFits, loadCorrectionTotals } from '../lib/memoGuards'
import { draftNumber } from '../lib/numbering'
import { lineAmountsFromNet, money4, sumTotals } from '../lib/vat'
import { toCents } from '../lib/allocation'

/**
 * Corrective documents (Spec D).
 *
 * `billing.invoices.create_memo` — creates a DRAFT credit or debit memo for
 * a posted / partially paid / paid billing invoice (D-D3). The memo copies
 * the original's account, currency and period, snapshots its number and
 * issue date, and requires a reason (D-D4). Credit memo lines copied from
 * the original keep the original VAT rate; without lines a credit memo is
 * a full credit (D-D9). Amounts are stored positive (D-D5). Posting goes
 * through `billing.invoices.post` (series, settlement — see commands/invoices).
 *
 * `billing.invoices.delete_draft` — deletes a draft memo with its lines
 * (D-D7: posted documents are never deleted or voided).
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

type MemoResult = { memoId: string; number: string; documentType: string; totalGross: string }

const createMemoCommand: CommandHandler<BillingMemoCreateInput, MemoResult> = {
  id: 'billing.invoices.create_memo',
  async execute(rawInput, ctx) {
    const parsed = billingMemoCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = getEm(ctx)

    const original = await em.findOne(BillingInvoice, { id: parsed.invoiceId, ...scope, deletedAt: null } as never)
    if (!original) throw new CrudHttpError(404, { error: 'Invoice not found' })
    if (!canCorrect(original, parsed.type)) {
      throw new CrudHttpError(409, {
        error: 'Only posted, partially paid or paid invoices can be corrected',
        code: 'billing.memo.invalid_original',
        currentStatus: original.status,
        documentType: original.documentType,
      })
    }

    const originalLines = await em.find(
      BillingInvoiceLine,
      { invoiceId: original.id, ...scope, deletedAt: null } as never,
      { orderBy: { lineNumber: 'asc' } as never },
    )
    const byId = new Map(originalLines.map((line) => [line.id, line]))
    const defaultRate = (await getBillingSettings(em, scope)).defaultTaxRate

    type Draft = {
      correctsLineId: string | null
      description: string
      quantity: number
      unitPriceNet: number
      taxRate: string
      billingType: string
      servicePeriodStart: Date | null
      servicePeriodEnd: Date | null
    }
    let drafts: Draft[]
    if (parsed.lines && parsed.lines.length > 0) {
      drafts = parsed.lines.map((line) => {
        const source = line.correctsLineId ? byId.get(line.correctsLineId) : null
        if (line.correctsLineId && !source) {
          throw new CrudHttpError(400, { error: 'A copied line does not belong to the original invoice', code: 'billing.memo.invalid_line' })
        }
        return {
          correctsLineId: source?.id ?? null,
          description: line.description,
          quantity: line.quantity,
          unitPriceNet: line.unitPriceNet,
          // Copied lines keep the original rate (P-D7); new lines default to the org rate.
          taxRate: source ? source.taxRate : line.taxRate !== undefined ? taxRateColumn(line.taxRate) : defaultRate,
          billingType: source?.billingType ?? 'manual',
          servicePeriodStart: source?.servicePeriodStart ?? null,
          servicePeriodEnd: source?.servicePeriodEnd ?? null,
        }
      })
    } else if (parsed.type === 'credit_memo') {
      // Full credit: every original line (amounts positive, D-D5).
      drafts = originalLines.map((line) => ({
        correctsLineId: line.id,
        description: line.description,
        quantity: Number.parseFloat(line.quantity),
        unitPriceNet: Math.abs(Number.parseFloat(line.unitPriceNet)),
        taxRate: line.taxRate,
        billingType: line.billingType,
        servicePeriodStart: line.servicePeriodStart ?? null,
        servicePeriodEnd: line.servicePeriodEnd ?? null,
      }))
    } else {
      drafts = []
    }

    const amounts = drafts.map((d) => lineAmountsFromNet(d.quantity * d.unitPriceNet, Number.parseFloat(d.taxRate) || 0))
    const totals = sumTotals(amounts)

    if (parsed.type === 'credit_memo') {
      const corrections = await loadCorrectionTotals(em, scope, original.id)
      if (!creditFits(toCents(original.totalGross), corrections, toCents(totals.totalGross))) {
        throw new CrudHttpError(409, {
          error: 'The credit exceeds what is left to credit on this invoice',
          code: 'billing.memo.exceeds_invoice',
        })
      }
    }

    const now = new Date()
    const memo = em.create(BillingInvoice, {
      ...scope,
      billAccountId: original.billAccountId,
      documentType: parsed.type,
      number: draftNumber(),
      series: null,
      status: 'draft',
      testRun: false,
      billRunId: null,
      billDate: null,
      periodStart: original.periodStart ?? null,
      periodEnd: original.periodEnd ?? null,
      currencyCode: original.currencyCode,
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      paidTotal: '0',
      creditedTotal: '0',
      outstanding: totals.totalGross,
      correctsInvoiceId: original.id,
      correctionReason: parsed.reason,
      correctsInvoiceNumber: original.number,
      correctsIssueDate: original.issueDate ?? null,
      createdAt: now,
      updatedAt: now,
    } as never)
    em.persist(memo)
    await em.flush()
    drafts.forEach((draft, index) => {
      em.persist(
        em.create(BillingInvoiceLine, {
          ...scope,
          invoiceId: memo.id,
          lineNumber: index + 1,
          billingItemId: null,
          billingType: draft.billingType,
          description: draft.description,
          quantity: money4(draft.quantity),
          unitPriceNet: money4(draft.unitPriceNet),
          taxRate: draft.taxRate,
          netAmount: money4(amounts[index].net),
          taxAmount: money4(amounts[index].tax),
          grossAmount: money4(amounts[index].gross),
          servicePeriodStart: draft.servicePeriodStart,
          servicePeriodEnd: draft.servicePeriodEnd,
          correctsLineId: draft.correctsLineId,
          metadata: null,
          createdAt: now,
          updatedAt: now,
        } as never),
      )
    })
    await em.flush()
    return { memoId: memo.id, number: memo.number, documentType: memo.documentType, totalGross: memo.totalGross }
  },
}

const deleteDraftMemoCommand: CommandHandler<BillingDraftDeleteInput, { deleted: boolean }> = {
  id: 'billing.invoices.delete_draft',
  async execute(rawInput, ctx) {
    const parsed = billingDraftDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = getEm(ctx)
    const memo = await em.findOne(BillingInvoice, { id: parsed.invoiceId, ...scope, deletedAt: null } as never)
    if (!memo) throw new CrudHttpError(404, { error: 'Document not found' })
    if (memo.status !== 'draft' || !isMemo(memo.documentType)) {
      throw new CrudHttpError(409, {
        error: 'Only draft credit / debit memos can be deleted',
        code: 'billing.memo.not_draft',
      })
    }
    await em.transactional(async (tem) => {
      await (tem as EntityManager).execute(
        `DELETE FROM billing_invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND organization_id = ?`,
        [memo.id, scope.tenantId, scope.organizationId],
      )
      await (tem as EntityManager).execute(
        `DELETE FROM billing_invoices WHERE id = ? AND tenant_id = ? AND organization_id = ? AND status = 'draft'`,
        [memo.id, scope.tenantId, scope.organizationId],
      )
    })
    return { deleted: true }
  },
}

registerCommand(createMemoCommand)
registerCommand(deleteDraftMemoCommand)

export { createMemoCommand, deleteDraftMemoCommand }
