import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'
import type { MarginSignal, MarginTracker } from '../costs/quoteMarginTracker'
import { captureQuoteEventState, emitQuoteWriteEvents, type QuoteEventState, type QuoteWriteEvents } from './quotePricingEvents'

export type QuotePricingWriteOptions<T> = {
  expectedRevision?: number
  validate?: (quote: CpqQuoteConfiguration) => void
  events?: QuoteWriteEvents
  marginTracker?: MarginTracker
  /**
   * Runs after the lock (and the revision / validate checks) and BEFORE the revision bump. A non-undefined
   * result is returned as-is: `execute` is skipped, the revision is not bumped and no event fires. It must
   * not mutate managed entities (it is for refusals and idempotent no-ops); throw to refuse.
   */
  shortCircuit?: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T | undefined> | T | undefined
  /** Runs once after the transaction committed and the quote events were emitted. Errors are logged and swallowed. */
  afterCommit?: (result: T, quote: CpqQuoteConfiguration) => Promise<void> | void
}

/** Every pricing write and conversion locks the same scoped aggregate row. Trailing options: object form or the positional overload. */
export async function withQuotePricingWrite<T>(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
  execute: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>,
  makeError: (status: number, message: string) => Error,
  options?: QuotePricingWriteOptions<T>,
): Promise<T>
export async function withQuotePricingWrite<T>(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
  execute: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>,
  makeError: (status: number, message: string) => Error,
  expectedRevision?: number,
  validate?: (quote: CpqQuoteConfiguration) => void,
  events?: QuoteWriteEvents,
  marginTracker?: MarginTracker,
): Promise<T>
export async function withQuotePricingWrite<T>(
  em: EntityManager,
  quoteId: string,
  scope: TenantScope,
  execute: (transaction: EntityManager, quote: CpqQuoteConfiguration) => Promise<T>,
  makeError: (status: number, message: string) => Error,
  optionsOrRevision?: QuotePricingWriteOptions<T> | number,
  validateArg?: (quote: CpqQuoteConfiguration) => void,
  eventsArg?: QuoteWriteEvents,
  marginTrackerArg?: MarginTracker,
): Promise<T> {
  const opts: QuotePricingWriteOptions<T> = typeof optionsOrRevision === 'object' && optionsOrRevision !== null
    ? optionsOrRevision
    : { expectedRevision: optionsOrRevision, validate: validateArg, events: eventsArg, marginTracker: marginTrackerArg }
  const { expectedRevision, validate, marginTracker, shortCircuit, afterCommit } = opts
  const events: QuoteWriteEvents = opts.events ?? { pricingCause: 'recalculate' }
  // Do not inherit managed objects/pending writes or propagate committed state
  // back into the caller's identity map. The returned DTO is authoritative;
  // callers that need fresh entities must reload them in their own context.
  // The isolated fork opens its own connection. Called from inside another
  // transaction it could not see that transaction's uncommitted quote, and it
  // would block forever on a row lock that transaction holds — fail fast.
  if (em.isInTransaction?.()) throw new Error('withQuotePricingWrite must not run inside an existing transaction')
  const isolated = em.fork({ clear: true, useContext: false })
  const committed: { quote?: CpqQuoteConfiguration; before?: QuoteEventState; margin?: MarginSignal | null } = {}
  const result = await isolated.transactional(async (transaction) => {
    const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
    const options = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    const quote = await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, id: quoteId }, options, scope)
      ?? await findOneWithDecryption(transaction, CpqQuoteConfiguration, { ...scoped, quoteId }, options, scope)
    if (!quote) throw makeError(404, 'Quote not found')
    const revision = quote.pricingRevision ?? 0
    if (expectedRevision !== undefined && expectedRevision !== revision) throw makeError(409, 'STALE_REVISION')
    validate?.(quote)
    if (shortCircuit) {
      const early = await shortCircuit(transaction, quote)
      if (early !== undefined) return early
    }
    committed.quote = quote
    await marginTracker?.before(transaction, quote)
    committed.before = captureQuoteEventState(quote)
    // This scalar update and every later flush are inside the same DB transaction.
    let written!: T
    await withAtomicFlush(transaction, [
      () => { quote.pricingRevision = revision + 1 },
      async () => { written = await execute(transaction, quote) },
    ])
    committed.margin = (await marginTracker?.after(transaction, quote)) ?? null
    return written
  }, { clear: true })
  // `transactional` resolved, so the write is committed; a rolled-back write never reaches here.
  if (committed.quote && committed.before) {
    await emitQuoteWriteEvents(committed.before, committed.quote, events, undefined, committed.margin ?? null)
    if (afterCommit) {
      try {
        await afterCommit(result, committed.quote)
      } catch (error) {
        console.error(`[cpq] afterCommit failed for quote ${committed.quote.id}`, error)
      }
    }
  }
  return result
}
