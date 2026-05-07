// Puffin Cloud catalog — product specifications and offerings (XD-275).
// Each entry maps to a CatalogProduct + CpqProductSpecification + one or
// more CpqProductOffering. Modelling note: VPS uses the discrete-offerings
// pattern (one offering per plan card), Compute uses the multidimensional
// pricing-table pattern (one offering, attribute-driven).

export type ProductDef = {
  sku: string
  title: string
  description: string
  /** Spec code used as `CpqProductSpecification.code`. */
  specCode: string
  /** spec_type; `simple` for everything except bundles. */
  specType?: 'simple' | 'bundle'
  /** Discrete offerings. For attribute-driven products this is a single offering. */
  offerings: Array<{
    code: string
    name: string
    description: string
    /** Per-plan dimensions stored on the offering for read-only display. */
    designTimeValues?: Record<string, unknown>
    /** XD-275 §`metadata.listedInCalculator`. Defaults to true (public calculator). */
    listedInCalculator?: boolean
  }>
}

// --- VPS — discrete-offerings pattern -------------------------------------

export const VPS: ProductDef = {
  sku: 'PUFFIN-VPS',
  title: 'Puffin VPS',
  description: 'Fixed-size virtual private server billed monthly. Marketing names use Puffin species.',
  specCode: 'SPEC-PUFFIN-VPS',
  offerings: [
    {
      code: 'vps_nano',
      name: 'Puffling',
      description: 'Tiny VPS — perfect for hobby projects.',
      designTimeValues: { vcpu: 1, ram_gb: 1, disk_gb: 25, bundled_egress_tb: 1, mrc: 5.0, nrc: 5.0 },
    },
    {
      code: 'vps_micro',
      name: 'Tufted',
      description: 'Small VPS for low-traffic sites.',
      designTimeValues: { vcpu: 1, ram_gb: 2, disk_gb: 50, bundled_egress_tb: 2, mrc: 12.0, nrc: 5.0 },
    },
    {
      code: 'vps_small',
      name: 'Atlantic',
      description: 'Standard VPS for production apps and shops.',
      designTimeValues: { vcpu: 2, ram_gb: 4, disk_gb: 80, bundled_egress_tb: 4, mrc: 24.0, nrc: 5.0 },
    },
    {
      code: 'vps_medium',
      name: 'Horned',
      description: 'Mid-tier VPS for busier workloads.',
      designTimeValues: { vcpu: 4, ram_gb: 8, disk_gb: 160, bundled_egress_tb: 5, mrc: 48.0, nrc: 10.0 },
    },
    {
      code: 'vps_large',
      name: 'Rhinoceros',
      description: 'Large VPS for high-traffic services.',
      designTimeValues: { vcpu: 8, ram_gb: 16, disk_gb: 320, bundled_egress_tb: 6, mrc: 96.0, nrc: 10.0 },
    },
    {
      code: 'vps_xlarge',
      name: 'Crested',
      description: 'Extra-large VPS for serious applications.',
      designTimeValues: { vcpu: 16, ram_gb: 32, disk_gb: 640, bundled_egress_tb: 8, mrc: 192.0, nrc: 20.0 },
    },
    {
      code: 'vps_mega',
      name: 'Emperor',
      description: 'Top-tier VPS for demanding workloads.',
      designTimeValues: { vcpu: 32, ram_gb: 64, disk_gb: 1280, bundled_egress_tb: 10, mrc: 384.0, nrc: 20.0 },
    },
  ],
}

// --- Compute — single offering + multidimensional pricing table -----------

export const COMPUTE: ProductDef = {
  sku: 'PUFFIN-COMPUTE',
  title: 'Puffin Compute',
  description: 'On-demand instance compute billed per-minute, post-paid usage. Reserved-term option converts to MRC.',
  specCode: 'SPEC-PUFFIN-COMPUTE',
  offerings: [
    {
      code: 'OFFER-PUFFIN-COMPUTE',
      name: 'Puffin Compute — On Demand',
      description: 'Per-minute on-demand compute. Family × size dimensions.',
    },
  ],
}

// --- Block Storage — two offerings (standard / provisioned) ---------------

