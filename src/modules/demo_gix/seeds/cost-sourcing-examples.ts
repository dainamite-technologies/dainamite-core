import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CpqProductOffering, CpqQuoteConfiguration, CpqQuoteLineCost } from '@dainamite/cpq/modules/cpq/data/entities'
import type { TenantScope } from '@dainamite/cpq/modules/cpq/services/types'
import type { DefaultCpqQuotingService } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import type { CpqQuoteCostService } from '@dainamite/cpq/modules/cpq/services/costs/quoteCostService'
import type { CpqCostSourcingService } from '@dainamite/cpq/modules/cpq/services/costs/costSourcingService'
import { workingDaysBetween } from '@dainamite/cpq/modules/cpq/services/costs/costSourcing'
import { COST_ELEMENTS, COST_SOURCING_SCENARIOS, IP_TRANSIT, OVERDUE_WORKING_DAYS } from './data/cost-plus'

/** Seeds run without a signed-in user; the nil UUID marks system-authored demo rows. */
const SEED_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'
const ACME_DISPLAY_NAME = 'Acme Telecom S.A.'
const log = (msg: string) => console.log(`    [demo_gix:cost-sourcing] ${msg}`)
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** The latest instant whose age is at least `days` working days (so the request is overdue past the default threshold). */
export function requestedAtWorkingDaysAgo(days: number, now: Date = new Date()): Date {
  let back = days
  while (workingDaysBetween(new Date(now.getTime() - back * 86_400_000), now) < days) back++
  return new Date(now.getTime() - back * 86_400_000)
}

type TailCost = { id: string; costKey: string; sourcingStatus: string; costRequestId: string | null }

/**
 * Demo quotes for supplier cost sourcing, driven through the real services so request ids, history and answer
 * hashes are consistent: one partner-tail request open and overdue, one declined ("No coverage at site"), and one
 * answered on a `with_customer` (cost-locked) quote, which leaves a pending proposal. Idempotent per scenario
 * (marker in `quoteContext.scenario`). The catalog side (`requires_sourcing` + default supplier on the
 * "Partner tail" element) is seeded by `seedGixCostPlusCatalog`.
 */
