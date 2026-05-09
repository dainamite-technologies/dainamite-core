import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

export type CpqRouteContext = {
  container: AwilixContainer
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  em: EntityManager
  organizationId: string
  tenantId: string
  organizationScope: OrganizationScope | null
  translate: (key: string, fallback?: string) => string
}

export async function resolveCpqRouteContext(req: Request): Promise<CpqRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new Error('Unauthorized')
  }
  const { organizationId: resolvedOrgId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  const organizationId = resolvedOrgId ?? ''
  const tenantId = scope?.tenantId ?? auth.tenantId ?? ''
  const em = container.resolve('em') as EntityManager
  return {
    container,
    auth,
    em,
    organizationId,
    tenantId,
    organizationScope: scope ?? null,
    translate,
  }
}
