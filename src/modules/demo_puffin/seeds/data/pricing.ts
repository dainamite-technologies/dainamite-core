// Puffin Cloud pricing reference data (XD-275). All values are USD.

// --- Compute family × size pricing table -----------------------------------

export type ComputeRow = {
  family: string
  size: string
  vcpu: number
  ram_gb: number
  price_per_hour: number
}

export const COMPUTE_PRICING: ComputeRow[] = [
  { family: 'general', size: 'xs', vcpu: 1, ram_gb: 1, price_per_hour: 0.0083 },
  { family: 'general', size: 'sm', vcpu: 1, ram_gb: 2, price_per_hour: 0.0167 },
  { family: 'general', size: 'md', vcpu: 2, ram_gb: 4, price_per_hour: 0.0333 },
  { family: 'general', size: 'lg', vcpu: 4, ram_gb: 8, price_per_hour: 0.0667 },
  { family: 'general', size: 'xl', vcpu: 8, ram_gb: 16, price_per_hour: 0.1333 },
  { family: 'general', size: '2xl', vcpu: 16, ram_gb: 32, price_per_hour: 0.2667 },
  { family: 'general', size: '4xl', vcpu: 32, ram_gb: 64, price_per_hour: 0.5333 },
  { family: 'cpu-optimized', size: 'md', vcpu: 2, ram_gb: 4, price_per_hour: 0.0395 },
  { family: 'cpu-optimized', size: 'lg', vcpu: 4, ram_gb: 8, price_per_hour: 0.079 },
  { family: 'cpu-optimized', size: 'xl', vcpu: 8, ram_gb: 16, price_per_hour: 0.158 },
  { family: 'cpu-optimized', size: '2xl', vcpu: 16, ram_gb: 32, price_per_hour: 0.316 },
  { family: 'cpu-optimized', size: '4xl', vcpu: 32, ram_gb: 64, price_per_hour: 0.632 },
  { family: 'mem-optimized', size: 'lg', vcpu: 4, ram_gb: 32, price_per_hour: 0.1234 },
  { family: 'mem-optimized', size: 'xl', vcpu: 8, ram_gb: 64, price_per_hour: 0.2468 },
  { family: 'mem-optimized', size: '2xl', vcpu: 16, ram_gb: 128, price_per_hour: 0.4936 },
  { family: 'mem-optimized', size: '4xl', vcpu: 32, ram_gb: 256, price_per_hour: 0.9872 },
  { family: 'gpu', size: 'gpu-t4', vcpu: 4, ram_gb: 16, price_per_hour: 0.524 },
  { family: 'gpu', size: 'gpu-a10', vcpu: 8, ram_gb: 32, price_per_hour: 1.45 },
  { family: 'gpu', size: 'gpu-a100', vcpu: 16, ram_gb: 80, price_per_hour: 3.45 },
]

// --- CDN egress tiers ------------------------------------------------------

export const CDN_EGRESS_TIERS = [
  { tier: 0, from: 0, to: 10000, per_gb: 0.085 },
  { tier: 1, from: 10001, to: 50000, per_gb: 0.07 },
  { tier: 2, from: 50001, to: 150000, per_gb: 0.055 },
  { tier: 3, from: 150001, to: 500000, per_gb: 0.04 },
  { tier: 4, from: 500001, to: null, per_gb: 0.03 },
]

// --- Bandwidth (standalone egress) tiers -----------------------------------

export const BANDWIDTH_TIERS = [
  { tier: 0, from: 0, to: 10000, per_gb: 0.012 },
  { tier: 1, from: 10001, to: 50000, per_gb: 0.01 },
  { tier: 2, from: 50001, to: 150000, per_gb: 0.008 },
  { tier: 3, from: 150001, to: null, per_gb: 0.006 },
]

// --- Managed DB pricing — engine × plan × ha base MRC ---------------------

export type DbPricingRow = {
  engine: 'postgres' | 'mysql' | 'redis' | 'mongodb'
  plan: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  ha_replicas: 0 | 1 | 2
  mrc: number
}

const DB_BASE_MATRIX: Array<{
  engine: DbPricingRow['engine']
  plan: DbPricingRow['plan']
  base_mrc: number
}> = [
  { engine: 'postgres', plan: 'sm', base_mrc: 18.0 },
  { engine: 'postgres', plan: 'md', base_mrc: 60.0 },
  { engine: 'postgres', plan: 'lg', base_mrc: 144.0 },
  { engine: 'postgres', plan: 'xl', base_mrc: 320.0 },
  { engine: 'postgres', plan: '2xl', base_mrc: 680.0 },
  { engine: 'mysql', plan: 'sm', base_mrc: 18.0 },
  { engine: 'mysql', plan: 'md', base_mrc: 60.0 },
  { engine: 'mysql', plan: 'lg', base_mrc: 144.0 },
  { engine: 'mysql', plan: 'xl', base_mrc: 320.0 },
  { engine: 'mysql', plan: '2xl', base_mrc: 680.0 },
  // Redis omits 2xl per XD-275.
  { engine: 'redis', plan: 'sm', base_mrc: 22.0 },
  { engine: 'redis', plan: 'md', base_mrc: 75.0 },
  { engine: 'redis', plan: 'lg', base_mrc: 165.0 },
  { engine: 'redis', plan: 'xl', base_mrc: 360.0 },
  { engine: 'mongodb', plan: 'sm', base_mrc: 24.0 },
  { engine: 'mongodb', plan: 'md', base_mrc: 78.0 },
  { engine: 'mongodb', plan: 'lg', base_mrc: 188.0 },
  { engine: 'mongodb', plan: 'xl', base_mrc: 416.0 },
]

// HA-1 = 2× base. HA-2 = 3× base. Matches the table in XD-275 §Managed DB.
export const DB_PRICING: DbPricingRow[] = DB_BASE_MATRIX.flatMap((entry) =>
  ([0, 1, 2] as const).map((ha) => ({
    engine: entry.engine,
    plan: entry.plan,
    ha_replicas: ha,
    mrc: Number((entry.base_mrc * (ha + 1)).toFixed(2)),
  })),
)

// --- DB engine → version mapping (used by the version reference attribute) -

export const DB_ENGINE_VERSIONS: Record<DbPricingRow['engine'], string[]> = {
  postgres: ['14', '15', '16'],
  mysql: ['8.0', '8.4'],
  redis: ['7.2'],
  mongodb: ['7.0'],
}

// --- Object Storage charges (per XD-275 table) -----------------------------

export const OBJECT_STORAGE_CHARGES = {
  stored_per_gb_month: 0.02,
  egress_per_gb: 0.01,
  class_a_per_1k: 0.005,
  class_b_per_10k: 0.004,
  platform_mrc: 0,
} as const

// --- API Gateway charges ---------------------------------------------------

export const API_GATEWAY_CHARGES = {
  per_million_requests: 0.2,
  per_gb_second: 0.0000166667,
  free_requests: 1_000_000,
  free_gb_seconds: 400_000,
} as const
