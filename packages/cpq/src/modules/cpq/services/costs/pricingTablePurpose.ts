import type { EntityManager } from '@mikro-orm/postgresql'
import { CpqChargeCostElement, CpqPricingTable, CpqProductCharge } from '../../data/entities'
import type { TenantScope } from '../types'
import { QuotingError } from '../cpqQuotingService'

/** Whether any non-deleted charge or cost element references the table. */
export async function isPricingTableReferenced(em: EntityManager, tableId: string, scope: TenantScope): Promise<boolean> {
  const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null }
  const charges = await em.count(CpqProductCharge, { ...scoped, pricingTableId: tableId })
  if (charges > 0) return true
  const elements = await em.count(CpqChargeCostElement, { ...scoped, costTableId: tableId })
  return elements > 0
}

/**
 * `purpose` is immutable while the table is referenced (`422 PURPOSE_LOCKED`):
 * flipping it would turn a price lookup into a confidential cost lookup, or
 * the reverse, under existing charges and cost elements.
 */
export async function assertPurposeChangeAllowed(
  em: EntityManager,
  table: { id: string; purpose: string },
  nextPurpose: string | undefined,
  scope: TenantScope,
): Promise<void> {
  if (nextPurpose === undefined || nextPurpose === table.purpose) return
  if (await isPricingTableReferenced(em, table.id, scope)) throw new QuotingError(422, 'PURPOSE_LOCKED')
}

/**
 * A price charge never looks its price up in a cost table (App Spec §1.3
 * "Cost table"): `422 WRONG_TABLE_PURPOSE`.
 */
export async function assertPriceTable(em: EntityManager, tableId: string | null | undefined, scope: TenantScope): Promise<void> {
  if (!tableId) return
  const costTables = await em.count(CpqPricingTable, {
    id: tableId, organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null, purpose: 'cost',
  })
  if (costTables > 0) throw new QuotingError(422, 'WRONG_TABLE_PURPOSE')
}
