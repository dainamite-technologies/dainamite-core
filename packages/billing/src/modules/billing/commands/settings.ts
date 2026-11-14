import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { billingSettingsUpdateSchema, type BillingSettingsUpdateInput } from '../data/validators'
import { getBillingSettings, serializeBillingSettings } from '../lib/billingSettings'

/**
 * `billing.settings.update` — edits the organization's billing settings
 * (Spec 0: prepaid defaults + document number masks; Spec B adds seller
 * fields). The row always exists (lazily created), so this is a partial
 * update of one row per organization. Masks are validated by the schema.
 */

function getEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function money4(value: number): string {
  return (Math.round(value * 10000) / 10000).toFixed(4)
}

const updateSettingsCommand: CommandHandler<
  BillingSettingsUpdateInput,
  ReturnType<typeof serializeBillingSettings>
> = {
  id: 'billing.settings.update',

  async execute(rawInput, ctx) {
    const parsed = billingSettingsUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = getEm(ctx)
    const settings = await getBillingSettings(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (parsed.lowBalanceThresholdDefault !== undefined) {
      settings.lowBalanceThresholdDefault = money4(parsed.lowBalanceThresholdDefault)
    }
    if (parsed.nearLimitBufferDefault !== undefined) {
      settings.nearLimitBufferDefault = money4(parsed.nearLimitBufferDefault)
    }
    if (parsed.statementEnabled !== undefined) settings.statementEnabled = parsed.statementEnabled
    if (parsed.topupTaxRate !== undefined) settings.topupTaxRate = parsed.topupTaxRate.toFixed(4)
    if (parsed.topupProvider !== undefined) settings.topupProvider = parsed.topupProvider
    if (parsed.numberMasks !== undefined) {
      settings.numberMasks = { ...(settings.numberMasks ?? {}), ...stripUndefined(parsed.numberMasks) }
    }
    settings.updatedAt = new Date()
    await em.flush()
    return serializeBillingSettings(settings)
  },
}

function stripUndefined(masks: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(masks)) if (value !== undefined) out[key] = value
  return out
}

registerCommand(updateSettingsCommand)

export { updateSettingsCommand }
