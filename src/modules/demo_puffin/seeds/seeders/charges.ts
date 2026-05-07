import type { EntityManager } from '@mikro-orm/postgresql'
import { ALL_PRODUCTS, BANDWIDTH, BLOCK_STORAGE, COMPUTE, DDOS, MANAGED_DB, OBJECT_STORAGE, SUPPORT, VPS, WORKSPACE, PREMIUM_SUPPORT, CDN, API_GATEWAY } from '../data/products'
import { API_GATEWAY_CHARGES, OBJECT_STORAGE_CHARGES } from '../data/pricing'
import type { SeedScope } from './_types'

type ChargeInput = {
  code: string
  name: string
  chargeType: 'mrc' | 'nrc' | 'usage'
  pricingMethod: 'flat' | 'fixed' | 'per_unit' | 'tiered'
  pricingTableId?: string | null
  priceColumnKey?: string | null
  fixedPrice?: string | null
  quantityAttributeCode?: string | null
  applicabilityCondition?: Record<string, unknown> | null
  includedQuantity?: string | null
  sortOrder: number
}

async function findProductId(em: EntityManager, scope: SeedScope, sku: string): Promise<string | null> {
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
  const p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
  return p?.id ?? null
}

async function findOfferingId(em: EntityManager, scope: SeedScope, code: string): Promise<string | null> {
  const { CpqProductOffering } = await import('../../../cpq/data/entities')
  const o = await em.findOne(CpqProductOffering, { ...scope, code, deletedAt: null })
  return o?.id ?? null
}

async function findTableId(em: EntityManager, scope: SeedScope, code: string): Promise<string | null> {
  const { CpqPricingTable } = await import('../../../cpq/data/entities')
  const t = await em.findOne(CpqPricingTable, { ...scope, code })
  return t?.id ?? null
}

async function ensureCharge(
  em: EntityManager,
  scope: SeedScope,
  pid: string,
  oid: string | null,
  data: ChargeInput,
): Promise<void> {
  const { CpqProductCharge } = await import('../../../cpq/data/entities')
  const exists = await em.findOne(CpqProductCharge, {
    ...scope,
    productId: pid,
    code: data.code,
    ...(oid ? { offeringId: oid } : {}),
  })
  if (!exists) {
    em.persist(em.create(CpqProductCharge, { ...scope, productId: pid, offeringId: oid, currencyCode: 'USD', ...data }))
  }
}

/**
 * Seed CpqProductCharge rows for every Puffin product. Charges attach to
 * specific offerings where the price differs per-offering (e.g. each VPS
 * plan has its own MRC); they attach at the product level only when the
 * pricing is offering-agnostic.
 */
