import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingAccount, BillingPayment, BillingTopup } from '../data/entities'
import {
  billingAllocationRemoveSchema,
  billingPaymentAllocateSchema,
  billingPaymentAssignSchema,
  billingPaymentConvertSchema,
  billingPaymentCreateSchema,
  billingPaymentIdSchema,
  billingPaymentImportSchema,
  type BillingAllocationRemoveInput,
  type BillingPaymentAllocateInput,
  type BillingPaymentAssignInput,
  type BillingPaymentConvertInput,
  type BillingPaymentCreateInput,
  type BillingPaymentIdInput,
  type BillingPaymentImportInput,
} from '../data/validators'
import { emitBillingEvent } from '../events'
import { withAccountLock } from '../lib/accountLock'
import {
  allocate,
  applyAccountCredit,
  emptyEffects,
  mergeEffects,
  toCents,
  unallocate,
  type AllocationEffects,
  type ArScope,
} from '../lib/allocation'
import { emitAllocationEffects } from '../lib/allocationEvents'
import { getBillingSettings } from '../lib/billingSettings'
import { importPayments, type ImportSummary } from '../lib/paymentImport'
import { captureTopup } from '../lib/topupCapture'
import { createHash } from 'node:crypto'

/**
 * Payment commands (Spec C). Every receivables change runs inside the
 * per-account lock (`withAccountLock`); events fire after commit.
 *
 * Reversals are explicit inverse commands, consistent with the rest of the
 * billing module (which does not use the framework undo log): allocate ↔
 * unallocate, assign ↔ unassign, ignore ↔ restore. Convert-to-top-up is
 * terminal (reverse through the prepaid adjustment flow, C-D3).
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function userIdOf(ctx: CommandRuntimeContext): string | null {
  return (ctx.auth?.sub as string | undefined) ?? null
}

function scopeOf(input: { tenantId: string; organizationId: string }): ArScope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

async function loadPayment(em: EntityManager, scope: ArScope, paymentId: string): Promise<BillingPayment> {
  const payment = await em.findOne(BillingPayment, { id: paymentId, ...scope, deletedAt: null } as never)
  if (!payment) throw new CrudHttpError(404, { error: 'Payment not found', code: 'billing.payment.not_found' })
  return payment
}

async function loadAccount(em: EntityManager, scope: ArScope, billAccountId: string): Promise<BillingAccount> {
  const account = await em.findOne(BillingAccount, { id: billAccountId, ...scope, deletedAt: null } as never)
  if (!account) throw new CrudHttpError(404, { error: 'Billing account not found', code: 'billing.payment.account_missing' })
  return account
}

async function countActiveAllocations(em: EntityManager, scope: ArScope, paymentId: string): Promise<number> {
  const rows = (await em.execute(
    `SELECT COUNT(*)::int AS n FROM billing_allocations
      WHERE tenant_id = ? AND organization_id = ? AND source_type = 'payment' AND source_id = ? AND deleted_at IS NULL`,
    [scope.tenantId, scope.organizationId, paymentId],
  )) as unknown as Array<{ n: number }>
  return Number(rows?.[0]?.n ?? 0)
}

export type PaymentCommandResult = { paymentId: string; status: string; unallocatedAmount: string }

async function paymentResult(em: EntityManager, scope: ArScope, paymentId: string): Promise<PaymentCommandResult> {
  const rows = (await em.execute(
    `SELECT status, unallocated_amount FROM billing_payments WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
    [paymentId, scope.tenantId, scope.organizationId],
  )) as unknown as Array<{ status: string; unallocated_amount: string }>
  return { paymentId, status: rows?.[0]?.status ?? 'unmatched', unallocatedAmount: rows?.[0]?.unallocated_amount ?? '0' }
}

// ─── Import ──────────────────────────────────────────────────────

const importPaymentsCommand: CommandHandler<BillingPaymentImportInput, ImportSummary> = {
  id: 'billing.payments.import',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentImportSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const { summary, effects, paymentIds } = await importPayments(getEm(ctx), {
      scope,
      fileName: parsed.fileName,
      content: parsed.content,
      userId: userIdOf(ctx),
    })
    for (const paymentId of paymentIds) await emitBillingEvent('billing.payment.created', { ...scope, paymentId, source: 'csv' })
    await emitAllocationEffects(scope, effects)
    await emitBillingEvent('billing.payment_import.completed', { ...scope, importId: summary.importId, counts: summary.counts })
    return summary
  },
}

// ─── Manual entry ────────────────────────────────────────────────

const createPaymentCommand: CommandHandler<BillingPaymentCreateInput, PaymentCommandResult> = {
  id: 'billing.payments.create',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    if (parsed.billAccountId) {
      const account = await loadAccount(em, scope, parsed.billAccountId)
      if (account.currencyCode !== parsed.currencyCode) {
        throw new CrudHttpError(409, { error: 'Payment currency differs from the account', code: 'billing.payment.currency_mismatch' })
      }
    }
    const amount = parsed.amount.toFixed(4)
    const now = new Date()
    const payment = em.create(BillingPayment, {
      ...scope,
      receivedAt: new Date(`${parsed.receivedAt}T00:00:00Z`),
      amount,
      currencyCode: parsed.currencyCode,
      reference: parsed.reference ?? null,
      payerName: parsed.payerName ?? null,
      payerAccount: parsed.payerAccount ?? null,
      source: 'manual',
      billAccountId: parsed.billAccountId ?? null,
      status: parsed.billAccountId ? 'matched' : 'unmatched',
      unallocatedAmount: amount,
      matchReason: parsed.billAccountId ? null : 'manual',
      sourceRef: `manual:${createHash('sha256').update(`${scope.tenantId}|${now.toISOString()}|${Math.random()}`).digest('hex')}`,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(payment)
    await em.flush()
    let effects = emptyEffects()
    if (parsed.billAccountId) {
      effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId: parsed.billAccountId }, (tem) =>
        applyAccountCredit(tem, scope, { id: parsed.billAccountId!, currencyCode: parsed.currencyCode }, {
          onlySources: [{ type: 'payment', id: payment.id }],
        }),
      )
    }
    await emitBillingEvent('billing.payment.created', { ...scope, paymentId: payment.id, source: 'manual' })
    await emitAllocationEffects(scope, effects)
    return paymentResult(em, scope, payment.id)
  },
}

// ─── Assign / unassign ───────────────────────────────────────────

const assignPaymentCommand: CommandHandler<BillingPaymentAssignInput, PaymentCommandResult> = {
  id: 'billing.payments.assign',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentAssignSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const [payment, account] = await Promise.all([
      loadPayment(em, scope, parsed.paymentId),
      loadAccount(em, scope, parsed.billAccountId),
    ])
    if (payment.status !== 'unmatched') {
      throw new CrudHttpError(409, { error: 'Only unmatched payments can be assigned', code: 'billing.payment.not_unmatched' })
    }
    if (account.billingMode === 'prepaid') {
      throw new CrudHttpError(409, {
        error: 'Prepaid accounts take payments as top-ups — use "Convert to top-up"',
        code: 'billing.payment.prepaid_account',
      })
    }
    if (account.currencyCode !== payment.currencyCode) {
      throw new CrudHttpError(409, { error: 'Payment currency differs from the account', code: 'billing.payment.currency_mismatch' })
    }
    const effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId: account.id }, async (tem) => {
      await tem.execute(
        `UPDATE billing_payments SET bill_account_id = ?, status = 'matched', match_reason = 'manual', updated_at = now()
          WHERE id = ? AND tenant_id = ? AND organization_id = ? AND status = 'unmatched'`,
        [account.id, payment.id, scope.tenantId, scope.organizationId],
      )
      return applyAccountCredit(tem, scope, { id: account.id, currencyCode: account.currencyCode }, {
        onlySources: [{ type: 'payment', id: payment.id }],
      })
    })
    await emitAllocationEffects(scope, effects)
    return paymentResult(em, scope, payment.id)
  },
}

const unassignPaymentCommand: CommandHandler<BillingPaymentIdInput, PaymentCommandResult> = {
  id: 'billing.payments.unassign',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentIdSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const payment = await loadPayment(em, scope, parsed.paymentId)
    if (payment.status !== 'matched' || !payment.billAccountId) {
      throw new CrudHttpError(409, { error: 'Only fully unallocated matched payments can be unassigned', code: 'billing.payment.not_matched' })
    }
    if ((await countActiveAllocations(em, scope, payment.id)) > 0) {
      throw new CrudHttpError(409, { error: 'Un-allocate the payment first', code: 'billing.payment.has_allocations' })
    }
    await em.execute(
      `UPDATE billing_payments SET bill_account_id = NULL, status = 'unmatched', match_reason = 'manual', updated_at = now()
        WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
      [payment.id, scope.tenantId, scope.organizationId],
    )
    return paymentResult(em, scope, payment.id)
  },
}

// ─── Allocate / unallocate ───────────────────────────────────────

const allocatePaymentCommand: CommandHandler<BillingPaymentAllocateInput, PaymentCommandResult> = {
  id: 'billing.payments.allocate',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentAllocateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const payment = await loadPayment(em, scope, parsed.paymentId)
    if (!payment.billAccountId) {
      throw new CrudHttpError(409, { error: 'Assign the payment to an account first', code: 'billing.payment.unassigned' })
    }
    const effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId: payment.billAccountId }, async (tem) => {
      const all = emptyEffects()
      for (const entry of parsed.allocations) {
        mergeEffects(
          all,
          await allocate(tem, scope, {
            source: { type: 'payment', id: payment.id },
            invoiceId: entry.invoiceId,
            amountCents: toCents(entry.amount),
            by: 'user',
            userId: userIdOf(ctx),
          }),
        )
      }
      return all
    })
    await emitAllocationEffects(scope, effects)
    return paymentResult(em, scope, payment.id)
  },
}

/** Source-agnostic: removes a payment OR credit memo allocation (Spec D P-D10). */
const unallocateCommand: CommandHandler<BillingAllocationRemoveInput, { allocationId: string; effects: AllocationEffects }> = {
  id: 'billing.payments.unallocate',
  async execute(rawInput, ctx) {
    const parsed = billingAllocationRemoveSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const rows = (await em.execute(
      `SELECT bill_account_id FROM billing_allocations
        WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [parsed.allocationId, scope.tenantId, scope.organizationId],
    )) as unknown as Array<{ bill_account_id: string }>
    const billAccountId = rows?.[0]?.bill_account_id
    if (!billAccountId) throw new CrudHttpError(404, { error: 'Allocation not found', code: 'billing.allocation.not_found' })
    const effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId }, (tem) =>
      unallocate(tem, scope, { allocationId: parsed.allocationId, userId: userIdOf(ctx) }),
    )
    await emitAllocationEffects(scope, effects)
    return { allocationId: parsed.allocationId, effects }
  },
}

// ─── Ignore / restore ────────────────────────────────────────────

const ignorePaymentCommand: CommandHandler<BillingPaymentIdInput, PaymentCommandResult> = {
  id: 'billing.payments.ignore',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentIdSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const payment = await loadPayment(em, scope, parsed.paymentId)
    if (!['unmatched', 'matched'].includes(payment.status) || (await countActiveAllocations(em, scope, payment.id)) > 0) {
      throw new CrudHttpError(409, { error: 'Only unallocated payments can be ignored', code: 'billing.payment.has_allocations' })
    }
    await em.execute(
      `UPDATE billing_payments SET status = 'ignored', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('ignored_from', ?::text), updated_at = now()
        WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
      [payment.status, payment.id, scope.tenantId, scope.organizationId],
    )
    return paymentResult(em, scope, payment.id)
  },
}

const restorePaymentCommand: CommandHandler<BillingPaymentIdInput, PaymentCommandResult> = {
  id: 'billing.payments.restore',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentIdSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const payment = await loadPayment(em, scope, parsed.paymentId)
    if (payment.status !== 'ignored') {
      throw new CrudHttpError(409, { error: 'Only ignored payments can be restored', code: 'billing.payment.not_ignored' })
    }
    const status = payment.billAccountId ? 'matched' : 'unmatched'
    let effects = emptyEffects()
    if (payment.billAccountId) {
      const account = await loadAccount(em, scope, payment.billAccountId)
      effects = await withAccountLock(em, { tenantId: scope.tenantId, billAccountId: account.id }, async (tem) => {
        await tem.execute(`UPDATE billing_payments SET status = ?, updated_at = now() WHERE id = ?`, [status, payment.id])
        return applyAccountCredit(tem, scope, { id: account.id, currencyCode: account.currencyCode }, {
          onlySources: [{ type: 'payment', id: payment.id }],
        })
      })
    } else {
      await em.execute(`UPDATE billing_payments SET status = ?, updated_at = now() WHERE id = ?`, [status, payment.id])
    }
    await emitAllocationEffects(scope, effects)
    return paymentResult(em, scope, payment.id)
  },
}