export const BLOCK_STORAGE: ProductDef = {
  sku: 'PUFFIN-BLOCK-STORAGE',
  title: 'Puffin Block Storage',
  description: 'SSD volumes attached to VPS or Compute. Per GB-month.',
  specCode: 'SPEC-PUFFIN-BLOCK-STORAGE',
  offerings: [
    {
      code: 'OFFER-PUFFIN-BLOCK-STD',
      name: 'Block Storage — Standard',
      description: 'Up to 3,000 IOPS shared. $0.10 / GB / mo.',
      designTimeValues: { iops_tier: 'standard', price_per_gb: 0.1 },
    },
    {
      code: 'OFFER-PUFFIN-BLOCK-PROV',
      name: 'Block Storage — Provisioned',
      description: 'Guaranteed up to 16,000 IOPS. $0.25 / GB / mo.',
      designTimeValues: { iops_tier: 'provisioned', price_per_gb: 0.25 },
    },
  ],
}

// --- Object Storage — single offering, composite usage charges ------------

export const OBJECT_STORAGE: ProductDef = {
  sku: 'PUFFIN-OBJECT-STORAGE',
  title: 'Puffin Object Storage',
  description: 'S3-compatible bucket storage. Stored + egress + requests.',
  specCode: 'SPEC-PUFFIN-OBJECT-STORAGE',
  offerings: [
    {
      code: 'OFFER-PUFFIN-OBJECT-STORAGE',
      name: 'Puffin Object Storage',
      description: 'Pay-as-you-go global S3-compatible storage.',
    },
  ],
}

// --- CDN ------------------------------------------------------------------

export const CDN: ProductDef = {
  sku: 'PUFFIN-CDN',
  title: 'Puffin CDN',
  description: 'Global content delivery with tiered egress + flat platform fee.',
  specCode: 'SPEC-PUFFIN-CDN',
  offerings: [
    {
      code: 'OFFER-PUFFIN-CDN',
      name: 'Puffin CDN',
      description: 'Tiered egress pricing + $25/mo platform fee.',
    },
    {
      code: 'OFFER-PUFFIN-CDN-WAF',
      name: 'Puffin CDN — WAF Add-on',
      description: 'Web Application Firewall add-on for Puffin CDN. $50/mo.',
      designTimeValues: { mrc: 50.0 },
    },
  ],
}

// --- API Gateway / Functions ----------------------------------------------

export const API_GATEWAY: ProductDef = {
  sku: 'PUFFIN-API-GATEWAY',
  title: 'Puffin API Gateway / Functions',
  description: 'Serverless functions and API gateway. Per-million requests + per-GB-second of compute.',
  specCode: 'SPEC-PUFFIN-API-GATEWAY',
  offerings: [
    {
      code: 'OFFER-PUFFIN-API-GATEWAY',
      name: 'Puffin API Gateway / Functions',
      description: 'Pay-per-request + per-GB-s. First 1M requests + 400k GB-s/month free.',
    },
  ],
}

// --- DDoS Shield — three discrete tier offerings --------------------------

export const DDOS: ProductDef = {
  sku: 'PUFFIN-DDOS',
  title: 'Puffin DDoS Shield',
  description: 'DDoS protection in three tiers; standard / advanced / enterprise.',
  specCode: 'SPEC-PUFFIN-DDOS',
  offerings: [
    {
      code: 'OFFER-PUFFIN-DDOS-STD',
      name: 'DDoS Shield — Standard',
      description: '10 Gbps capacity, 99.9% SLA. $49/mo.',
      designTimeValues: { capacity: '10 Gbps', sla: '99.9%', mrc: 49.0, nrc: 0 },
    },
    {
      code: 'OFFER-PUFFIN-DDOS-ADV',
      name: 'DDoS Shield — Advanced',
      description: '100 Gbps capacity, 99.95% SLA.',
      designTimeValues: { capacity: '100 Gbps', sla: '99.95%', mrc: 299.0, nrc: 200.0 },
    },
    {
      code: 'OFFER-PUFFIN-DDOS-ENT',
      name: 'DDoS Shield — Enterprise',
      description: '1 Tbps + scrubbing, 99.99% SLA. Term ≥ 12 mo required.',
      designTimeValues: {
        capacity: '1 Tbps',
        sla: '99.99%',
        mrc: 1999.0,
        nrc: 1000.0,
        contract_term_months_min: 12,
      },
    },
  ],
}

