import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'
import { captureQuoteEventState, emitQuoteWriteEvents, type QuoteEventState, type QuoteWriteEvents } from './quotePricingEvents'

/** Every pricing write and conversion locks the same scoped aggregate row. */
export async function withQuotePricingWrite<T>(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
  execute: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>,
  makeError: (status: number, message: string) => Error,
  expectedRevision?: number,
  validate?: (quote: CpqQuoteConfiguration) => void,
  events: QuoteWriteEvents = { pricingCause: 'recalculate' },
): Promise<T> {
  // Do not inherit managed objects/pending writes or propagate committed state
  // back into the caller's identity map. The returned DTO is authoritative;
  // callers that need fresh entities must reload them in their own context.
  const isolated = em.fork({ clear: true, useContext: false })
  const committed: { quote?: CpqQuoteConfiguration; before?: QuoteEventState } = {}
  const result = await isolated.transactional(async (transaction) => {
    const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
    const options = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    const quote = await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, id: quoteId }, options, scope)
      ?? await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, quoteId }, options, scope)
    if (!quote) throw makeError(404, 'Quote not found')
    const revision = quote.pricingRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== revision) throw makeError(409, 'STALE_REVISION')
    validate?.(quote)
    committed.quote = quote
    committed.before = captureQuoteEventState(quote)
    // This scalar update and every later flush are inside the same DB transaction.
    let written!: T
    await withAtomicFlush(transaction, [
      () => { quote.pricingRevision = revision + 1 },
      async () => { written = await execute(transaction, quote) },
    ])
    return written
  }, { clear: true })
  // `transactional` resolved, so the write is committed; a rolled-back write never reaches here.
  if (committed.quote && committed.before) await emitQuoteWriteEvents(committed.before, committed.quote, events)
  return result
}
