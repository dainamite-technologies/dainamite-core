import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import {
  BillingAccount,
  BillingInvoice,
  BillingPayment,
} from '@dainamite/billing/modules/billing/data/entities'
import { PAYMENT_CSV_HEADER } from '@dainamite/billing/modules/billing/lib/paymentCsv'
import {
  ACME_ACCOUNTS,
  ACME_BILLING_SETTINGS,
  ACME_PAYMENT_FILE_NAME,
  acmeDate,
  buildAcmePaymentsCsv,
  type AcmeAccount,
  type PostedInvoiceRef,
} from './billing-data'

/**
 * Replays the ACME billing demo (see `billing-data.ts`) through the billing
 * commands, so invoice numbers, balances, statements and allocations are
 * produced by the real engine instead of being copied as rows.
 *
 * Idempotency: seeding is all-or-nothing per organization — if any of the
 * demo accounts already exists, the whole seed is skipped (a second replay
 * would post new invoices and import the payments again).
 */

import type { Scope } from './customers'

export type AcmeBillingSeedResult =
  | { skipped: true; reason: string }
  | { skipped: false; accounts: string[]; missingCustomers: string[]; posted: string[]; payments: number }

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function seedAcmeBilling(
  em: EntityManager,
  container: AwilixContainer,
  scope: Scope,
  customerIdByName: Map<string, string>,
  options: {
    now?: Date
    /** Accounts created by the CPQ order activation, by account key (`fromCpq` entries). */
    cpqAccountIds?: Record<string, string | null>
  } = {},
): Promise<AcmeBillingSeedResult> {
  const anchor = options.now ?? new Date()
  const bus = container.resolve('commandBus') as CommandBus
  const fresh = () => (container.resolve('em') as EntityManager).fork()
  // System context (no user) — the scope guards are no-ops without `auth`,
  // same as the CPQ → billing connector.
  const ctx = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
  const exec = async <T>(commandId: string, input: Record<string, unknown>): Promise<T> => {
    const { result } = await bus.execute(commandId, { input: { ...scope, ...input }, ctx } as never)
    return result as T
  }

  const existing = await em.count(BillingAccount, {
    ...scope,
    name: { $in: ACME_ACCOUNTS.filter((a) => !a.fromCpq).map((a) => a.customerName) },
    deletedAt: null,
  } as never)
  if (existing > 0) return { skipped: true, reason: 'demo billing accounts already exist' }

  await exec('billing.settings.update', ACME_BILLING_SETTINGS)

  const accountIds: Record<string, string> = {}
  const posted: Record<string, PostedInvoiceRef | undefined> = {}
  const missingCustomers: string[] = []

  for (const spec of ACME_ACCOUNTS) {
    const customerId = customerIdByName.get(spec.customerName)
    if (!customerId) {
      missingCustomers.push(spec.customerName)
      continue
    }
    const accountId = spec.fromCpq ? options.cpqAccountIds?.[spec.key] : await createAccount(spec, customerId)
    if (!accountId) continue
    accountIds[spec.key] = accountId
    await replaySteps(spec, accountId)
  }

  // ── Bank statement: import, then the manual assignments ──
  let payments = 0
  const { content, rows } = buildAcmePaymentsCsv(PAYMENT_CSV_HEADER.join(','), isoDay(anchor), posted)
  if (rows.length > 0) {
    const summary = await exec<{ importId: string }>('billing.payments.import', {
      fileName: ACME_PAYMENT_FILE_NAME,
      content,
    })
    payments = rows.length
    const imported = await fresh().find(
      BillingPayment,
      { ...scope, importId: summary.importId, status: 'unmatched' } as never,
      { orderBy: { createdAt: 'ASC' } },
    )
    for (const row of rows) {
      const target = row.assignTo ? accountIds[row.assignTo] : undefined
      if (!target) continue
      const idx = imported.findIndex((p) => p.reference === row.reference && p.currencyCode === row.currency)
      if (idx < 0) continue
      const [payment] = imported.splice(idx, 1)
      await exec('billing.payments.assign', { paymentId: payment.id, billAccountId: target })
    }
  }

  return {
    skipped: false,
    accounts: Object.keys(accountIds),
    missingCustomers,
    posted: Object.values(posted).map((p) => p!.number),
    payments,
  }

  async function createAccount(spec: AcmeAccount, customerId: string): Promise<string> {
    const { id } = await exec<{ id: string }>('billing.accounts.create', {
      customerId,
      customerKind: spec.customerKind,
      name: spec.customerName,
      currencyCode: spec.currencyCode,
      billCycle: 'monthly',
      billCycleInterval: 1,
      billCycleDay: spec.billCycleDay,
      nextBillDate: acmeDate(anchor, spec.nextBillDate),
      invoiceEmail: spec.invoiceEmail ?? `billing+${customerId}@invalid.local`,
      invoiceLanguage: 'en',
      invoiceAddress: spec.invoiceAddress,
      billingMode: spec.billingMode,
    })
    return id
  }

  async function replaySteps(spec: AcmeAccount, accountId: string): Promise<void> {
    for (const step of spec.steps) {
      if (step.kind === 'items') {
        for (const ref of step.refs) {
          const item = spec.items.find((i) => i.ref === ref)!
          await exec('billing.items.create', {
            billAccountId: accountId,
            type: item.type,
            billStartDate: acmeDate(anchor, item.start),
            description: item.description,
            rateJson: item.rateJson,
            uomCode: item.uomCode,
            sourceRef: item.ref,
            taxRate: item.taxRate,
          })
        }
      } else if (step.kind === 'usage') {
        for (const ref of step.refs) {
          const usage = spec.usage.find((u) => u.ref === ref)!
          await exec('billing.usage.create', {
            billAccountId: accountId,
            uomCode: usage.uomCode,
            quantity: usage.quantity,
            periodStart: acmeDate(anchor, usage.from),
            periodEnd: acmeDate(anchor, usage.to),
            sourceRef: usage.ref,
          })
        }
      } else if (step.kind === 'topUp') {
        await exec('billing.transactions.adjust', {
          billAccountId: accountId,
          amount: step.amount,
          description: 'Top-Up',
          sourceRef: step.ref,
        })
      } else {
        const { billRunId } = await exec<{ billRunId: string }>('billing.runs.trigger', {
          mode: 'real',
          asOfDate: acmeDate(anchor, step.asOf),
          scopedAccountIds: [accountId],
        })
        if (!step.post) continue
        const drafts = await fresh().find(
          BillingInvoice,
          { ...scope, billRunId, status: 'draft', deletedAt: null } as never,
          { orderBy: { createdAt: 'ASC' } },
        )
        for (const draft of drafts) {
          const res = await exec<{ invoiceNumber: string }>('billing.invoices.post', { invoiceId: draft.id })
          posted[spec.key] ??= { number: res.invoiceNumber, totalGross: draft.totalGross }
        }
      }
    }
  }
}
