import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesInvoice, SalesInvoiceLine } from '@open-mercato/core/modules/sales/data/entities'
import { DraftInvoiceEdit } from '../data/entities'
import { emitBillingEvent } from '../events'
import {
  billingInvoiceAddLineSchema,
  billingInvoiceEditLineSchema,
  billingInvoicePostSchema,
  billingInvoiceRemoveLineSchema,
  billingWipeTestInvoicesSchema,
  type BillingInvoiceAddLineInput,
  type BillingInvoiceEditLineInput,
  type BillingInvoicePostInput,
  type BillingInvoiceRemoveLineInput,
  type BillingWipeTestInvoicesInput,
} from '../data/validators'
import { resolveInvoiceStatusEntryId } from '../lib/invoiceStatus'

/**
 * Posts a `core/sales` draft invoice that the Bill Run engine
 * created.
 *
 * Phase 2 deviation note: the invoice number is already set at
 * draft-create time (because `SalesInvoice.invoice_number` is NOT
 * NULL upstream). "Post" therefore only:
 *   1. Asserts the invoice is currently a draft (refuse otherwise).
 *   2. Refuses test-mode invoices (`metadata.test_run=true`) — they
 *      should never reach production posting.
 *   3. Flips `status` (and `status_entry_id`) to `posted`.
 *   4. Fires `billing.invoice.posted` (one) + `billing.invoice.line_posted`
 *      per line (for downstream consumers — accounting, analytics).
 *
 * Once posted, the invoice is frozen at the billing layer; corrections
 * go through `core/sales`'s manual edit flow.
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

const postInvoiceCommand: CommandHandler<BillingInvoicePostInput, PostResult> = {
  id: 'billing.invoices.post',

  async execute(rawInput, ctx) {
    const parsed = billingInvoicePostSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const invoice = await em.findOne(SalesInvoice, {
      id: parsed.invoiceId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
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
    const meta = (invoice.metadata as Record<string, unknown> | null) ?? {}
    if (meta.test_run === true) {
      // Test invoices live for inspection only — posting them would
      // leak test data into accounting. Force-delete the test invoice
      // instead (Phase 4b admin UI exposes a "Wipe test drafts"
      // button against `DELETE /api/billing/test-invoices`).
      throw new CrudHttpError(409, {
        error: 'Test-mode invoices cannot be posted',
        code: 'billing.invoice.test_run',
      })
    }

    const postedStatusEntryId = await resolveInvoiceStatusEntryId(
      em,
      parsed.tenantId,
      parsed.organizationId,
      'posted',
    )

    await withAtomicFlush(em, [
      () => {
        invoice.status = 'posted'
        invoice.statusEntryId = postedStatusEntryId
        invoice.updatedAt = new Date()
      },
    ])

    const lines = await em.find(SalesInvoiceLine, {
      invoice,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    } as never)

    // Side effects fire AFTER the DB commit so downstream subscribers
    // (mailer, accounting bridge, analytics) never observe a "posted"
    // event for an invoice the DB doesn't reflect.
    await emitBillingEvent('billing.invoice.posted', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      tenantId: invoice.tenantId,
      organizationId: invoice.organizationId,
      grandTotalNet: invoice.grandTotalNetAmount,
      grandTotalGross: invoice.grandTotalGrossAmount,
      currencyCode: invoice.currencyCode,
      billRunId: (meta as { bill_run_id?: string }).bill_run_id ?? null,
      billAccountId: (meta as { bill_account_id?: string }).bill_account_id ?? null,
      billPeriodStart: (meta as { bill_period_start?: string }).bill_period_start ?? null,
      billPeriodEnd: (meta as { bill_period_end?: string }).bill_period_end ?? null,
      lineCount: lines.length,
    })
    for (const line of lines) {
      const lineMeta = (line.metadata as Record<string, unknown> | null) ?? {}
      await emitBillingEvent('billing.invoice.line_posted', {
        invoiceId: invoice.id,
        invoiceLineId: line.id,
        billingItemId: lineMeta.billing_item_id ?? null,
        billingType: lineMeta.billing_type ?? null,
        description: line.description ?? null,
        unitPriceNet: line.unitPriceNet,
        quantity: line.quantity,
        totalNetAmount: line.totalNetAmount,
        tenantId: invoice.tenantId,
        organizationId: invoice.organizationId,
      })
    }

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: 'posted',
      lineCount: lines.length,
    }
  },
}

// ─── Draft edit / add / remove (Phase 4b) ────────────────────────
//
// Three commands sharing the same shape:
//   1. Assert the invoice is still a draft (refuse otherwise).
//   2. Mutate the line / collection.
//   3. Write a `DraftInvoiceEdit` audit row carrying before+after
//      snapshots (`null` on the "no prior state" / "no resulting state"
//      side per the spec — see entity column docs).
//   4. Recompute the invoice totals from the surviving lines.
//
// The audit row is append-only; once written, never updated. Soft-
// deleting the invoice does NOT delete the audit rows (compliance).

function roundHalfUp2dp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function format4dp(value: number): string {
  return roundHalfUp2dp(value).toFixed(4)
}

async function assertDraftInvoice(
  em: EntityManager,
  params: { invoiceId: string; tenantId: string; organizationId: string },
): Promise<SalesInvoice> {
  const invoice = await em.findOne(SalesInvoice, {
    id: params.invoiceId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    deletedAt: null,
  })
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
  description: string | null
  quantity: string
  unitPriceNet: string
  totalNetAmount: string
  totalGrossAmount: string
  metadata: Record<string, unknown> | null
}

function snapshotLine(line: SalesInvoiceLine): LineSnapshot {
  return {
    id: line.id,
    description: line.description ?? null,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet,
    totalNetAmount: line.totalNetAmount,
    totalGrossAmount: line.totalGrossAmount,
    metadata: (line.metadata as Record<string, unknown> | null) ?? null,
  }
}

async function recomputeInvoiceTotals(
  em: EntityManager,
  invoice: SalesInvoice,
): Promise<void> {
  const lines = await em.find(SalesInvoiceLine, {
    invoice,
    tenantId: invoice.tenantId,
    organizationId: invoice.organizationId,
  } as never)
  let totalNet = 0
  for (const line of lines) {
    totalNet += Number.parseFloat(line.totalNetAmount)
  }
  const formatted = format4dp(totalNet)
  invoice.subtotalNetAmount = formatted
  invoice.subtotalGrossAmount = formatted
  invoice.grandTotalNetAmount = formatted
  invoice.grandTotalGrossAmount = formatted
  invoice.outstandingAmount = formatted
  invoice.updatedAt = new Date()
}

function getUserIdFromCtx(ctx: CommandRuntimeContext): string {
  const userId = (ctx.auth?.sub as string | undefined) ?? null
  // The DraftInvoiceEdit.user_id column is NOT NULL. For system-driven
  // edits (e.g. catch-up flow that revises a value), we fall back to
  // a sentinel UUID. Operator-driven edits always have a real
  // ctx.auth.sub.
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
    const invoice = await assertDraftInvoice(em, {
      invoiceId: parsed.invoiceId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })

    const line = await em.findOne(SalesInvoiceLine, {
      id: parsed.invoiceLineId,
      invoice,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!line) {
      throw new CrudHttpError(404, { error: 'Invoice line not found' })
    }

    const before = snapshotLine(line)
    let audit: DraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        if (parsed.changes.description !== undefined) {
          line.description = parsed.changes.description
        }
        if (parsed.changes.quantity !== undefined) {
          line.quantity = format4dp(parsed.changes.quantity)
          line.normalizedQuantity = line.quantity
        }
        if (parsed.changes.unitPriceNet !== undefined) {
          line.unitPriceNet = format4dp(parsed.changes.unitPriceNet)
          line.unitPriceGross = line.unitPriceNet
        }

        // Recompute the line total. If the operator supplied an explicit
        // `totalNetAmount` override, honour it; otherwise compute from
        // unit_price × quantity.
        if (parsed.changes.totalNetAmount !== undefined) {
          const total = format4dp(parsed.changes.totalNetAmount)
          line.totalNetAmount = total
          line.totalGrossAmount = total
        } else {
          const total = format4dp(
            Number.parseFloat(line.unitPriceNet) * Number.parseFloat(line.quantity),
          )
          line.totalNetAmount = total
          line.totalGrossAmount = total
        }
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        const after = snapshotLine(line)
        audit = em.create(DraftInvoiceEdit, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          invoiceId: invoice.id,
          invoiceLineId: line.id,
          userId: getUserIdFromCtx(ctx),
          action: 'line_edited',
          beforeJson: before as Record<string, unknown>,
          afterJson: after as Record<string, unknown>,
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
    const invoice = await assertDraftInvoice(em, {
      invoiceId: parsed.invoiceId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })

    const existing = await em.find(SalesInvoiceLine, {
      invoice,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    } as never)
    const nextLineNumber = existing.length + 1

    const total = format4dp(parsed.unitPriceNet * parsed.quantity)
    const line = em.create(SalesInvoiceLine, {
      invoice,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      lineNumber: nextLineNumber,
      kind: 'product',
      description: parsed.description,
      quantity: format4dp(parsed.quantity),
      normalizedQuantity: format4dp(parsed.quantity),
      currencyCode: invoice.currencyCode,
      unitPriceNet: format4dp(parsed.unitPriceNet),
      unitPriceGross: format4dp(parsed.unitPriceNet),
      discountAmount: '0',
      discountPercent: '0',
      taxRate: '0',
      taxAmount: '0',
      totalNetAmount: total,
      totalGrossAmount: total,
      metadata: {
        billing_item_id: parsed.billingItemId ?? null,
        billing_type: parsed.billingType ?? 'manual',
        operator_added: true,
      },
    })
    let audit: DraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        em.persist(line)
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        const after = snapshotLine(line)
        audit = em.create(DraftInvoiceEdit, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          invoiceId: invoice.id,
          invoiceLineId: line.id,
          userId: getUserIdFromCtx(ctx),
          action: 'line_added',
          beforeJson: null,
          afterJson: after as Record<string, unknown>,
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
    const invoice = await assertDraftInvoice(em, {
      invoiceId: parsed.invoiceId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    const line = await em.findOne(SalesInvoiceLine, {
      id: parsed.invoiceLineId,
      invoice,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!line) {
      throw new CrudHttpError(404, { error: 'Invoice line not found' })
    }

    const before = snapshotLine(line)
    let audit: DraftInvoiceEdit | null = null

    await withAtomicFlush(em, [
      () => {
        em.remove(line)
      },
      async () => {
        await recomputeInvoiceTotals(em, invoice)
      },
      () => {
        audit = em.create(DraftInvoiceEdit, {
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

// ─── Wipe test invoices (Phase 4b) ───────────────────────────────
//
// Hard-deletes invoices flagged `metadata.test_run=true` (and their
// lines via cascade — the invoice's lines collection points at it
// with ON DELETE CASCADE). Optionally scoped to a single `bill_run_id`
// via the param so operators can wipe a specific test run without
// risking other test data.

const wipeTestInvoicesCommand: CommandHandler<
  BillingWipeTestInvoicesInput,
  { invoicesRemoved: number }
> = {
  id: 'billing.invoices.wipe_test',

  async execute(rawInput, ctx) {
    const parsed = billingWipeTestInvoicesSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    // The metadata->>'test_run' = 'true' predicate uses Postgres'
    // JSONB ->> operator + the literal string 'true' (jsonb true is
    // serialized as the JSON literal `true`, which ->> returns as the
    // text "true").
    const params: unknown[] = [parsed.tenantId, parsed.organizationId]
    let billRunClause = ''
    if (parsed.billRunId) {
      billRunClause = ` AND metadata->>'bill_run_id' = ?`
      params.push(parsed.billRunId)
    }
    const rows = (await em.execute(
      `SELECT id FROM sales_invoices
       WHERE tenant_id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
         AND metadata->>'test_run' = 'true'${billRunClause}`,
      params,
    )) as unknown as Array<{ id: string }> | undefined
    if (!rows || rows.length === 0) {
      return { invoicesRemoved: 0 }
    }
    const ids = rows.map((r) => r.id)
    // Hard-delete lines first then invoices to avoid relying on
    // cascade semantics that the migration may or may not encode.
    await em.execute(
      `DELETE FROM sales_invoice_lines WHERE invoice_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )
    await em.execute(
      `DELETE FROM sales_invoices WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )
    return { invoicesRemoved: ids.length }
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