// --- Managed Database — single offering, attribute-rich -------------------

export const MANAGED_DB: ProductDef = {
  sku: 'PUFFIN-MANAGED-DB',
  title: 'Puffin Managed Database',
  description: 'Showcase product for attribute-driven configuration. Postgres / MySQL / Redis / MongoDB.',
  specCode: 'SPEC-PUFFIN-MANAGED-DB',
  offerings: [
    {
      code: 'OFFER-PUFFIN-MANAGED-DB',
      name: 'Puffin Managed Database',
      description: 'Engine, version, plan size, HA, replicas, PITR, retention — all attribute-driven.',
    },
  ],
}

// --- Workspace — four discrete plan offerings + add-ons -------------------

export const WORKSPACE: ProductDef = {
  sku: 'PUFFIN-WORKSPACE',
  title: 'Puffin Workspace',
  description: 'SaaS-seat licensing with plan tiers, add-ons, and seat-count volume tiers.',
  specCode: 'SPEC-PUFFIN-WORKSPACE',
  offerings: [
    {
      code: 'workspace_essentials',
      name: 'Workspace Essentials',
      description: 'Mail + calendar + chat. 30 GB/seat.',
      designTimeValues: { seat_price: 6.0, storage_gb_per_seat: 30 },
    },
    {
      code: 'workspace_business',
      name: 'Workspace Business',
      description: '+ Office apps + 100-participant video. 2 TB/seat.',
      designTimeValues: { seat_price: 12.0, storage_tb_per_seat: 2 },
    },
    {
      code: 'workspace_business_premium',
      name: 'Workspace Business Premium',
      description: '+ advanced security + endpoint mgmt. 2 TB/seat.',
      designTimeValues: { seat_price: 22.0, storage_tb_per_seat: 2 },
    },
    {
      code: 'workspace_enterprise',
      name: 'Workspace Enterprise',
      description: '+ DLP + audit + 250-participant video. 5 TB/seat.',
      designTimeValues: { seat_price: 35.0, storage_tb_per_seat: 5 },
    },
    // Add-ons — separate offerings, attached to a Workspace line.
    {
      code: 'ws_email_archive',
      name: 'Email Archive (10 yr retention)',
      description: 'Per-seat add-on. $3.00 / seat / mo.',
      designTimeValues: { seat_price: 3.0 },
    },
    {
      code: 'ws_atp',
      name: 'Advanced Threat Protection',
      description: 'Per-seat add-on. $2.50 / seat / mo. Requires Business+.',
      designTimeValues: { seat_price: 2.5, requires_plan_tier: 'business+' },
    },
    {
      code: 'ws_extra_storage',
      name: 'Extra Storage',
      description: 'Per-TB-month. $0.020 / GB / mo.',
      designTimeValues: { price_per_gb: 0.02 },
    },
    {
      code: 'ws_compliance',
      name: 'Compliance Pack (HIPAA/FINRA)',
      description: 'Flat $499/mo. Requires Enterprise plan.',
      designTimeValues: { mrc: 499.0, requires_plan_tier: 'enterprise' },
    },
  ],
}

// --- Bandwidth — single offering, tiered ---------------------------------

export const BANDWIDTH: ProductDef = {
  sku: 'PUFFIN-BANDWIDTH',
  title: 'Puffin Bandwidth',
  description: 'Outbound egress not bundled with another product. Tiered per GB.',
  specCode: 'SPEC-PUFFIN-BANDWIDTH',
  offerings: [
    {
      code: 'OFFER-PUFFIN-BANDWIDTH',
      name: 'Puffin Bandwidth — Standalone Egress',
      description: 'Inbound free. Tiered per-GB outbound.',
    },
  ],
}

// --- Support — three flat tiers ------------------------------------------

