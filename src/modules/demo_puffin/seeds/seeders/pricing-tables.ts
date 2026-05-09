import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BANDWIDTH_TIERS,
  CDN_EGRESS_TIERS,
  COMPUTE_PRICING,
  DB_PRICING,
} from '../data/pricing'
import { BLOCK_STORAGE, WORKSPACE } from '../data/products'
import type { SeedScope } from './_types'

/**
 * Idempotent helpers shared across pricing-table seeders.
 */
async function ensureTable(
  em: EntityManager,
  scope: SeedScope,
  data: {
    code: string
    name: string
    dimensions: Array<{ key: string; label: string }>
    priceColumns: Array<{ key: string; label: string }>
    currencyCodeList: string[]
  },
): Promise<string> {
  const { CpqPricingTable } = await import('@dainamite/cpq/modules/cpq/data/entities')
  let table = await em.findOne(CpqPricingTable, { ...scope, code: data.code })
  if (!table) {
    table = em.create(CpqPricingTable, { ...scope, ...data })
    em.persist(table)
    await em.flush()
  }
  return table.id
}

async function ensureEntry(
  em: EntityManager,
  scope: SeedScope,
  tableId: string,
  lookup: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<void> {
  const { CpqPricingTableEntry } = await import('@dainamite/cpq/modules/cpq/data/entities')
  const exists = await em.findOne(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, ...lookup })
  if (!exists) {
    em.persist(em.create(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, currencyCode: 'USD', ...data }))
  }
}

export async function seedPuffinPricingTables(em: EntityManager, scope: SeedScope): Promise<void> {
  // Compute family × size
  const computeTableId = await ensureTable(em, scope, {
    code: 'puffin_compute_pricing',
    name: 'Puffin Compute Pricing',
    dimensions: [
      { key: 'instance_family', label: 'Instance Family' },
      { key: 'instance_size', label: 'Instance Size' },
    ],
    priceColumns: [{ key: 'price_per_hour', label: 'Price per Hour' }],
    currencyCodeList: ['USD'],
  })
  for (const row of COMPUTE_PRICING) {
    const dim = { instance_family: row.family, instance_size: row.size }
    await ensureEntry(em, scope, computeTableId, { dimensionValues: dim }, {
      dimensionValues: dim,
      prices: { price_per_hour: row.price_per_hour },
    })
  }
  await em.flush()

  // CDN egress tiers
  const cdnTableId = await ensureTable(em, scope, {
    code: 'puffin_cdn_egress_pricing',
    name: 'Puffin CDN Egress Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_gb', label: 'Price per GB' }],
    currencyCodeList: ['USD'],
  })
  for (const t of CDN_EGRESS_TIERS) {
    await ensureEntry(em, scope, cdnTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_gb: t.per_gb },
    })
  }
  await em.flush()

  // Standalone bandwidth tiers
  const bwTableId = await ensureTable(em, scope, {
    code: 'puffin_bandwidth_pricing',
    name: 'Puffin Bandwidth Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_gb', label: 'Price per GB' }],
    currencyCodeList: ['USD'],
  })
  for (const t of BANDWIDTH_TIERS) {
    await ensureEntry(em, scope, bwTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_gb: t.per_gb },
    })
  }
  await em.flush()

  // Workspace per-seat pricing — one row per offering, dimensioned by
  // offering_code so the public price route can inject the offering's code
  // and `calculatePerUnit` will multiply unit price × seat_count. This
  // replaces the previous broken `per_unit + fixedPrice` shape on the
  // workspace charges, which CPQ's engine treats as a flat $unit total
  // (ignoring quantityAttributeCode) — see cpqPricingService.calculateCharge.
  const workspaceSeatTableId = await ensureTable(em, scope, {
    code: 'puffin_workspace_seat_pricing',
    name: 'Puffin Workspace — Per-Seat Pricing',
    dimensions: [{ key: 'offering_code', label: 'Offering Code' }],
    priceColumns: [{ key: 'per_seat', label: 'Price per Seat (Monthly)' }],
    currencyCodeList: ['USD'],
  })
  for (const offer of WORKSPACE.offerings) {
    const dtv = offer.designTimeValues as Record<string, number> | undefined
    const seatPrice = dtv?.seat_price
    if (seatPrice == null) continue
    const dim = { offering_code: offer.code }
    await ensureEntry(em, scope, workspaceSeatTableId, { dimensionValues: dim }, {
      dimensionValues: dim,
      prices: { per_seat: seatPrice },
    })
  }
  await em.flush()

  // Block Storage per-GB pricing — one row per offering, dimensioned by
  // offering_code. Same rationale as Workspace above.
  const blockStorageTableId = await ensureTable(em, scope, {
    code: 'puffin_block_storage_pricing',
    name: 'Puffin Block Storage — Per-GB Pricing',
    dimensions: [{ key: 'offering_code', label: 'Offering Code' }],
    priceColumns: [{ key: 'per_gb', label: 'Price per GB-Month' }],
    currencyCodeList: ['USD'],
  })
  for (const offer of BLOCK_STORAGE.offerings) {
    const dtv = offer.designTimeValues as Record<string, number> | undefined
    const pricePerGb = dtv?.price_per_gb
    if (pricePerGb == null) continue
    const dim = { offering_code: offer.code }
    await ensureEntry(em, scope, blockStorageTableId, { dimensionValues: dim }, {
      dimensionValues: dim,
      prices: { per_gb: pricePerGb },
    })
  }
  await em.flush()

  // Managed DB engine × plan × ha
  const dbTableId = await ensureTable(em, scope, {
    code: 'puffin_managed_db_pricing',
    name: 'Puffin Managed DB Pricing',
    dimensions: [
      { key: 'db_engine', label: 'Engine' },
      { key: 'plan_size', label: 'Plan Size' },
      { key: 'ha_replicas', label: 'HA Replicas' },
    ],
    priceColumns: [{ key: 'mrc', label: 'Monthly Recurring (MRC)' }],
    currencyCodeList: ['USD'],
  })
  for (const row of DB_PRICING) {
    const dim = {
      db_engine: row.engine,
      plan_size: row.plan,
      ha_replicas: String(row.ha_replicas),
    }
    await ensureEntry(em, scope, dbTableId, { dimensionValues: dim }, {
      dimensionValues: dim,
      prices: { mrc: row.mrc },
    })
  }
  await em.flush()
}
