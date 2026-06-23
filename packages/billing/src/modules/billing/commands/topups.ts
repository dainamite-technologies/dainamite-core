import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { BillingAccount, BillingTopup } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import {
  billingTopupCreateSchema,
  type BillingTopupCreateInput,
} from '../data/validators'
import { formatMoney } from '../lib/money'
import { getTopupProvider } from '../lib/prepaidConfig'

/**
 * Top-up initiation (SPEC-002 P2).
 *
 * Registers a first-class `BillingTopup` (status=pending), then opens a
 * payment session via `core/payment_gateways`. The balance is NOT credited
 * here — that happens on the `payment_gateways.payment.captured` event (see
 * subscribers/prepaid-topup-captured.ts), so the money trail is always
 * explainable: a top-up only credits the balance once the gateway confirms
 * capture.
 */

const topupIndexer = { entityType: billingEntityIds.topup } as const
const topupEvents = { module: 'billing', entity: 'topup', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

export type CreateTopupResult = {
  topupId: string
  paymentId: string
  status: string
  transactionId: string | null
  redirectUrl: string | null
  clientSecret: string | null
}

const createTopupCommand: CommandHandler<BillingTopupCreateInput, CreateTopupResult> = {
  id: 'billing.topups.create',

  async execute(rawInput, ctx) {
    const parsed = billingTopupCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const account = await em.findOne(BillingAccount, {
      id: parsed.billAccountId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!account) {
      throw new CrudHttpError(404, { error: 'Billing account not found' })
    }
    if (account.billingMode !== 'prepaid') {
      throw new CrudHttpError(409, {
        error: 'Top-ups are only available on prepaid accounts',
        code: 'billing.account.not_prepaid',
      })
    }

    // Idempotency on the initiating request: a retried POST with the same
    // sourceRef returns the prior (still-pending) top-up + its session links
    // rather than opening a second session.
    if (parsed.sourceRef) {
      const existing = await em.findOne(BillingTopup, {
        tenantId: parsed.tenantId,
        billAccountId: account.id,
        sourceRef: parsed.sourceRef,
        deletedAt: null,
      })
      if (existing) {
        const meta = (existing.metadata as Record<string, unknown> | null) ?? {}
        return {
          topupId: existing.id,
          paymentId: existing.paymentId,
          status: existing.status,
          transactionId: existing.gatewayTransactionId ?? null,
          redirectUrl: (meta.redirect_url as string | null) ?? null,
          clientSecret: (meta.client_secret as string | null) ?? null,
        }
      }
    }

    const providerKey = parsed.providerKey ?? (await getTopupProvider(em))
    const paymentId = randomUUID()
    const now = new Date()
    const topup = em.create(BillingTopup, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      billAccountId: account.id,
      status: 'pending',
      amount: formatMoney(parsed.amount),
      currencyCode: account.currencyCode,
      providerKey,
      paymentId,
      sourceRef: parsed.sourceRef ?? null,
      metadata: {
        success_url: parsed.successUrl ?? null,
        cancel_url: parsed.cancelUrl ?? null,
      },
      createdAt: now,
      updatedAt: now,
    })
    em.persist(topup)
    await em.flush()

    // Open the gateway session. captureMethod 'automatic' so a successful
    // checkout fires `payment.captured` directly (our capture subscriber
    // credits the balance + issues the receipt).
    const gateway = ctx.container.resolve('paymentGatewayService') as PaymentGatewayService
    const { transaction, session } = await gateway.createPaymentSession({
      providerKey,
      paymentId,
      amount: parsed.amount,
      currencyCode: account.currencyCode,
      captureMethod: 'automatic',
      successUrl: parsed.successUrl,
      cancelUrl: parsed.cancelUrl,
      metadata: {
        kind: 'prepaid_topup',
        billAccountId: account.id,
        topupId: topup.id,
      },
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })

    topup.gatewayTransactionId = transaction.id
    topup.metadata = {
      ...(topup.metadata as Record<string, unknown>),
      redirect_url: session.redirectUrl ?? null,
      client_secret: session.clientSecret ?? null,
      session_id: session.sessionId ?? null,
    }
    topup.updatedAt = new Date()
    await em.flush()

    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'created',
      entity: topup,
      identifiers: {
        id: topup.id,
        tenantId: topup.tenantId,
        organizationId: topup.organizationId,
      },
      indexer: topupIndexer,
      events: topupEvents,
    })

    return {
      topupId: topup.id,
      paymentId,
      status: topup.status,
      transactionId: transaction.id,
      redirectUrl: session.redirectUrl ?? null,
      clientSecret: session.clientSecret ?? null,
    }
  },
}

registerCommand(createTopupCommand)

export { createTopupCommand }
