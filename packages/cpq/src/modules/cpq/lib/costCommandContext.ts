import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveAuditActor } from './auditActor'
import { QuotingError } from '../services/cpqQuotingService'
import type { CpqQuoteCostService } from '../services/costs/quoteCostService'

/**
 * Shared command preamble of the quote cost commands: authenticated subject,
 * audit actor, scope, and the immutable feature IDs (never role names).
 */
export async function costCommandContext(ctx: CommandRuntimeContext) {
  const subject = ctx.auth?.sub
  const actor = resolveAuditActor(ctx.auth)
  const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId
  if (!subject || !tenantId || !organizationId) throw new QuotingError(403, 'An authenticated tenant and organization are required')
  if (!actor) throw new QuotingError(403, 'Cost changes require a user or a user-bound API key')
  const scope = { tenantId, organizationId }
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  if (!(await rbac.userHasAllFeatures(subject, ['cpq.quotes.manage', 'cpq.costs.manage'], scope))) throw new QuotingError(403, 'Cost management permission required')
  return { actor, scope, service: ctx.container.resolve<CpqQuoteCostService>('cpqQuoteCostService') }
}