export async function seedPuffinCharges(em: EntityManager, scope: SeedScope): Promise<void> {
  // --- VPS — each offering gets its own MRC + NRC fixed charges -----------
  const vpsId = await findProductId(em, scope, VPS.sku)
  if (vpsId) {
    for (const offer of VPS.offerings) {
      const oid = await findOfferingId(em, scope, offer.code)
      if (!oid) continue
      const dtv = offer.designTimeValues as Record<string, number> | undefined
      if (!dtv) continue
      await ensureCharge(em, scope, vpsId, oid, {
        code: `${offer.code}_setup_fee`,
        name: `${offer.name} — Setup Fee`,
        chargeType: 'nrc',
        pricingMethod: 'fixed',
        fixedPrice: String(dtv.nrc ?? 0),
        sortOrder: 0,
      })
      await ensureCharge(em, scope, vpsId, oid, {
        code: `${offer.code}_mrc`,
        name: `${offer.name} — Monthly`,
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: String(dtv.mrc),
        sortOrder: 1,
      })
    }
  }

  // --- Compute — usage-based, driven by pricing table ---------------------
  const computeId = await findProductId(em, scope, COMPUTE.sku)
  if (computeId) {
    const oid = await findOfferingId(em, scope, COMPUTE.offerings[0].code)
    const tableId = await findTableId(em, scope, 'puffin_compute_pricing')
    if (oid && tableId) {
      // On-demand usage charge.
      await ensureCharge(em, scope, computeId, oid, {
        code: 'compute_on_demand',
        name: 'Compute (on-demand, per hour)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        pricingTableId: tableId,
        priceColumnKey: 'price_per_hour',
        quantityAttributeCode: 'monthly_active_hours',
        applicabilityCondition: { attribute: 'reserved_term', operator: 'in', value: ['on_demand', null] },
        sortOrder: 0,
      })
      // Reserved 1y — converts to MRC at price_per_hour × 730 × (1 − 0.22).
      // Modelled as an MRC charge with the same pricing table; reserved discount
      // is applied by a price rule scoped to that condition. Per the spec,
      // reserved-term commitment fee is a separate NRC equal to one month MRC.
      await ensureCharge(em, scope, computeId, oid, {
        code: 'compute_reserved_1y_mrc',
        name: 'Compute (reserved 1y, MRC)',
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: tableId,
        priceColumnKey: 'price_per_hour',
        quantityAttributeCode: 'monthly_active_hours',
        applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '1y' },
        sortOrder: 1,
      })
      await ensureCharge(em, scope, computeId, oid, {
        code: 'compute_reserved_3y_mrc',
        name: 'Compute (reserved 3y, MRC)',
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: tableId,
        priceColumnKey: 'price_per_hour',
        quantityAttributeCode: 'monthly_active_hours',
        applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '3y' },
        sortOrder: 2,
      })
    }
  }

  // --- Block Storage — per offering, per-GB-month -------------------------
  const blockId = await findProductId(em, scope, BLOCK_STORAGE.sku)
  if (blockId) {
    // Per-GB pricing lives in `puffin_block_storage_pricing` (offering_code-
    // dimensioned). The public price route injects `offering_code` into each
    // item's configuration so calculatePerUnit can match the right row and
    // multiply by `volume_size_gb`.
    const blockTableId = await findTableId(em, scope, 'puffin_block_storage_pricing')
    for (const offer of BLOCK_STORAGE.offerings) {
      const oid = await findOfferingId(em, scope, offer.code)
      if (!oid || !blockTableId) continue
      await ensureCharge(em, scope, blockId, oid, {
        code: `${offer.code}_storage`,
        name: `${offer.name} — Storage (per GB-month)`,
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: blockTableId,
        priceColumnKey: 'per_gb',
        quantityAttributeCode: 'volume_size_gb',
        sortOrder: 0,
      })
    }
  }

  // --- Object Storage — composite usage charges ---------------------------
  const objectId = await findProductId(em, scope, OBJECT_STORAGE.sku)
  if (objectId) {
    const oid = await findOfferingId(em, scope, OBJECT_STORAGE.offerings[0].code)
    if (oid) {
      await ensureCharge(em, scope, objectId, oid, {
        code: 'object_storage_stored',
        name: 'Stored Data (per GB-month)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(OBJECT_STORAGE_CHARGES.stored_per_gb_month),
        quantityAttributeCode: 'monthly_storage_gb',
        sortOrder: 0,
      })
      await ensureCharge(em, scope, objectId, oid, {
        code: 'object_storage_egress',
        name: 'Egress (per GB)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(OBJECT_STORAGE_CHARGES.egress_per_gb),
        quantityAttributeCode: 'monthly_egress_gb',
        sortOrder: 1,
      })
      await ensureCharge(em, scope, objectId, oid, {
        code: 'object_storage_class_a',
        name: 'Class-A Requests (per 1,000)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(OBJECT_STORAGE_CHARGES.class_a_per_1k),
        quantityAttributeCode: 'monthly_class_a_requests_thousands',
        sortOrder: 2,
      })
      await ensureCharge(em, scope, objectId, oid, {
        code: 'object_storage_class_b',
        name: 'Class-B Requests (per 10,000)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(OBJECT_STORAGE_CHARGES.class_b_per_10k),
        quantityAttributeCode: 'monthly_class_b_requests_ten_thousands',
        sortOrder: 3,
      })
      await ensureCharge(em, scope, objectId, oid, {
        code: 'object_storage_platform',
        name: 'Platform Fee',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: String(OBJECT_STORAGE_CHARGES.platform_mrc),
        sortOrder: 4,
      })
    }
  }

  // --- CDN ----------------------------------------------------------------
  const cdnId = await findProductId(em, scope, CDN.sku)
  if (cdnId) {
    const oid = await findOfferingId(em, scope, 'OFFER-PUFFIN-CDN')
    const cdnTableId = await findTableId(em, scope, 'puffin_cdn_egress_pricing')
    if (oid && cdnTableId) {
      await ensureCharge(em, scope, cdnId, oid, {
        code: 'cdn_egress',
        name: 'CDN Egress (tiered)',
        chargeType: 'usage',
        pricingMethod: 'tiered',
        pricingTableId: cdnTableId,
        priceColumnKey: 'per_gb',
        quantityAttributeCode: 'monthly_egress_gb',
        sortOrder: 0,
      })
      await ensureCharge(em, scope, cdnId, oid, {
        code: 'cdn_platform_fee',
        name: 'CDN Platform Fee',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '25',
        sortOrder: 1,
      })
    }
    const wafOid = await findOfferingId(em, scope, 'OFFER-PUFFIN-CDN-WAF')
    if (wafOid) {
      await ensureCharge(em, scope, cdnId, wafOid, {
        code: 'cdn_waf_fee',
        name: 'CDN WAF Add-on',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '50',
        sortOrder: 0,
      })
    }
  }

  // --- API Gateway --------------------------------------------------------
  const apiId = await findProductId(em, scope, API_GATEWAY.sku)
  if (apiId) {
    const oid = await findOfferingId(em, scope, API_GATEWAY.offerings[0].code)
    if (oid) {
      await ensureCharge(em, scope, apiId, oid, {
        code: 'api_gateway_requests',
        name: 'Requests (per 1M)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(API_GATEWAY_CHARGES.per_million_requests),
        quantityAttributeCode: 'monthly_requests_million',
        sortOrder: 0,
      })
      await ensureCharge(em, scope, apiId, oid, {
        code: 'api_gateway_compute',
        name: 'Compute (per GB-second)',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: String(API_GATEWAY_CHARGES.per_gb_second),
        quantityAttributeCode: 'monthly_compute_gb_seconds_thousands',
        sortOrder: 1,
      })
    }
  }

  // --- DDoS Shield --------------------------------------------------------
  const ddosId = await findProductId(em, scope, DDOS.sku)
  if (ddosId) {
    for (const offer of DDOS.offerings) {
      const oid = await findOfferingId(em, scope, offer.code)
      if (!oid) continue
      const dtv = offer.designTimeValues as Record<string, number> | undefined
      if (!dtv) continue
      await ensureCharge(em, scope, ddosId, oid, {
        code: `${offer.code}_setup`,
        name: `${offer.name} — Setup`,
        chargeType: 'nrc',
        pricingMethod: 'fixed',
        fixedPrice: String(dtv.nrc ?? 0),
        sortOrder: 0,
      })
      await ensureCharge(em, scope, ddosId, oid, {
        code: `${offer.code}_mrc`,
        name: `${offer.name} — Monthly`,
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: String(dtv.mrc),
        sortOrder: 1,
      })
    }
  }

  // --- Managed Database — base from pricing table + composable surcharges -
  const dbId = await findProductId(em, scope, MANAGED_DB.sku)
  if (dbId) {
    const oid = await findOfferingId(em, scope, MANAGED_DB.offerings[0].code)
    const dbTableId = await findTableId(em, scope, 'puffin_managed_db_pricing')
    if (oid && dbTableId) {
      await ensureCharge(em, scope, dbId, oid, {
        code: 'db_base_mrc',
        name: 'Database Base MRC',
        chargeType: 'mrc',
        pricingMethod: 'flat',
        pricingTableId: dbTableId,
        priceColumnKey: 'mrc',
        sortOrder: 0,
      })
      await ensureCharge(em, scope, dbId, oid, {
        code: 'db_vpc_peering',
        name: 'VPC Peering',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '20',
        applicabilityCondition: { attribute: 'vpc_peering', operator: 'eq', value: true },
        sortOrder: 1,
      })
      // Read replicas / PITR / backup-retention surcharges are derived from
      // the base MRC at price-rule time (XD-275 §Surcharges). We model them
      // here as `usage` charges with `applicabilityCondition` so the rules
      // engine has stable rows to target.
      await ensureCharge(em, scope, dbId, oid, {
        code: 'db_read_replicas',
        name: 'Read Replicas (60% of HA-0 base, per replica)',
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        // Rate is applied by a price rule that references HA-0 base.
        fixedPrice: '0',
        quantityAttributeCode: 'read_replicas',
        applicabilityCondition: { attribute: 'read_replicas', operator: 'gt', value: 0 },
        sortOrder: 2,
      })
      await ensureCharge(em, scope, dbId, oid, {
        code: 'db_pitr_addon',
        name: 'PITR Add-on (15% of HA-0 base)',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '0',
        applicabilityCondition: { attribute: 'pitr_enabled', operator: 'eq', value: true },
        sortOrder: 3,
      })
      await ensureCharge(em, scope, dbId, oid, {
        code: 'db_backup_retention_surcharge',
        name: 'Backup Retention Surcharge',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '0',
        applicabilityCondition: { attribute: 'backup_retention_days', operator: 'in', value: ['14', '30'] },
        sortOrder: 4,
      })
    }
  }

  // --- Workspace — per-seat usage charge per offering ---------------------
  const workspaceId = await findProductId(em, scope, WORKSPACE.sku)
  if (workspaceId) {
    // Per-seat pricing lives in `puffin_workspace_seat_pricing` (offering_code-
    // dimensioned, one row per plan / add-on). The public price route injects
    // `offering_code` into each item's configuration so calculatePerUnit
    // matches the right row and multiplies by `seat_count`.
    const workspaceSeatTableId = await findTableId(em, scope, 'puffin_workspace_seat_pricing')
    for (const offer of WORKSPACE.offerings) {
      const oid = await findOfferingId(em, scope, offer.code)
      if (!oid) continue
      const dtv = offer.designTimeValues as Record<string, number> | undefined
      if (!dtv) continue
      // The compliance pack is a flat MRC, not per-seat.
      if (offer.code === 'ws_compliance') {
        await ensureCharge(em, scope, workspaceId, oid, {
          code: `${offer.code}_mrc`,
          name: `${offer.name} — Monthly`,
          chargeType: 'mrc',
          pricingMethod: 'fixed',
          fixedPrice: String(dtv.mrc),
          sortOrder: 0,
        })
        continue
      }
      // Extra storage is per-GB-month — usage charge, totalPrice is null in
      // the response so the fixed-price early-return is harmless here.
      if (offer.code === 'ws_extra_storage') {
        await ensureCharge(em, scope, workspaceId, oid, {
          code: `${offer.code}_per_gb`,
          name: `${offer.name} — Storage`,
          chargeType: 'usage',
          pricingMethod: 'per_unit',
          fixedPrice: String(dtv.price_per_gb),
          quantityAttributeCode: 'monthly_storage_gb',
          sortOrder: 0,
        })
        continue
      }
      // All other Workspace plans + add-ons are per-seat per month.
      const seatPrice = dtv.seat_price
      if (seatPrice == null || !workspaceSeatTableId) continue
      await ensureCharge(em, scope, workspaceId, oid, {
        code: `${offer.code}_per_seat`,
        name: `${offer.name} — Per Seat`,
        chargeType: 'mrc',
        pricingMethod: 'per_unit',
        pricingTableId: workspaceSeatTableId,
        priceColumnKey: 'per_seat',
        quantityAttributeCode: 'seat_count',
        sortOrder: 0,
      })
    }
  }

  // --- Bandwidth ----------------------------------------------------------
  const bwId = await findProductId(em, scope, BANDWIDTH.sku)
  if (bwId) {
    const oid = await findOfferingId(em, scope, BANDWIDTH.offerings[0].code)
    const bwTableId = await findTableId(em, scope, 'puffin_bandwidth_pricing')
    if (oid && bwTableId) {
      await ensureCharge(em, scope, bwId, oid, {
        code: 'bandwidth_egress',
        name: 'Standalone Egress (tiered)',
        chargeType: 'usage',
        pricingMethod: 'tiered',
        pricingTableId: bwTableId,
        priceColumnKey: 'per_gb',
        quantityAttributeCode: 'monthly_egress_gb',
        sortOrder: 0,
      })
    }
  }

  // --- Support tiers ------------------------------------------------------
  const supportId = await findProductId(em, scope, SUPPORT.sku)
  if (supportId) {
    for (const offer of SUPPORT.offerings) {
      const oid = await findOfferingId(em, scope, offer.code)
      if (!oid) continue
      const dtv = offer.designTimeValues as Record<string, number | null> | undefined
      const mrc = dtv && typeof dtv.mrc === 'number' ? dtv.mrc : 0
      await ensureCharge(em, scope, supportId, oid, {
        code: `${offer.code}_mrc`,
        name: `${offer.name} — Monthly`,
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: String(mrc),
        sortOrder: 0,
      })
    }
  }

  // --- Premium Support — composite charges --------------------------------
  const premiumId = await findProductId(em, scope, PREMIUM_SUPPORT.sku)
  if (premiumId) {
    const oid = await findOfferingId(em, scope, 'premium_support')
    if (oid) {
      await ensureCharge(em, scope, premiumId, oid, {
        code: 'premium_support_base',
        name: 'Premium Support Base',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '500',
        sortOrder: 0,
      })
      await ensureCharge(em, scope, premiumId, oid, {
        code: 'premium_support_tam_overage',
        name: 'Premium Support — TAM Hour Overage',
        chargeType: 'usage',
        pricingMethod: 'per_unit',
        fixedPrice: '250',
        quantityAttributeCode: 'tam_hours_used',
        includedQuantity: '10',
        sortOrder: 1,
      })
      await ensureCharge(em, scope, premiumId, oid, {
        code: 'premium_support_dedicated_line',
        name: 'Dedicated Phone + 15-min SLA',
        chargeType: 'mrc',
        pricingMethod: 'fixed',
        fixedPrice: '250',
        applicabilityCondition: { attribute: 'dedicated_line', operator: 'eq', value: true },
        sortOrder: 2,
      })
    }
  }
  await em.flush()
  void ALL_PRODUCTS // keeps tree-shaker honest, ensures imports stay live during edits
}
