/**
 * Golden (characterization) test — spec invariant I-8.
 *
 * Freezes `charges` / `pricingSummary` / `snapshotHash` produced by the
 * list -> price rules -> manual adjustments -> offer waterfall for
 * representative demo_gix / demo_puffin offerings, BEFORE the cost-plus
 * refactor of the table lookup (steps 6+). It must stay green and its fixture
 * byte-identical across that refactor.
 *
 * Layering: CPQ ships as a standalone package and must never import from
 * `src/modules/*`. The seed definitions below are therefore a COPIED, reduced
 * representation of the demo seeds (same dimension keys, price columns, tiers,
 * charge shapes, rules; fewer table rows). Synthetic offerings (clearly named
 * `synthetic_*`) cover models/currency columns the demo seeds do not use
 * (volume, multi-currency entries). No database: an in-memory EM implements
 * just the `find` / `findOne` filtering the pricing service relies on.
 *
 * Regenerate the fixture DELIBERATELY (only when pricing behaviour is meant to
 * change, with review of the diff):
 *   UPDATE_COST_PLUS_GOLDEN=1 yarn test packages/cpq/src/modules/cpq/services/__tests__/costPlusGolden.test.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DefaultCpqPricingService } from '../cpqPricingService'
import { CpqProductCharge, CpqPricingTable, CpqPricingTableEntry, CpqPriceRule } from '../../data/entities'
import { resolveManualAdjustments } from '../priceAdjustments/resolveManualAdjustments'
import { computeWaterfallSummary } from '../priceAdjustments/pricingSnapshot'
import type { PriceAdjustment } from '../../data/price-adjustments'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const FIXTURE = path.join(__dirname, '__fixtures__', 'costPlusGolden.json')

// ── Tables (reduced copies of the demo seeds) ───────────────────────────────

type Row = Record<string, unknown>
const tiers = (rows: Array<[number, number, number | null, Record<string, number>]>, currencyCode = 'USD'): Row[] =>
  rows.map(([tier, from, to, prices]) => ({
    dimensionValues: {}, tierNumber: tier, rangeFrom: String(from), rangeTo: to != null ? String(to) : null, prices, currencyCode,
  }))
const dimRow = (dimensionValues: Record<string, string>, prices: Record<string, number>, currencyCode = 'USD'): Row =>
  ({ dimensionValues, tierNumber: null, rangeFrom: null, rangeTo: null, prices, currencyCode })

const TABLES: Record<string, { dimensions: Array<{ key: string }>; entries: Row[] }> = {
  gix_access_port: {
    dimensions: [{ key: 'data_centre' }, { key: 'port_size' }],
    entries: [
      dimRow({ data_centre: 'equinix-ld5', port_size: '1G' }, { nrc: 290, mrc: 250 }),
      dimRow({ data_centre: 'equinix-ld5', port_size: '10G' }, { nrc: 490, mrc: 450 }),
      dimRow({ data_centre: 'equinix-ld5', port_size: '100G' }, { nrc: 890, mrc: 1200 }),
      dimRow({ data_centre: 'equinix-fr5', port_size: '10G' }, { nrc: 490, mrc: 410 }),
      dimRow({ data_centre: 'equinix-fr5', port_size: '100G' }, { nrc: 890, mrc: 1100 }),
    ],
  },
  gix_internet_peering: {
    dimensions: [],
    entries: tiers([
      [0, 0, 50, { per_mb: 0.52 }], [1, 51, 100, { per_mb: 0.49 }], [2, 101, 250, { per_mb: 0.47 }],
      [3, 251, 500, { per_mb: 0.45 }], [4, 501, 1000, { per_mb: 0.43 }], [5, 1001, null, { per_mb: 0.4 }],
    ]),
  },
  gix_mobile_peering: {
    dimensions: [],
    entries: tiers([
      [0, 0, 50, { per_mb: 1.23 }], [1, 51, 100, { per_mb: 1.11 }], [2, 101, 250, { per_mb: 1.0 }],
      [3, 251, 500, { per_mb: 0.85 }], [4, 501, 1000, { per_mb: 0.74 }], [5, 1001, null, { per_mb: 0.63 }],
    ]),
  },
  gix_cloud_connect: {
    dimensions: [{ key: 'data_centre_location' }, { key: 'cloud_provider' }, { key: 'cloud_region' }],
    entries: [
      dimRow({ data_centre_location: 'London', cloud_provider: 'AWS', cloud_region: 'eu-west-2' }, { flat_per_mb: 0.52, commit_per_mb: 0.46, overage_per_mb: 0.69 }),
      dimRow({ data_centre_location: 'London', cloud_provider: 'GCP', cloud_region: 'europe-west2' }, { flat_per_mb: 0.54, commit_per_mb: 0.48, overage_per_mb: 0.71 }),
      dimRow({ data_centre_location: 'Frankfurt', cloud_provider: 'MS Azure', cloud_region: 'West Europe' }, { flat_per_mb: 0.51, commit_per_mb: 0.45, overage_per_mb: 0.67 }),
    ],
  },
  puffin_compute: {
    dimensions: [{ key: 'instance_family' }, { key: 'instance_size' }],
    entries: [
      dimRow({ instance_family: 'general', instance_size: 'md' }, { price_per_hour: 0.0333 }),
      dimRow({ instance_family: 'general', instance_size: 'xl' }, { price_per_hour: 0.1333 }),
      dimRow({ instance_family: 'gpu', instance_size: 'gpu-a10' }, { price_per_hour: 1.45 }),
    ],
  },
  puffin_cdn_egress: {
    dimensions: [],
    entries: tiers([
      [0, 0, 10000, { per_gb: 0.085 }], [1, 10001, 50000, { per_gb: 0.07 }], [2, 50001, 150000, { per_gb: 0.055 }],
      [3, 150001, 500000, { per_gb: 0.04 }], [4, 500001, null, { per_gb: 0.03 }],
    ]),
  },
  puffin_workspace_seat: {
    dimensions: [{ key: 'offering_code' }],
    entries: [dimRow({ offering_code: 'OFFER-PUFFIN-WORKSPACE-TEAM' }, { per_seat: 12 })],
  },
  puffin_managed_db: {
    dimensions: [{ key: 'db_engine' }, { key: 'plan_size' }, { key: 'ha_replicas' }],
    entries: [
      dimRow({ db_engine: 'postgres', plan_size: 'md', ha_replicas: '0' }, { mrc: 60 }),
      dimRow({ db_engine: 'postgres', plan_size: 'md', ha_replicas: '1' }, { mrc: 120 }),
      dimRow({ db_engine: 'redis', plan_size: 'sm', ha_replicas: '0' }, { mrc: 22 }),
    ],
  },
  // synthetic: the demo seeds use no volume model and no multi-currency entries
  synthetic_volume: {
    dimensions: [{ key: 'region' }],
    entries: [
      { ...tiers([[0, 0, 100, { unit: 1 }]])[0], dimensionValues: { region: 'eu' } },
      { ...tiers([[1, 101, 1000, { unit: 0.8 }]])[0], dimensionValues: { region: 'eu' } },
      { ...tiers([[2, 1001, null, { unit: 0.6 }]])[0], dimensionValues: { region: 'eu' } },
      { ...tiers([[0, 0, null, { unit: 2 }]])[0], dimensionValues: { region: 'us' } },
    ],
  },
  synthetic_multi_currency: {
    dimensions: [{ key: 'tier_name' }],
    entries: [
      dimRow({ tier_name: 'gold' }, { nrc: 100, mrc: 40 }, 'USD'),
      dimRow({ tier_name: 'gold' }, { nrc: 90, mrc: 36 }, 'EUR'),
      dimRow({ tier_name: 'gold' }, { nrc: 80, mrc: 31 }, 'GBP'),
    ],
  },
  synthetic_tiered_multi_dim: {
    dimensions: [{ key: 'region' }],
    entries: [
      { ...tiers([[0, 0, 10, { per_unit: 5 }]])[0], dimensionValues: { region: 'eu' } },
      { ...tiers([[1, 11, null, { per_unit: 3 }]])[0], dimensionValues: { region: 'eu' } },
      { ...tiers([[0, 0, 10, { per_unit: 9 }]])[0], dimensionValues: { region: 'us' } },
    ],
  },
}

// ── Offerings: charges + price rules ────────────────────────────────────────

interface ChargeDef {
  code: string; name: string; chargeType: 'nrc' | 'mrc' | 'usage'; chargeModel: string; pricingMethod: string
  table?: string; priceColumnKey?: string; fixedPrice?: string; quantityAttributeCode?: string
  applicabilityCondition?: Record<string, unknown>
}
interface RuleDef {
  code: string; name: string; ruleType: string; value: string; chargeTypeFilter?: string; chargeCodeFilter?: string
  applicabilityCondition?: Record<string, unknown> | null; productOfferingId?: string | null; sortOrder: number
}

const tableCharge = (c: Omit<ChargeDef, 'pricingMethod'>): ChargeDef => ({ ...c, pricingMethod: 'table' })
const fixedCharge = (c: Omit<ChargeDef, 'pricingMethod' | 'chargeModel'> & { chargeModel?: string }): ChargeDef =>
  ({ chargeModel: 'flat', ...c, pricingMethod: 'fixed' })

const OFFERINGS: Record<string, ChargeDef[]> = {
  'OFFER-GIX-ACCESS-PORT': [
    tableCharge({ code: 'setup_fee', name: 'Setup Fee', chargeType: 'nrc', chargeModel: 'flat', table: 'gix_access_port', priceColumnKey: 'nrc' }),
    tableCharge({ code: 'monthly_port_fee', name: 'Monthly Port Fee', chargeType: 'mrc', chargeModel: 'flat', table: 'gix_access_port', priceColumnKey: 'mrc' }),
  ],
  'OFFER-GIX-INTERNET-PEERING': [
    tableCharge({ code: 'bandwidth_fee', name: 'Bandwidth Fee', chargeType: 'mrc', chargeModel: 'tiered', table: 'gix_internet_peering', priceColumnKey: 'per_mb', quantityAttributeCode: 'bandwidth_mb' }),
  ],
  'OFFER-GIX-MOBILE-PEERING': [
    tableCharge({ code: 'bandwidth_fee', name: 'Bandwidth Fee', chargeType: 'mrc', chargeModel: 'tiered', table: 'gix_mobile_peering', priceColumnKey: 'per_mb', quantityAttributeCode: 'bandwidth_mb' }),
  ],
  'OFFER-GIX-CLOUD-CONNECT': [
    tableCharge({ code: 'flat_bandwidth_fee', name: 'Flat Bandwidth Fee', chargeType: 'mrc', chargeModel: 'per_unit', table: 'gix_cloud_connect', priceColumnKey: 'flat_per_mb', quantityAttributeCode: 'bandwidth_mb', applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'flat' } }),
    tableCharge({ code: 'commit_bandwidth_fee', name: 'Committed Bandwidth Fee', chargeType: 'mrc', chargeModel: 'per_unit', table: 'gix_cloud_connect', priceColumnKey: 'commit_per_mb', quantityAttributeCode: 'bandwidth_mb', applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' } }),
    tableCharge({ code: 'overage_fee', name: 'Overage Fee', chargeType: 'usage', chargeModel: 'per_unit', table: 'gix_cloud_connect', priceColumnKey: 'overage_per_mb', quantityAttributeCode: 'bandwidth_mb', applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' } }),
  ],
  'OFFER-PUFFIN-COMPUTE': [
    // 'in' is not a supported operator today: evaluateApplicability treats it as always-true. Pinned as-is.
    tableCharge({ code: 'compute_on_demand', name: 'Compute (on-demand, per hour)', chargeType: 'usage', chargeModel: 'per_unit', table: 'puffin_compute', priceColumnKey: 'price_per_hour', quantityAttributeCode: 'monthly_active_hours', applicabilityCondition: { attribute: 'reserved_term', operator: 'in', value: ['on_demand', null] } }),
    tableCharge({ code: 'compute_reserved_1y_mrc', name: 'Compute (reserved 1y, MRC)', chargeType: 'mrc', chargeModel: 'per_unit', table: 'puffin_compute', priceColumnKey: 'price_per_hour', quantityAttributeCode: 'monthly_active_hours', applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '1y' } }),
  ],
  'OFFER-PUFFIN-CDN': [
    tableCharge({ code: 'cdn_egress', name: 'CDN Egress (tiered)', chargeType: 'usage', chargeModel: 'tiered', table: 'puffin_cdn_egress', priceColumnKey: 'per_gb', quantityAttributeCode: 'monthly_egress_gb' }),
    fixedCharge({ code: 'cdn_platform_fee', name: 'CDN Platform Fee', chargeType: 'mrc', fixedPrice: '25' }),
    fixedCharge({ code: 'cdn_waf_fee', name: 'CDN WAF Fee', chargeType: 'mrc', fixedPrice: '50' }),
  ],
  'OFFER-PUFFIN-WORKSPACE-TEAM': [
    tableCharge({ code: 'OFFER-PUFFIN-WORKSPACE-TEAM_mrc', name: 'Workspace Team — per seat', chargeType: 'mrc', chargeModel: 'per_unit', table: 'puffin_workspace_seat', priceColumnKey: 'per_seat', quantityAttributeCode: 'seat_count' }),
    fixedCharge({ code: 'OFFER-PUFFIN-WORKSPACE-TEAM_setup', name: 'Workspace Setup', chargeType: 'nrc', fixedPrice: '99' }),
  ],
  'OFFER-PUFFIN-OBJECT-STORAGE': [
    fixedCharge({ code: 'object_storage_stored', name: 'Stored', chargeType: 'usage', chargeModel: 'per_unit', fixedPrice: '0.02', quantityAttributeCode: 'monthly_storage_gb' }),
    fixedCharge({ code: 'object_storage_platform', name: 'Platform', chargeType: 'mrc', fixedPrice: '0' }),
  ],
  'OFFER-PUFFIN-MANAGED-DB': [
    tableCharge({ code: 'db_base_mrc', name: 'Database Base MRC', chargeType: 'mrc', chargeModel: 'flat', table: 'puffin_managed_db', priceColumnKey: 'mrc' }),
    fixedCharge({ code: 'db_vpc_peering', name: 'VPC Peering', chargeType: 'mrc', fixedPrice: '20', applicabilityCondition: { attribute: 'vpc_peering', operator: 'eq', value: true } }),
    fixedCharge({ code: 'db_read_replicas', name: 'Read Replicas', chargeType: 'mrc', chargeModel: 'per_unit', fixedPrice: '0', quantityAttributeCode: 'read_replicas' }),
  ],
  'SYNTHETIC-VOLUME': [
    tableCharge({ code: 'volume_fee', name: 'Volume Fee', chargeType: 'mrc', chargeModel: 'volume', table: 'synthetic_volume', priceColumnKey: 'unit', quantityAttributeCode: 'units' }),
    tableCharge({ code: 'volume_usage', name: 'Volume Usage', chargeType: 'usage', chargeModel: 'volume', table: 'synthetic_volume', priceColumnKey: 'unit', quantityAttributeCode: 'units' }),
    tableCharge({ code: 'tiered_fee', name: 'Tiered Fee', chargeType: 'mrc', chargeModel: 'tiered', table: 'synthetic_tiered_multi_dim', priceColumnKey: 'per_unit', quantityAttributeCode: 'units' }),
  ],
  'SYNTHETIC-MULTI-CURRENCY': [
    tableCharge({ code: 'mc_setup', name: 'MC Setup', chargeType: 'nrc', chargeModel: 'flat', table: 'synthetic_multi_currency', priceColumnKey: 'nrc' }),
    tableCharge({ code: 'mc_monthly', name: 'MC Monthly', chargeType: 'mrc', chargeModel: 'flat', table: 'synthetic_multi_currency', priceColumnKey: 'mrc' }),
    tableCharge({ code: 'mc_missing_column', name: 'MC Missing Column', chargeType: 'mrc', chargeModel: 'flat', table: 'synthetic_multi_currency', priceColumnKey: 'nope' }),
    fixedCharge({ code: 'mc_fixed', name: 'MC Fixed', chargeType: 'mrc', fixedPrice: '10' }),
  ],
  'SYNTHETIC-NO-TABLE': [
    // table-sourced model without a table configured degrades to the fixed price
    { code: 'orphan_flat', name: 'Orphan Flat', chargeType: 'mrc', chargeModel: 'flat', pricingMethod: 'table', fixedPrice: '15' },
    { code: 'orphan_tiered', name: 'Orphan Tiered', chargeType: 'mrc', chargeModel: 'tiered', pricingMethod: 'table', fixedPrice: '7' },
    // legacy combined pricingMethod rows (no chargeModel)
    { code: 'legacy_per_unit', name: 'Legacy Per Unit', chargeType: 'mrc', chargeModel: '', pricingMethod: 'per_unit', fixedPrice: '3', quantityAttributeCode: 'units' },
  ],
}

const RULES: RuleDef[] = [
  { code: 'volume-mrc-10pct', name: 'Volume Discount — 10% MRC', ruleType: 'discount_percent', value: '10', chargeTypeFilter: 'mrc', sortOrder: 20 },
  { code: 'premium-100g-surcharge', name: '100G Port Premium Surcharge', ruleType: 'surcharge_absolute', value: '50', chargeCodeFilter: 'monthly_port_fee', applicabilityCondition: { attribute: 'port_size', operator: 'eq', value: '100G' }, sortOrder: 30 },
  { code: 'cloud-connect-5pct-off', name: 'Cloud Connect Promo — 5% Off', ruleType: 'discount_percent', value: '5', applicabilityCondition: { attribute: 'cloud_provider', operator: 'neq', value: '' }, sortOrder: 40 },
  { code: 'setup-fee-cap-200', name: 'Setup Fee Cap at $200', ruleType: 'price_override', value: '200', chargeCodeFilter: 'setup_fee', applicabilityCondition: { attribute: 'cap_setup', operator: 'eq', value: 'yes' }, sortOrder: 5 },
  { code: 'access-port-nrc-15pct-off', name: 'Access Port — 15% Setup Discount', ruleType: 'discount_percent', value: '15', chargeCodeFilter: 'setup_fee', productOfferingId: 'OFFER-GIX-ACCESS-PORT', sortOrder: 50 },
  { code: 'puffin-reserved-1y-compute', name: 'Reserved 1y', ruleType: 'discount_percent', value: '22', chargeTypeFilter: 'mrc', applicabilityCondition: { attribute: 'reserved_term', operator: 'eq', value: '1y' }, productOfferingId: 'OFFER-PUFFIN-COMPUTE', sortOrder: 20 },
  { code: 'puffin-ws-volume-tier1', name: 'Workspace seats tier 1', ruleType: 'discount_percent', value: '5', applicabilityCondition: { attribute: 'seat_volume_tier', operator: 'eq', value: 'tier1' }, productOfferingId: 'OFFER-PUFFIN-WORKSPACE-TEAM', sortOrder: 10 },
  { code: 'puffin-api-free-tier', name: 'Free tier', ruleType: 'discount_absolute', value: '0.20', chargeCodeFilter: 'object_storage_stored', productOfferingId: 'OFFER-PUFFIN-OBJECT-STORAGE', sortOrder: 10 },
  { code: 'puffin-db-read-replica-rate', name: 'Replica rate', ruleType: 'price_override', value: '36', chargeCodeFilter: 'db_read_replicas', productOfferingId: 'OFFER-PUFFIN-MANAGED-DB', sortOrder: 10 },
  { code: 'puffin-db-backup-retention-14', name: 'Retention 14d', ruleType: 'surcharge_percent', value: '5', chargeCodeFilter: 'db_base_mrc', applicabilityCondition: { attribute: 'backup_retention_days', operator: 'eq', value: '14' }, productOfferingId: 'OFFER-PUFFIN-MANAGED-DB', sortOrder: 20 },
  { code: 'synthetic-surcharge-pct', name: 'Synthetic surcharge', ruleType: 'surcharge_percent', value: '10', chargeCodeFilter: 'volume_fee', productOfferingId: 'SYNTHETIC-VOLUME', sortOrder: 10 },
]

// ── In-memory EM ────────────────────────────────────────────────────────────

function buildEm() {
  const tableIds = new Map<string, string>()
  const tables: Row[] = Object.entries(TABLES).map(([code, def]) => {
    const id = `tbl-${code}`
    tableIds.set(code, id)
    return { id, code, dimensions: def.dimensions }
  })
  const entries: Row[] = Object.entries(TABLES).flatMap(([code, def]) =>
    def.entries.map((entry, i) => ({ id: `ent-${code}-${i}`, pricingTableId: tableIds.get(code), isActive: true, deletedAt: null, ...entry })))
  const charges: Row[] = Object.entries(OFFERINGS).flatMap(([offeringId, defs]) =>
    defs.map((def, i) => ({
      offeringId, isActive: true, deletedAt: null, sortOrder: i, description: null, currencyCode: null, fixedPrice: null,
      priceColumnKey: null, quantityAttributeCode: null, applicabilityCondition: null,
      ...def, pricingTableId: def.table ? tableIds.get(def.table) : null,
    })))
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, want]) => {
      if (key === '$or') return (want as Array<Record<string, unknown>>).some((alt) => matches(row, alt))
      if (key === 'tenantId' || key === 'organizationId') return true
      return (row[key] ?? null) === want
    })
  const find = async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CpqProductCharge) return charges.filter((r) => matches(r, where)).sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
    if (entity === CpqPricingTableEntry) return entries.filter((r) => matches(r, where))
    if (entity === CpqPriceRule) {
      return RULES.map((r) => ({ productOfferingId: null, chargeTypeFilter: null, chargeCodeFilter: null, applicabilityCondition: null, isActive: true, deletedAt: null, ...r }))
        .filter((r) => matches(r, where)).sort((a, b) => a.sortOrder - b.sortOrder)
    }
    throw new Error('unexpected find')
  }
  const findOne = async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === CpqPricingTable) return tables.find((r) => matches(r, where)) ?? null
    return null // getBaseCurrencyCode hidden findOne -> default currency
  }
  return { find, findOne }
}

// ── Scenarios ───────────────────────────────────────────────────────────────

interface Scenario {
  name: string; offering: string; configuration: Record<string, unknown>; currency?: string
  quantity?: number; termMonths?: number | null; adjustments?: Array<Partial<PriceAdjustment> & { chargeCode?: string }>
}

const SCENARIOS: Scenario[] = [
  { name: 'gix access port 10G ld5 (flat table, nrc+mrc, rule on mrc)', offering: 'OFFER-GIX-ACCESS-PORT', configuration: { data_centre: 'equinix-ld5', port_size: '10G' }, termMonths: 12 },
  { name: 'gix access port 100G (surcharge_absolute + offering rule + cap override)', offering: 'OFFER-GIX-ACCESS-PORT', configuration: { data_centre: 'equinix-fr5', port_size: '100G', cap_setup: 'yes' }, quantity: 2, termMonths: 24 },
  { name: 'gix access port dimension miss', offering: 'OFFER-GIX-ACCESS-PORT', configuration: { data_centre: 'nowhere', port_size: '1G' } },
  { name: 'gix access port case-insensitive match', offering: 'OFFER-GIX-ACCESS-PORT', configuration: { data_centre: 'EQUINIX-LD5', port_size: '1g' } },
  { name: 'gix internet peering 75 Mb (tiered, partial second tier)', offering: 'OFFER-GIX-INTERNET-PEERING', configuration: { bandwidth_mb: 75 } },
  { name: 'gix internet peering 2000 Mb (tiered across all tiers)', offering: 'OFFER-GIX-INTERNET-PEERING', configuration: { bandwidth_mb: 2000 }, termMonths: 36 },
  { name: 'gix internet peering zero quantity', offering: 'OFFER-GIX-INTERNET-PEERING', configuration: { bandwidth_mb: 0 } },
  { name: 'gix mobile peering 300 Mb', offering: 'OFFER-GIX-MOBILE-PEERING', configuration: { bandwidth_mb: 300 } },
  { name: 'gix cloud connect flat (per_unit, applicability eq)', offering: 'OFFER-GIX-CLOUD-CONNECT', configuration: { data_centre_location: 'London', cloud_provider: 'AWS', cloud_region: 'eu-west-2', pricing_model: 'flat', bandwidth_mb: 500 } },
  { name: 'gix cloud connect burstable (per_unit + usage overage)', offering: 'OFFER-GIX-CLOUD-CONNECT', configuration: { data_centre_location: 'Frankfurt', cloud_provider: 'MS Azure', cloud_region: 'West Europe', pricing_model: 'burstable', bandwidth_mb: 200 } },
  { name: 'gix cloud connect dimension miss', offering: 'OFFER-GIX-CLOUD-CONNECT', configuration: { data_centre_location: 'London', cloud_provider: 'AWS', cloud_region: 'mars-1', pricing_model: 'flat', bandwidth_mb: 100 } },
  { name: 'puffin compute on demand (usage per_unit, unsupported "in" operator)', offering: 'OFFER-PUFFIN-COMPUTE', configuration: { instance_family: 'general', instance_size: 'md', monthly_active_hours: 730 } },
  { name: 'puffin compute reserved 1y (per_unit mrc + rule)', offering: 'OFFER-PUFFIN-COMPUTE', configuration: { instance_family: 'gpu', instance_size: 'gpu-a10', monthly_active_hours: 730, reserved_term: '1y' }, termMonths: 12 },
  { name: 'puffin cdn egress 60000 gb (tiered usage + fixed mrc)', offering: 'OFFER-PUFFIN-CDN', configuration: { monthly_egress_gb: 60000 } },
  { name: 'puffin workspace 40 seats (per_unit, 1-dim, volume rule, fixed nrc)', offering: 'OFFER-PUFFIN-WORKSPACE-TEAM', configuration: { offering_code: 'OFFER-PUFFIN-WORKSPACE-TEAM', seat_count: 40, seat_volume_tier: 'tier1' }, termMonths: 12 },
  { name: 'puffin object storage (fixed per_unit usage, absolute rule)', offering: 'OFFER-PUFFIN-OBJECT-STORAGE', configuration: { monthly_storage_gb: 500 } },
  { name: 'puffin managed db postgres md HA1 + vpc + replicas (3-dim flat, fixed, overrides, surcharge)', offering: 'OFFER-PUFFIN-MANAGED-DB', configuration: { db_engine: 'postgres', plan_size: 'md', ha_replicas: '1', vpc_peering: true, read_replicas: 2, backup_retention_days: '14' }, quantity: 3, termMonths: 12 },
  { name: 'puffin managed db without vpc', offering: 'OFFER-PUFFIN-MANAGED-DB', configuration: { db_engine: 'redis', plan_size: 'sm', ha_replicas: '0', read_replicas: 0 } },
  { name: 'synthetic volume eu 150 units (volume mid tier, tiered multi-dim, surcharge rule)', offering: 'SYNTHETIC-VOLUME', configuration: { region: 'eu', units: 150 } },
  { name: 'synthetic volume eu 5000 units (top tier)', offering: 'SYNTHETIC-VOLUME', configuration: { region: 'eu', units: 5000 } },
  { name: 'synthetic volume us 25 units (tiered us)', offering: 'SYNTHETIC-VOLUME', configuration: { region: 'us', units: 25 } },
  { name: 'synthetic volume miss and zero', offering: 'SYNTHETIC-VOLUME', configuration: { region: 'apac', units: 0 } },
  { name: 'synthetic volume dimension miss', offering: 'SYNTHETIC-VOLUME', configuration: { region: 'apac', units: 12 } },
  { name: 'synthetic multi-currency USD (no currency override)', offering: 'SYNTHETIC-MULTI-CURRENCY', configuration: { tier_name: 'gold' } },
  { name: 'synthetic multi-currency EUR column selection', offering: 'SYNTHETIC-MULTI-CURRENCY', configuration: { tier_name: 'gold' }, currency: 'EUR' },
  { name: 'synthetic multi-currency GBP column selection', offering: 'SYNTHETIC-MULTI-CURRENCY', configuration: { tier_name: 'gold' }, currency: 'GBP' },
  { name: 'synthetic multi-currency with no entries (JPY)', offering: 'SYNTHETIC-MULTI-CURRENCY', configuration: { tier_name: 'gold' }, currency: 'JPY' },
  { name: 'synthetic orphan/legacy charges', offering: 'SYNTHETIC-NO-TABLE', configuration: { units: 4 } },
  {
    name: 'manual adjustments on access port (charge-level override, line-level percent)',
    offering: 'OFFER-GIX-ACCESS-PORT', configuration: { data_centre: 'equinix-ld5', port_size: '1G' }, quantity: 2, termMonths: 12,
    adjustments: [
      { id: 'adj-1', level: 'charge', chargeCode: 'monthly_port_fee', adjustmentType: 'price_override', value: 200, currencyCode: 'USD', reasonCode: 'competitive_match' },
    ],
  },
  {
    name: 'manual adjustments on managed db (percent discount on charge)',
    offering: 'OFFER-PUFFIN-MANAGED-DB', configuration: { db_engine: 'postgres', plan_size: 'md', ha_replicas: '0', read_replicas: 1 }, termMonths: 24,
    adjustments: [
      { id: 'adj-2', level: 'charge', chargeCode: 'db_base_mrc', adjustmentType: 'discount_percent', value: 10, reasonCode: 'loyalty' },
    ],
  },
]

async function runScenario(scenario: Scenario) {
  const em = buildEm()
  const service = new DefaultCpqPricingService(em as unknown as never)
  const charges = await service.resolveProductCharges({
    offeringId: scenario.offering, configuration: scenario.configuration, currencyCode: scenario.currency,
    tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId,
  })
  const currency = scenario.currency ?? 'USD'
  const lineId = 'line-1'
  const adjustments = (scenario.adjustments ?? []).map((row) => ({ quoteLineId: lineId, currencyCode: currency, ...row })) as PriceAdjustment[]
  const resolved = resolveManualAdjustments(
    [{ lineId, parentLineId: null, enginePriced: true, mirrored: false, charges }], adjustments, currency,
  )
  const priced = resolved.lines[0].charges
  const pricingSummary = computeWaterfallSummary(
    [{ lineId, quantity: scenario.quantity ?? 1, termMonths: scenario.termMonths ?? null, charges: priced }], adjustments, currency,
  )
  return JSON.parse(JSON.stringify({ name: scenario.name, listCharges: charges, charges: priced, adjustmentErrors: resolved.errors, pricingSummary, snapshotHash: pricingSummary.snapshotHash }))
}

describe('cost-plus golden characterization (I-8)', () => {
  it('pins charges / pricingSummary / snapshotHash for the demo-derived scenarios', async () => {
    const actual = []
    for (const scenario of SCENARIOS) actual.push(await runScenario(scenario))
    if (process.env.UPDATE_COST_PLUS_GOLDEN === '1') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
    }
    const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(actual).toEqual(expected)
  })

  it('covers every table-priced model, usage/fixed charges, rules, manual adjustments and currency columns', async () => {
    const results = await Promise.all(SCENARIOS.map(runScenario))
    const charges = results.flatMap((r) => r.listCharges as Array<{ pricingMethod: string; chargeType: string }>)
    expect(new Set(charges.map((c) => c.pricingMethod))).toEqual(new Set(['flat', 'per_unit', 'tiered', 'volume']))
    expect(new Set(charges.map((c) => c.chargeType))).toEqual(new Set(['nrc', 'mrc', 'usage']))
    expect(results.some((r) => (r.charges as Array<{ adjustments?: Array<{ origin: string }> }>).some((c) => c.adjustments?.some((a) => a.origin === 'rule')))).toBe(true)
    expect(results.some((r) => (r.charges as Array<{ adjustments?: Array<{ origin: string }> }>).some((c) => c.adjustments?.some((a) => a.origin === 'manual')))).toBe(true)
    expect(Object.keys(OFFERINGS).length).toBeGreaterThanOrEqual(10)
  })
})
