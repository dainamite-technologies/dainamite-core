import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { COSTS_VIEW_FEATURE } from '../../data/costs'
import type { CpqRouteContext } from '../context'

/**
 * Server-side `cpq.costs.view` check for the authenticated subject (wildcard-
 * aware through the RBAC service). Cost data in a response is gated by this,
 * never by client-side hiding (App Spec §1.4.10).
 */
export async function canViewCosts(ctx: Pick<CpqRouteContext, 'container' | 'auth' | 'tenantId' | 'organizationId'>): Promise<boolean> {
  const subject = ctx.auth?.sub
  if (!subject) return false
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  return rbac.userHasAllFeatures(subject, [COSTS_VIEW_FEATURE], { tenantId: ctx.tenantId, organizationId: ctx.organizationId || null })
}
