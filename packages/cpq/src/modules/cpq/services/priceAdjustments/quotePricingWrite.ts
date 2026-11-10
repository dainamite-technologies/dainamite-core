import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'

/** Every pricing write and conversion locks the same scoped aggregate row. */
export async function withQuotePricingWrite<T>(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
  execute: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>,
  makeError: (status: number, message: string) => Error,
  expectedRevision?: number,
): Promise<T> {
  // Do not inherit managed objects/pending writes or propagate committed state
  // back into the caller's identity map. The returned DTO is authoritative;
  // callers that need fresh entities must reload them in their own context.
  const isolated = em.fork({ clear: true, useContext: false })
  return isolated.transactional(async (transaction) => {
    const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
    const options = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    const quote = await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, id: quoteId }, options, scope)
      ?? await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, quoteId }, options, scope)
    if (!quote) throw makeError(404, 'Quote not found')
    const revision = quote.pricingRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== revision) throw makeError(409, 'STALE_REVISION')
    // This scalar update and every later flush are inside the same DB transaction.
    quote.pricingRevision = revision + 1
    const result = await execute(transaction, quote)
    await transaction.flush()
    return result
  }, { clear: true })
}
