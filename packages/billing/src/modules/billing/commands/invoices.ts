import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesInvoice, SalesInvoiceLine } from '@open-mercato/core/modules/sales/data/entities'
import { emitBillingEvent } from '../events'
import {
  billingInvoicePostSchema,
  type BillingInvoicePostInput,
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

    invoice.status = 'posted'
    invoice.statusEntryId = postedStatusEntryId
    invoice.updatedAt = new Date()
    await em.flush()

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

registerCommand(postInvoiceCommand)

export { postInvoiceCommand }