export async function seedGixCostSourcingExamples(em: EntityManager, container: AwilixContainer, scope: TenantScope): Promise<void> {
  const companies = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'company', deletedAt: null }, { limit: 500 }, scope)
  const customer = companies.find((company) => company.displayName === ACME_DISPLAY_NAME)
  if (!customer) { log(`Skipping — "${ACME_DISPLAY_NAME}" not seeded.`); return }
  const offering = await em.findOne(CpqProductOffering, { ...scope, code: IP_TRANSIT.offerCode, deletedAt: null })
  if (!offering) { log('Skipping — the IP Transit offering is not seeded.'); return }
  const quoting = container.resolve('cpqQuotingService') as DefaultCpqQuotingService
  const costs = container.resolve('cpqQuoteCostService') as CpqQuoteCostService
  const sourcing = container.resolve('cpqCostSourcingService') as CpqCostSourcingService
  const existing = await em.find(CpqQuoteConfiguration, { ...scope, customerId: customer.id, deletedAt: null })
  const present = new Set(existing.map((quote) => (quote.quoteContext as Record<string, unknown> | null)?.scenario))

  const tailOf = async (quoteId: string): Promise<TailCost | undefined> => {
    const read = await costs.read(quoteId, scope, true)
    return read.lines.flatMap((line) => line.costs as unknown as TailCost[]).find((cost) => cost.costKey === COST_ELEMENTS.partnerTail)
  }
  /** A saved recalculation auto-opens the request (Q12); open one explicitly when it did not. */
  const ensureOpenRequest = async (quoteId: string): Promise<TailCost | undefined> => {
    let tail = await tailOf(quoteId)
    if (tail && tail.sourcingStatus !== 'requested') {
      await sourcing.request(quoteId, tail.id, {}, SEED_ACTOR_USER_ID, scope)
      tail = await tailOf(quoteId)
    }
    return tail?.sourcingStatus === 'requested' && tail.costRequestId ? tail : undefined
  }
  const createQuote = async (demo: { scenario: string; label: string; dataCentre: string }) => {
    let quote = await quoting.createQuote({
      customerId: customer.id, currencyCode: IP_TRANSIT.currency,
      quoteContext: { demo_marker: 'cpq-seed-v1', scenario: demo.scenario, label: demo.label },
    }, scope)
    quote = await quoting.addQuoteItem(quote.id, { offeringId: offering.id, configuration: { data_centre: demo.dataCentre }, quantity: 1, termMonths: 12 }, scope)
    const priced = await quoting.recalculate(quote.id, { save: true }, scope)
    // The saved recalculation settles the status (a valid quote is already `ready`): callers read it from here.
    return { id: quote.id, cpqStatus: (priced as { cpqStatus?: string } | undefined)?.cpqStatus }
  }
  /** Same guard as examples.ts: a transition to the current status is a 409, so skip it. */
  const safeTransition = async (current: { id: string; cpqStatus?: string }, target: string) =>
    current.cpqStatus === target ? current : (await quoting.transitionStatus(current.id, target, scope)) as { id: string; cpqStatus?: string }

  // 1. Requested and overdue: the request opened `OVERDUE_WORKING_DAYS` working days ago.
  const overdue = COST_SOURCING_SCENARIOS.requestedOverdue
  if (present.has(overdue.scenario)) log(`Skipping "${overdue.scenario}" — already present.`)
  else {
    const quote = await createQuote(overdue)
    const tail = await ensureOpenRequest(quote.id)
    if (!tail) log(`"${overdue.scenario}": no open partner-tail request — left as is.`)
    else {
      // Only the timestamp is back-dated directly: the service stamps `now`.
      await em.nativeUpdate(CpqQuoteLineCost, { id: tail.id, ...scope }, { requestedAt: requestedAtWorkingDaysAgo(OVERDUE_WORKING_DAYS) })
      log(`Quote for "${overdue.scenario}" created (request open ${OVERDUE_WORKING_DAYS} working days).`)
    }
  }

  // 2. Declined.
  const declined = COST_SOURCING_SCENARIOS.declined
  if (present.has(declined.scenario)) log(`Skipping "${declined.scenario}" — already present.`)
  else {
    const quote = await createQuote(declined)
    const tail = await ensureOpenRequest(quote.id)
    if (!tail) log(`"${declined.scenario}": no open partner-tail request — left as is.`)
    else {
      await sourcing.decline(quote.id, tail.id, { costRequestId: tail.costRequestId as string, reason: declined.reason }, SEED_ACTOR_USER_ID, scope)
      log(`Quote for "${declined.scenario}" created.`)
    }
  }

  // 3. Answered with a pending proposal: on a with_customer quote the cost lock keeps the price, so a different amount is a proposal.
  const proposal = COST_SOURCING_SCENARIOS.answeredProposal
  if (present.has(proposal.scenario)) log(`Skipping "${proposal.scenario}" — already present.`)
  else {
    const quote = await createQuote(proposal)
    const tail = await ensureOpenRequest(quote.id)
    if (!tail) log(`"${proposal.scenario}": no open partner-tail request — left as is.`)
    else {
      try {
        const ready = await safeTransition(quote, 'ready')
        await safeTransition(ready, 'with_customer')
      } catch (error) {
        log(`"${proposal.scenario}": could not move the quote to with_customer (${error instanceof Error ? error.message : String(error)}) — answer not applied.`)
        // The scenario marker lives on the quote: drop the half-built quote so the next seed run retries the scenario.
        await quoting.deleteQuote(quote.id, scope).catch(() => undefined)
        return
      }
      await sourcing.answer(quote.id, tail.id, {
        costRequestId: tail.costRequestId as string, unitAmount: proposal.answerAmount, currencyCode: IP_TRANSIT.currency,
        supplierQuoteRef: proposal.supplierQuoteRef, validUntil: isoDay(proposal.validDays),
      }, SEED_ACTOR_USER_ID, scope)
      log(`Quote for "${proposal.scenario}" created (proposal pending).`)
    }
  }
}