// ─── Convert to top-up (C-D3) ────────────────────────────────────

const convertToTopupCommand: CommandHandler<BillingPaymentConvertInput, PaymentCommandResult & { topupId: string }> = {
  id: 'billing.payments.convert_to_topup',
  async execute(rawInput, ctx) {
    const parsed = billingPaymentConvertSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = scopeOf(parsed)
    const em = getEm(ctx)
    const [payment, account] = await Promise.all([
      loadPayment(em, scope, parsed.paymentId),
      loadAccount(em, scope, parsed.billAccountId),
    ])
    if (account.billingMode !== 'prepaid') {
      throw new CrudHttpError(409, { error: 'Only prepaid accounts take top-ups', code: 'billing.payment.not_prepaid' })
    }
    if (account.currencyCode !== payment.currencyCode) {
      throw new CrudHttpError(409, { error: 'Payment currency differs from the account', code: 'billing.payment.currency_mismatch' })
    }
    const sourceRef = `topup-${payment.id}`
    if (payment.status === 'converted_to_topup' && payment.topupId) {
      return { ...(await paymentResult(em, scope, payment.id)), topupId: payment.topupId }
    }
    if (payment.status !== 'unmatched' || toCents(payment.unallocatedAmount) !== toCents(payment.amount)) {
      throw new CrudHttpError(409, { error: 'Only unmatched, unallocated payments can be converted', code: 'billing.payment.not_convertible' })
    }
    let topup = await em.findOne(BillingTopup, { ...scope, sourceRef } as never)
    if (!topup) {
      const now = new Date()
      topup = em.create(BillingTopup, {
        ...scope,
        billAccountId: account.id,
        status: 'pending',
        amount: payment.amount,
        currencyCode: payment.currencyCode,
        providerKey: 'bank_transfer',
        paymentId: payment.id,
        sourceRef,
        metadata: { billing_payment_id: payment.id, reference: payment.reference ?? null },
        createdAt: now,
        updatedAt: now,
      } as never)
      em.persist(topup)
      await em.flush()
    }
    const settings = await getBillingSettings(em, scope)
    await captureTopup(em, {
      topup,
      account: { id: account.id, organizationId: account.organizationId, tenantId: account.tenantId, currencyCode: account.currencyCode },
      taxRate: Number.parseFloat(settings.topupTaxRate) || 0,
      gatewayTransactionId: payment.reference ?? null,
    })
    await em.execute(
      `UPDATE billing_payments
          SET status = 'converted_to_topup', bill_account_id = ?, topup_id = ?, unallocated_amount = 0, updated_at = now()
        WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
      [account.id, topup.id, payment.id, scope.tenantId, scope.organizationId],
    )
    await emitBillingEvent('billing.payment.converted_to_topup', { ...scope, paymentId: payment.id, topupId: topup.id, billAccountId: account.id })
    return { ...(await paymentResult(em, scope, payment.id)), topupId: topup.id }
  },
}

registerCommand(importPaymentsCommand)
registerCommand(createPaymentCommand)
registerCommand(assignPaymentCommand)
registerCommand(unassignPaymentCommand)
registerCommand(allocatePaymentCommand)
registerCommand(unallocateCommand)
registerCommand(ignorePaymentCommand)
registerCommand(restorePaymentCommand)
registerCommand(convertToTopupCommand)

export {
  importPaymentsCommand,
  createPaymentCommand,
  assignPaymentCommand,
  unassignPaymentCommand,
  allocatePaymentCommand,
  unallocateCommand,
  ignorePaymentCommand,
  restorePaymentCommand,
  convertToTopupCommand,
}
