import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'

/** Names for the notification text: quote number, product name. Missing rows fall back to empty strings (never an amount). */
export async function loadCostNotificationNames(
  em: EntityManager, scope: { tenantId: string; organizationId: string }, ids: { salesQuoteId?: string | null; quoteLineId?: string | null },
): Promise<{ quoteNumber: string; productName: string }> {
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const quote = ids.salesQuoteId ? await em.findOne(SalesQuote, { ...where, id: ids.salesQuoteId }) : null
  const line = ids.quoteLineId ? await em.findOne(SalesQuoteLine, { ...where, id: ids.quoteLineId }) : null
  return { quoteNumber: quote?.quoteNumber ?? '', productName: line?.name ?? '' }
}
