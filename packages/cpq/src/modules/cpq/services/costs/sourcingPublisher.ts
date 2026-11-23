import type { EntityManager } from '@mikro-orm/postgresql'
import { emitCpqEvent } from '../../events'
import { CpqChargeCostElement, CpqPricingTable, CpqQuoteLineConfiguration, CpqQuoteLineCost } from '../../data/entities'
import { driverAttributes } from './costResolution'
import { buildSourcingEvents, NO_ENRICHMENT, type RequestedEnrichment, type SourcingEmit } from './sourcingEventBuffer'
import type { SourcingSignal, SourcingSignalPublisher } from './sourcingSignals'

/**
 * The `SourcingSignalPublisher` the producers hand their signals to AFTER the quote transaction committed
 * (`withQuotePricingWrite({ afterCommit })`): maps them to the non-broadcast `cpq.quote.cost_requested` /
 * `cost_request_cancelled` / `cost_valued` events. Never throws: a failure is logged and the write stands.
 */
export function createSourcingPublisher(deps: { em: EntityManager; emit?: SourcingEmit }): SourcingSignalPublisher {
  const emit: SourcingEmit = deps.emit ?? (emitCpqEvent as unknown as SourcingEmit)
  return async (signals, quote) => {
    if (signals.length === 0) return
    try {
      const enrichment = await loadEnrichment(deps.em, signals, quote)
      const buffer = buildSourcingEvents(signals, quote, enrichment)
      await buffer.flush(emit, (eventId, error) => console.error(`[cpq] failed to emit ${eventId} for quote ${quote.id}`, error))
    } catch (error) {
      console.error(`[cpq] failed to publish sourcing events for quote ${quote.id}`, error)
    }
  }
}

/** Product / offering and driver attributes of the opened requests' lines. Best effort: a missing row leaves the empty enrichment. */
async function loadEnrichment(
  rootEm: EntityManager, signals: readonly SourcingSignal[], quote: { tenantId: string; organizationId: string },
): Promise<Map<string, RequestedEnrichment>> {
  const requested = signals.filter((signal) => signal.kind === 'requested')
  const result = new Map<string, RequestedEnrichment>()
  if (requested.length === 0) return result
  try {
    const em = rootEm.fork({ clear: true, useContext: false })
    const scope = { tenantId: quote.tenantId, organizationId: quote.organizationId, deletedAt: null }
    const lineIds = [...new Set(requested.map((signal) => signal.quoteLineId))]
    const costIds = [...new Set(requested.map((signal) => signal.costLineId))]
    const [lines, costs] = await Promise.all([
      em.find(CpqQuoteLineConfiguration, { ...scope, quoteLineId: { $in: lineIds } }),
      em.find(CpqQuoteLineCost, { ...scope, id: { $in: costIds } }),
    ])
    const elementIds = [...new Set(costs.map((cost) => cost.costElementId).filter((id): id is string => !!id))]
    const elements = elementIds.length ? await em.find(CpqChargeCostElement, { ...scope, id: { $in: elementIds } }) : []
    const tableIds = [...new Set(elements.map((element) => element.costTableId).filter((id): id is string => !!id))]
    const tables = tableIds.length ? await em.find(CpqPricingTable, { ...scope, id: { $in: tableIds } }) : []
    const lineById = new Map(lines.map((line) => [line.quoteLineId, line]))
    const costById = new Map(costs.map((cost) => [cost.id, cost]))
    const elementById = new Map(elements.map((element) => [element.id, element]))
    const tableById = new Map(tables.map((table) => [table.id, table]))
    for (const signal of requested) {
      const line = lineById.get(signal.quoteLineId)
      const cost = costById.get(signal.costLineId)
      const element = cost?.costElementId ? elementById.get(cost.costElementId) : undefined
      const table = element?.costTableId ? tableById.get(element.costTableId) ?? null : null
      const configuration = (line?.configuration ?? {}) as Record<string, unknown>
      result.set(signal.costLineId, {
        productId: line?.productId ?? null, offeringId: line?.offeringId ?? null,
        attributes: element ? Object.fromEntries(driverAttributes(element, table).map((key) => [key, configuration[key] ?? null])) : {},
      })
    }
  } catch (error) {
    console.error('[cpq] could not enrich cost_requested events', error)
  }
  return result.size > 0 ? result : new Map(requested.map((signal) => [signal.costLineId, NO_ENRICHMENT]))
}
