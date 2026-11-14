import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CpqInventoryCost, CpqOrderLineCost, CpqQuoteLineCost } from '../entities'
import { INVENTORY_COST_OWNER_TYPES, INVENTORY_COST_STATUSES } from '../costs'

const MIGRATION = 'Migration20261114101001.ts'

/** The value / currency / FX / index / supplier / validity columns shared with quote cost lines (App Spec §1.4.6). */
const SHARED_VALUE_FIELDS = [
  'costKey', 'chargeCode', 'origin', 'costElementId', 'name', 'role', 'costType', 'source', 'costModel', 'valueStatus',
  'valueOrigin', 'unitAmount', 'instanceAmount', 'currencyCode', 'fxRate', 'fxRateDate', 'indexSnapshot', 'supplierId',
  'supplierName', 'supplierQuoteRef', 'validUntil', 'supplierTermEnd', 'supplierMinTermMonths', 'note',
] as const

describe('order line and inventory cost schema', () => {
  it('declares the inventory cost status and owner value sets', () => {
    expect([...INVENTORY_COST_STATUSES]).toEqual(['active', 'ended'])
    expect([...INVENTORY_COST_OWNER_TYPES]).toEqual(['subscription_item', 'asset'])
  })

  it('a new inventory cost is active with no owner, end date or change link yet', () => {
    const cost = new CpqInventoryCost()
    expect(cost.status).toBe('active')
    expect([cost.subscriptionItemId, cost.assetId, cost.endedAt, cost.lastChangeId, cost.lastOrderLineCostId, cost.totalAmount, cost.deletedAt])
      .toEqual([null, null, null, null, null, null, null])
  })

  it('a new order line cost has no inventory cost link and no re-confirmation yet', () => {
    const cost = new CpqOrderLineCost()
    expect([cost.inventoryCostId, cost.reconfirmedAt, cost.reconfirmedByUserId, cost.totalAmount, cost.deletedAt]).toEqual([null, null, null, null, null])
  })

  it('both entities carry every shared quote cost value field, plus total_amount', () => {
    const quote = new CpqQuoteLineCost() as unknown as Record<string, unknown>
    for (const entity of [new CpqOrderLineCost(), new CpqInventoryCost()] as unknown as Array<Record<string, unknown>>) {
      for (const field of SHARED_VALUE_FIELDS) {
        // nullable value columns default to null on both sides; required ones are unset on both sides
        expect([field, entity[field]]).toEqual([field, quote[field]])
      }
      expect('totalAmount' in entity).toBe(true)
    }
  })

  it('migration creates exactly the two tables with the partial uniques, the owner check and the status check', () => {
    const sql = readFileSync(path.join(__dirname, '..', '..', 'migrations', MIGRATION), 'utf8')
    expect(sql.match(/create table "[a-z_]+"/g)).toEqual(['create table "cpq_inventory_costs"', 'create table "cpq_order_line_costs"'])
    expect(sql).not.toMatch(/alter table "(?!cpq_inventory_costs)/)
    expect(sql).toContain('"cpq_order_line_costs" ("order_line_id", "cost_key") where "deleted_at" is null;')
    expect(sql).toContain('"cpq_inventory_costs" ("subscription_item_id", "cost_key") where "deleted_at" is null and "subscription_item_id" is not null;')
    expect(sql).toContain('"cpq_inventory_costs" ("asset_id", "cost_key") where "deleted_at" is null and "asset_id" is not null;')
    expect(sql).toContain('check (num_nonnulls("subscription_item_id", "asset_id") = 1)')
    for (const status of INVENTORY_COST_STATUSES) expect(sql).toContain(`'${status}'`)
    for (const column of ['total_amount', 'fx_rate', 'index_snapshot', 'supplier_min_term_months', 'reconfirmed_by_user_id', 'last_change_id', 'last_order_line_cost_id']) {
      expect(sql).toContain(`"${column}"`)
    }
    expect(sql).toContain('drop table if exists "cpq_order_line_costs" cascade;')
    expect(sql).toContain('drop table if exists "cpq_inventory_costs" cascade;')
  })
})
