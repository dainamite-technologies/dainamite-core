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
import { BillingAccount, BillingAccountBalance } from '../data/entities'
import { billingEntityIds } from '../data/entityIds'
import {
  billingTransactionAdjustSchema,
  type BillingTransactionAdjustInput,
  type BalanceStatus,
} from '../data/validators'
import { applyBalanceMovement } from '../lib/balanceLedger'
import { buildBalanceCrossingEvents } from '../lib/balanceEvents'
import { computeBalanceStatus, resolveLowBalanceThreshold } from '../lib/balanceStatus'
import { formatMoney } from '../lib/money'
import {
  getLowBalanceThresholdDefault,
  getNearLimitBufferDefault,
} from '../lib/prepaidConfig'
import { emitBillingEvent, type BillingEventId } from '../events'

/**
 * Manual balance adjustment (SPEC-002 P5).
 *
 * Operator-driven credit/debit (`type='adjustment'`) audited via `user_id`.
 * Non-fiscal by default — an adjustment moves already-taxed balance, so no
 * receipt is issued (Open Question #3; can be revisited per jurisdiction).
 * Goes through the same atomic ledger primitive as every other movement, so
 * the reconciliation invariant still holds.
 */

const transactionIndexer = { entityType: billingEntityIds.transaction } as const
const transactionEvents = { module: 'billing', entity: 'transaction', persistent: true } as const

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

export type AdjustResult = {
  transactionId: string
  balance: string
  balanceStatus: BalanceStatus
  deduplicated: boolean
}

const adjustTransactionCommand: CommandHandler<BillingTransactionAdjustInput, AdjustResult> = {
  id: 'billing.transactions.adjust',

  async execute(rawInput, ctx) {
    const parsed = billingTransactionAdjustSchema.parse(rawInput)
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
        error: 'Balance adjustments are only available on prepaid accounts',
        code: 'billing.account.not_prepaid',
      })
    }

    const balanceRow = await em.findOne(BillingAccountBalance, {
      tenantId: parsed.tenantId,
      billAccountId: account.id,
    })
    const threshold = resolveLowBalanceThreshold(
      balanceRow?.lowBalanceThreshold ?? null,
      await getLowBalanceThresholdDefault(em),
    )
    const nearLimitBuffer = await getNearLimitBufferDefault(em)
    const userId = (ctx.auth?.sub as string | undefined) ?? null

    const outcome = await em.transactional(async (tem) =>
      applyBalanceMovement(tem as EntityManager, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        billAccountId: account.id,
        currencyCode: account.currencyCode,
        type: 'adjustment',
        amount: formatMoney(parsed.amount),
        description: parsed.description,
        sourceRef: parsed.sourceRef ?? null,
        userId,
        metadata: { manual: true },
      }),
    )

    // Index the transaction + emit threshold-crossing events after commit.
    const created = outcome.transaction
    await emitCrudSideEffects({
      dataEngine: getDataEngine(ctx),
      action: 'created',
      entity: created,
      identifiers: {
        id: created.id,
        tenantId: created.tenantId,
        organizationId: created.organizationId,
      },
      indexer: transactionIndexer,
      events: transactionEvents,
    })

    if (!outcome.deduplicated) {
      const events = buildBalanceCrossingEvents({
        scope: {
          billAccountId: account.id,
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          currencyCode: account.currencyCode,
        },
        balanceBefore: outcome.balanceBefore,
        balanceAfter: outcome.balanceAfter,
        threshold,
        creditLimit: account.creditLimit ?? '0',
        nearLimitBuffer,
      })
      for (const ev of events) {
        await emitBillingEvent(ev.id as BillingEventId, ev.payload, { persistent: true })
      }
    }

    return {
      transactionId: created.id,
      balance: outcome.balanceAfter,
      balanceStatus: computeBalanceStatus(outcome.balanceAfter, threshold),
      deduplicated: outcome.deduplicated,
    }
  },
}

registerCommand(adjustTransactionCommand)

export { adjustTransactionCommand }