export const SUPPORT: ProductDef = {
  sku: 'PUFFIN-SUPPORT',
  title: 'Puffin Support',
  description: 'Tiered flat-rate support plans.',
  specCode: 'SPEC-PUFFIN-SUPPORT',
  offerings: [
    {
      code: 'support_community',
      name: 'Community Support',
      description: 'Free. Best-effort.',
      designTimeValues: { mrc: 0.0, sla_hours: null },
    },
    {
      code: 'support_developer',
      name: 'Developer Support',
      description: '$29/mo flat. <12h business response SLA.',
      designTimeValues: { mrc: 29.0, sla_hours: 12 },
    },
    {
      code: 'support_business',
      name: 'Business Support',
      description: '$199/mo flat. <1h 24/7 response SLA.',
      designTimeValues: { mrc: 199.0, sla_hours: 1 },
    },
  ],
}

// --- Premium Support — composite-priced ----------------------------------

export const PREMIUM_SUPPORT: ProductDef = {
  sku: 'PUFFIN-PREMIUM-SUPPORT',
  title: 'Puffin Premium Support',
  description: 'Composite-priced support: base $500 + 6% spend uplift + 10 included TAM hours + optional dedicated phone.',
  specCode: 'SPEC-PUFFIN-PREMIUM-SUPPORT',
  offerings: [
    {
      code: 'premium_support',
      name: 'Premium Support',
      description: '$500 base + 6% MRC uplift + 10 TAM hours + reserved discounts (-10% 1y, -18% 3y).',
      designTimeValues: { base_mrc: 500.0, included_tam_hours: 10, overage_per_hour: 250.0 },
    },
  ],
}

// --- Bundles (3 specs of type=bundle, each with 3 package offerings) -----

export const BUNDLE_DEV_APP: ProductDef = {
  sku: 'PUFFIN-BUNDLE-DEV-APP',
  title: 'Ship My App',
  description: 'For solo developers and small teams deploying an app or side-project.',
  specCode: 'SPEC-PUFFIN-BUNDLE-DEV-APP',
  specType: 'bundle',
  offerings: [
    {
      code: 'dev_app_solo',
      name: 'Solo Developer',
      description: 'Tiny stack for a side-project. ≈$30/mo.',
      designTimeValues: {
        vps_offering: 'vps_nano',
        backups: true,
        db_engine: 'postgres',
        db_plan: 'sm',
        db_ha: 0,
        db_backup_days: 7,
        cdn: false,
        support: 'support_community',
        indicative_mrc: 30,
      },
    },
    {
      code: 'dev_app_standard',
      name: 'Standard',
      description: 'Production-ready app stack. ≈$100/mo.',
      designTimeValues: {
        vps_offering: 'vps_small',
        backups: true,
        db_engine: 'postgres',
        db_plan: 'sm',
        db_ha: 0,
        db_backup_days: 14,
        cdn: true,
        cdn_waf: false,
        support: 'support_developer',
        indicative_mrc: 100,
      },
    },
    {
      code: 'dev_app_pro',
      name: 'Pro',
      description: 'Resilient HA app stack. ≈$440/mo.',
      designTimeValues: {
        vps_offering: 'vps_medium',
        backups: true,
        db_engine: 'postgres',
        db_plan: 'md',
        db_ha: 1,
        db_pitr: true,
        db_backup_days: 30,
        cdn: true,
        cdn_waf: false,
        support: 'support_business',
        indicative_mrc: 440,
      },
    },
  ],
}

