import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BillingAccount } from '../data/entities'
import {
  billingStatementGenerateSchema,
  type BillingStatementGenerateInput,
} from '../data/validators'
import { runBillRun } from '../lib/billRunEngine'
import { TenantLockBusyError } from '../lib/tenantLock'

/**
 * Manual statement generation (SPEC-002 P3).
 *
 * Reuses the Bill Run engine scoped to a single prepaid account — so the same
 * recurring-charge + statement + anti-duplicate machinery runs, with the same
 * tenant lock. If the account is due (`next_bill_date <= asOfDate`) it produces
 * one statement (and advances the cycle); otherwise nothing is generated.
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function getContainer(ctx: CommandRuntimeContext): AwilixContainer {
  return ctx.container as AwilixContainer
}

export type GenerateStatementResult = {
  statementId: string | null
  billRunId: string
  status: string
}

const generateStatementCommand: CommandHandler<
  BillingStatementGenerateInput,
  GenerateStatementResult
> = {
  id: 'billing.statements.generate',

  async execute(rawInput, ctx) {
    const parsed = billingStatementGenerateSchema.parse(rawInput)
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
        error: 'Statements are only generated for prepaid accounts',
        code: 'billing.account.not_prepaid',
      })
    }

    const asOfDate = parsed.asOfDate ?? new Date()
    try {
      const { billRun, outcomes } = await runBillRun(em, getContainer(ctx), {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        asOfDate,
        triggeredBy: 'manual',
        mode: 'real',
        scopedAccountIds: [account.id],
      })
      const outcome = outcomes.find((o) => o.billAccountId === account.id)
      return {
        statementId: outcome?.statementId ?? null,
        billRunId: billRun.id,
        status: outcome?.status ?? billRun.status,
      }
    } catch (err) {
      if (err instanceof TenantLockBusyError) {
        throw new CrudHttpError(409, {
          error: 'Another Bill Run is already in progress for this tenant',
          code: 'billing.run.lock_busy',
          tenantId: err.tenantId,
          lockName: err.lockName,
        })
      }
      throw err
    }
  },
}

registerCommand(generateStatementCommand)

export { generateStatementCommand }
