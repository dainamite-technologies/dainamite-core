/**
 * Resolves the {organizationId, tenantId} that the Puffin public calculator
 * should use for direct-DB reads of CPQ data.
 *
 * The public calculator authenticates as `admin@puffin.com` (env-resolved) for
 * its loopback HTTP path. For the direct-DB fast path we don't go through HTTP
 * at all — we just need the same tenant scope. This module looks up the admin
 * user once and caches the resolved scope process-locally (it doesn't change
 * for the lifetime of the process).
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

export type PuffinTenantScope = {
  organizationId: string
  tenantId: string
}

type CacheEntry = {
  scope: PuffinTenantScope
}

const cacheByEmail = new Map<string, CacheEntry>()
const inFlightByEmail = new Map<string, Promise<PuffinTenantScope>>()

export class PuffinTenantContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PuffinTenantContextError'
  }
}

export async function resolvePuffinTenantContext(
  em: EntityManager,
  adminEmail: string,
): Promise<PuffinTenantScope> {
  const cached = cacheByEmail.get(adminEmail)
  if (cached) return cached.scope

  const inFlight = inFlightByEmail.get(adminEmail)
  if (inFlight) return inFlight

  const promise = (async () => {
    const auth = new AuthService(em)
    const user = await auth.findUserByEmail(adminEmail)
    if (!user) {
      throw new PuffinTenantContextError(`admin user not found: ${adminEmail}`)
    }
    if (!user.tenantId || !user.organizationId) {
      throw new PuffinTenantContextError(
        `admin user is missing tenant/org binding: ${adminEmail}`,
      )
    }
    const scope: PuffinTenantScope = {
      organizationId: user.organizationId,
      tenantId: user.tenantId,
    }
    cacheByEmail.set(adminEmail, { scope })
    return scope
  })().finally(() => {
    inFlightByEmail.delete(adminEmail)
  })
  inFlightByEmail.set(adminEmail, promise)
  return promise
}

export function _resetPuffinTenantContextForTests(): void {
  cacheByEmail.clear()
  inFlightByEmail.clear()
}