export const BUNDLE_ECOMMERCE: ProductDef = {
  sku: 'PUFFIN-BUNDLE-ECOMMERCE',
  title: 'Run My Online Shop',
  description: 'For e-commerce shops. Sized from a few hundred SKUs to high-traffic brands.',
  specCode: 'SPEC-PUFFIN-BUNDLE-ECOMMERCE',
  specType: 'bundle',
  offerings: [
    {
      code: 'ecom_small_shop',
      name: 'Small Shop',
      description: 'Single VPS shop. ≈$200/mo.',
      designTimeValues: {
        vps_offering: 'vps_small',
        vps_count: 1,
        backups: true,
        db_engine: 'mysql',
        db_plan: 'sm',
        db_ha: 0,
        db_backup_days: 14,
        cache: false,
        cdn: true,
        cdn_waf: false,
        ddos_tier: 'standard',
        bandwidth_tb: 1,
        support: 'support_developer',
        indicative_mrc: 200,
      },
    },
    {
      code: 'ecom_growing_shop',
      name: 'Growing Shop',
      description: 'Mid-volume shop with HA db + cache. ≈$1,050/mo.',
      designTimeValues: {
        vps_offering: 'vps_medium',
        vps_count: 1,
        backups: true,
        db_engine: 'mysql',
        db_plan: 'md',
        db_ha: 1,
        db_pitr: true,
        db_backup_days: 30,
        cache_engine: 'redis',
        cache_plan: 'sm',
        cache_ha: 0,
        cdn: true,
        cdn_waf: true,
        ddos_tier: 'advanced',
        bandwidth_tb: 5,
        support: 'support_business',
        indicative_mrc: 1050,
      },
    },
    {
      code: 'ecom_high_volume',
      name: 'High-Volume',
      description: 'Two large VPS, HA cache, enterprise DDoS. ≈$4,400/mo.',
      designTimeValues: {
        vps_offering: 'vps_large',
        vps_count: 2,
        backups: true,
        db_engine: 'mysql',
        db_plan: 'lg',
        db_ha: 1,
        db_pitr: true,
        db_backup_days: 30,
        cache_engine: 'redis',
        cache_plan: 'md',
        cache_ha: 1,
        cdn: true,
        cdn_waf: true,
        ddos_tier: 'enterprise',
        contract_term_months: 12,
        bandwidth_tb: 30,
        support: 'support_business',
        indicative_mrc: 4400,
      },
    },
  ],
}

export const BUNDLE_BUSINESS: ProductDef = {
  sku: 'PUFFIN-BUNDLE-BUSINESS-OFFICE',
  title: 'Run My Business',
  description: 'For SMBs hosting their corporate website + internal apps + Workspace.',
  specCode: 'SPEC-PUFFIN-BUNDLE-BUSINESS-OFFICE',
  specType: 'bundle',
  offerings: [
    {
      code: 'biz_small_team',
      name: 'Small Team',
      description: 'Single site + 10-seat Workspace. ≈$200/mo.',
      designTimeValues: {
        public_site_offering: 'vps_small',
        apps_count: 0,
        db_engine: 'postgres',
        db_plan: 'sm',
        db_ha: 0,
        db_backup_days: 14,
        ddos_tier: 'standard',
        workspace_offering: 'workspace_essentials',
        seat_count: 10,
        billing_cadence: 'annual_prepay',
        support: 'support_developer',
        indicative_mrc: 200,
      },
    },
    {
      code: 'biz_growing',
      name: 'Growing Business',
      description: 'Site + 1 apps host + 25 Workspace seats. ≈$580/mo.',
      designTimeValues: {
        public_site_offering: 'vps_small',
        apps_offering: 'vps_medium',
        apps_count: 1,
        db_engine: 'postgres',
        db_plan: 'sm',
        db_ha: 1,
        db_backup_days: 30,
        ddos_tier: 'standard',
        workspace_offering: 'workspace_business',
        seat_count: 25,
        billing_cadence: 'annual_prepay',
        support: 'support_business',
        indicative_mrc: 580,
      },
    },
    {
      code: 'biz_established',
      name: 'Established Business',
      description: 'Site + 2 apps + Workspace Business Premium 100 seats. ≈$3,700/mo.',
      designTimeValues: {
        public_site_offering: 'vps_medium',
        apps_offering: 'vps_medium',
        apps_count: 2,
        db_engine: 'postgres',
        db_plan: 'md',
        db_ha: 1,
        db_pitr: true,
        db_backup_days: 30,
        ddos_tier: 'advanced',
        workspace_offering: 'workspace_business_premium',
        seat_count: 100,
        billing_cadence: 'annual_prepay',
        workspace_archive: true,
        support: 'support_business',
        indicative_mrc: 3700,
      },
    },
  ],
}

export const ALL_PRODUCTS: ProductDef[] = [
  VPS,
  COMPUTE,
  BLOCK_STORAGE,
  OBJECT_STORAGE,
  CDN,
  API_GATEWAY,
  DDOS,
  MANAGED_DB,
  WORKSPACE,
  BANDWIDTH,
  SUPPORT,
  PREMIUM_SUPPORT,
  BUNDLE_DEV_APP,
  BUNDLE_ECOMMERCE,
  BUNDLE_BUSINESS,
]

export const REGIONS = [
  { value: 'fra1', label: 'Frankfurt 1' },
  { value: 'waw1', label: 'Warsaw 1' },
] as const
