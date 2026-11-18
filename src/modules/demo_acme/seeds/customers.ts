import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

export type Scope = { tenantId: string; organizationId: string }

/**
 * Core example customers of the organization, keyed by display name.
 * Names are encrypted at rest, so they are decrypted and matched in memory;
 * the example set is small (bounded by `limit`).
 */
export async function loadExampleCustomerIds(em: EntityManager, scope: Scope): Promise<Map<string, string>> {
  const customers = await findWithDecryption(
    em,
    CustomerEntity,
    { ...scope, deletedAt: null } as never,
    { limit: 500 },
    scope,
  )
  return new Map(customers.map((c) => [c.displayName, c.id]))
}
