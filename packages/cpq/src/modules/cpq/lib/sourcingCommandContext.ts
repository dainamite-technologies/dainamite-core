import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveAuditActor } from './auditActor'
import { QuotingError } from '../services/cpqQuotingService'
import type { CpqCostSourcingService } from '../services/costs/costSourcingService'

/**
 * Command preamble of the cost sourcing commands: authenticated subject, audit actor, scope and the immutable
 * feature IDs the command requires (never role names). Request / cancel need `cpq.quotes.manage` only.
 */
export async function sourcingCommandContext(ctx: CommandRuntimeContext, features: string[]) {
  const subject = ctx.auth?.sub
  const actor = resolveAuditActor(ctx.auth)
  const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId
  if (!subject || !tenantId || !organizationId) throw new QuotingError(403, 'An authenticated tenant and organization are required')
  if (!actor) throw new QuotingError(403, 'Cost requests require a user or a user-bound API key')
  const scope = { tenantId, organizationId }
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  if (!(await rbac.userHasAllFeatures(subject, features, scope))) throw new QuotingError(403, 'Permission required')
  return { actor, scope, service: ctx.container.resolve<CpqCostSourcingService>('cpqCostSourcingService') }
}
