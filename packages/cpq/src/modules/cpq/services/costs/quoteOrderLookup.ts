import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqOrderConfiguration, CpqOrderLineCost, type CpqQuoteConfiguration } from '../../data/entities'
import type { TenantScope } from '../types'

/**
 * The one "quote has an order" check (`409 QUOTE_CONVERTED { orderId, orderLineCostId }`): the sourcing writes, the cost
 * PATCH on a converted quote and the ARC mirror refresh / restore all read it from here. Returns `null` while the quote
 * has no order. `orderLineCostId` is the order line cost copied from `costId` (ARC costs Q7), when a cost line is named.
 * Reads only. Lives apart from the services so it has no import cycle with `cpqQuotingService`.
 */
export async function findQuoteOrder(
  em: EntityManager, quote: Pick<CpqQuoteConfiguration, 'id'>, scope: TenantScope, costId?: string,
): Promise<{ orderId: string; orderLineCostId: string | null } | null> {
  const tenant = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  const order = await em.findOne(CpqOrderConfiguration, { sourceQuoteId: quote.id, ...tenant })
  if (!order) return null
  const copy = costId ? await em.findOne(CpqOrderLineCost, { sourceQuoteLineCostId: costId, orderConfigurationId: order.id, ...tenant }) : null
  return { orderId: order.id, orderLineCostId: copy?.id ?? null }
}
