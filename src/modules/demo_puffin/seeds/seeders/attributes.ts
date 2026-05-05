import type { EntityManager } from '@mikro-orm/postgresql'
import { DB_ENGINE_VERSIONS } from '../data/pricing'
import { REGIONS } from '../data/products'
import type { SeedScope } from './_types'

type AttrInput = {
  code: string
  name: string
  attributeType: string
  options?: Array<{ value: string; label: string }> | null
  constraints?: Record<string, unknown> | null
  sortOrder: number
  isRequired?: boolean
}

async function ensureAttribute(
  em: EntityManager,
  scope: SeedScope,
  productId: string,
  attr: AttrInput,
): Promise<void> {
  const { CpqProductAttribute } = await import('../../../cpq/data/entities')
  const exists = await em.findOne(CpqProductAttribute, { ...scope, productId, code: attr.code })
  if (!exists) {
    em.persist(
      em.create(CpqProductAttribute, {
        ...scope,
        productId,
        code: attr.code,
        name: attr.name,
        attributeType: attr.attributeType,
        options: attr.options ?? null,
        constraints: attr.constraints ?? null,
        sortOrder: attr.sortOrder,
        isRequired: attr.isRequired ?? false,
      }),
    )
  }
}

const REGION_OPTIONS = REGIONS.map((r) => ({ value: r.value, label: r.label }))

/**
 * Seed product-scoped attributes per the XD-275 spec. Spec linkage happens
 * later in `seedPuffinSpecsLinkage` once specs/offerings are committed.
 */
export async function seedPuffinAttributes(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const productBySku = async (sku: string) => {
    const p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
    if (!p) {
      console.warn(`[demo_puffin] product missing for SKU ${sku} — skipping its attributes`)
      return null
    }
    return p.id
  }

  // --- VPS line attributes ---------------------------------------------------
  const vpsId = await productBySku('PUFFIN-VPS')
  if (vpsId) {
    await ensureAttribute(em, scope, vpsId, {
      code: 'region',
      name: 'Region',
      attributeType: 'enum',
      options: REGION_OPTIONS,
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, vpsId, {
      code: 'os_image',
      name: 'OS Image',
      attributeType: 'enum',
      options: [
        { value: 'ubuntu-24-04', label: 'Ubuntu 24.04 LTS' },
        { value: 'debian-12', label: 'Debian 12' },
        { value: 'rocky-9', label: 'Rocky Linux 9' },
      ],
      sortOrder: 1,
      isRequired: true,
    })
    await ensureAttribute(em, scope, vpsId, {
      code: 'backups',
      name: 'Backups (+20% MRC)',
      attributeType: 'boolean',
      sortOrder: 2,
      isRequired: false,
    })
  }

  // --- Compute --------------------------------------------------------------
  const computeId = await productBySku('PUFFIN-COMPUTE')
  if (computeId) {
    await ensureAttribute(em, scope, computeId, {
      code: 'instance_family',
      name: 'Instance Family',
      attributeType: 'enum',
      options: [
        { value: 'general', label: 'General Purpose' },
        { value: 'cpu-optimized', label: 'CPU-Optimized' },
        { value: 'mem-optimized', label: 'Memory-Optimized' },
        { value: 'gpu', label: 'GPU' },
      ],
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, computeId, {
      code: 'instance_size',
      name: 'Instance Size',
      attributeType: 'enum',
      options: null,
      constraints: {
        dependsOn: { attributeCode: 'instance_family', effect: 'filter_options' },
        dynamicOptionsSource: {
          type: 'pricing_table',
          tableCode: 'puffin_compute_pricing',
          dimensionKey: 'instance_size',
          filterByDimension: { instance_family: '$instance_family' },
        },
      },
      sortOrder: 1,
      isRequired: true,
    })
    await ensureAttribute(em, scope, computeId, {
      code: 'region',
      name: 'Region',
      attributeType: 'enum',
      options: REGION_OPTIONS,
      sortOrder: 2,
      isRequired: true,
    })
    await ensureAttribute(em, scope, computeId, {
      code: 'monthly_active_hours',
      name: 'Estimated Monthly Active Hours',
      attributeType: 'number',
      constraints: { min: 0, max: 744, step: 1, default: 730 },
      sortOrder: 3,
      isRequired: false,
    })
    await ensureAttribute(em, scope, computeId, {
      code: 'reserved_term',
      name: 'Reserved Term',
      attributeType: 'enum',
      options: [
        { value: 'on_demand', label: 'On-Demand' },
        { value: '1y', label: 'Reserved 1 year' },
        { value: '3y', label: 'Reserved 3 years' },
      ],
      sortOrder: 4,
      isRequired: false,
    })
  }

  // --- Block Storage --------------------------------------------------------
  const blockId = await productBySku('PUFFIN-BLOCK-STORAGE')
  if (blockId) {
    await ensureAttribute(em, scope, blockId, {
      code: 'volume_size_gb',
      name: 'Volume Size (GB)',
      attributeType: 'number',
      constraints: { min: 10, max: 16000, step: 10 },
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, blockId, {
      code: 'region',
      name: 'Region',
      attributeType: 'enum',
      options: REGION_OPTIONS,
      sortOrder: 1,
      isRequired: true,
    })
  }

  // --- Object Storage -------------------------------------------------------
  const objectId = await productBySku('PUFFIN-OBJECT-STORAGE')
  if (objectId) {
    await ensureAttribute(em, scope, objectId, {
      code: 'region',
      name: 'Region',
      attributeType: 'enum',
      options: REGION_OPTIONS,
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, objectId, {
      code: 'monthly_storage_gb',
      name: 'Stored (GB)',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 1,
    })
    await ensureAttribute(em, scope, objectId, {
      code: 'monthly_egress_gb',
      name: 'Egress (GB)',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 2,
    })
    await ensureAttribute(em, scope, objectId, {
      code: 'monthly_class_a_requests_thousands',
      name: 'Class-A requests (thousands)',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 3,
    })
    await ensureAttribute(em, scope, objectId, {
      code: 'monthly_class_b_requests_ten_thousands',
      name: 'Class-B requests (×10,000)',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 4,
    })
  }

  // --- CDN ------------------------------------------------------------------
  const cdnId = await productBySku('PUFFIN-CDN')
  if (cdnId) {
    await ensureAttribute(em, scope, cdnId, {
      code: 'monthly_egress_gb',
      name: 'Monthly Egress (GB)',
      attributeType: 'number',
      constraints: { min: 0, step: 100 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  // --- API Gateway ----------------------------------------------------------
  const apiId = await productBySku('PUFFIN-API-GATEWAY')
  if (apiId) {
    await ensureAttribute(em, scope, apiId, {
      code: 'runtime',
      name: 'Runtime',
      attributeType: 'enum',
      options: [
        { value: 'node', label: 'Node.js' },
        { value: 'python', label: 'Python' },
        { value: 'go', label: 'Go' },
      ],
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, apiId, {
      code: 'memory_mb',
      name: 'Memory (MB)',
      attributeType: 'enum',
      options: [128, 256, 512, 1024, 2048, 4096].map((v) => ({ value: String(v), label: `${v} MB` })),
      sortOrder: 1,
      isRequired: true,
    })
    await ensureAttribute(em, scope, apiId, {
      code: 'monthly_requests_million',
      name: 'Monthly Requests (millions)',
      attributeType: 'number',
      constraints: { min: 0, step: 0.1 },
      sortOrder: 2,
    })
    await ensureAttribute(em, scope, apiId, {
      code: 'monthly_compute_gb_seconds_thousands',
      name: 'Compute (thousands of GB-seconds)',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 3,
    })
  }

  // --- DDoS Shield ----------------------------------------------------------
  const ddosId = await productBySku('PUFFIN-DDOS')
  if (ddosId) {
    await ensureAttribute(em, scope, ddosId, {
      code: 'contract_term_months',
      name: 'Contract Term (months)',
      attributeType: 'number',
      constraints: { min: 0, max: 60, step: 1 },
      sortOrder: 0,
      isRequired: false,
    })
  }

  // --- Managed DB — the attribute-rich showcase ----------------------------
  const dbId = await productBySku('PUFFIN-MANAGED-DB')
  if (dbId) {
    await ensureAttribute(em, scope, dbId, {
      code: 'db_engine',
      name: 'Database Engine',
      attributeType: 'enum',
      options: [
        { value: 'postgres', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'redis', label: 'Redis' },
        { value: 'mongodb', label: 'MongoDB' },
      ],
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'version',
      name: 'Version',
      attributeType: 'enum',
      options: null,
      constraints: {
        dependsOn: { attributeCode: 'db_engine', effect: 'filter_options' },
        engineVersionMap: DB_ENGINE_VERSIONS,
      },
      sortOrder: 1,
      isRequired: true,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'plan_size',
      name: 'Plan Size',
      attributeType: 'enum',
      options: [
        { value: 'sm', label: 'Small' },
        { value: 'md', label: 'Medium' },
        { value: 'lg', label: 'Large' },
        { value: 'xl', label: 'Extra Large' },
        { value: '2xl', label: '2× Extra Large' },
      ],
      sortOrder: 2,
      isRequired: true,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'region',
      name: 'Region',
      attributeType: 'enum',
      options: REGION_OPTIONS,
      sortOrder: 3,
      isRequired: true,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'ha_replicas',
      name: 'HA Replicas',
      attributeType: 'number',
      constraints: { min: 0, max: 2, step: 1, default: 0 },
      sortOrder: 4,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'read_replicas',
      name: 'Read Replicas',
      attributeType: 'number',
      constraints: {
        min: 0,
        max: 5,
        step: 1,
        default: 0,
        dependsOn: { attributeCode: 'ha_replicas', operator: 'gte', value: 1 },
      },
      sortOrder: 5,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'backup_retention_days',
      name: 'Backup Retention (days)',
      attributeType: 'enum',
      options: [
        { value: '7', label: '7 days' },
        { value: '14', label: '14 days' },
        { value: '30', label: '30 days' },
      ],
      sortOrder: 6,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'pitr_enabled',
      name: 'Point-in-Time Recovery',
      attributeType: 'boolean',
      constraints: {
        dependsOn: { attributeCode: 'db_engine', operator: 'in', value: ['postgres', 'mysql'] },
      },
      sortOrder: 7,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'vpc_peering',
      name: 'VPC Peering (+$20)',
      attributeType: 'boolean',
      sortOrder: 8,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'parameter_group',
      name: 'Parameter Group',
      attributeType: 'reference',
      constraints: {
        referenceEntity: 'cpq_parameter_groups',
        dependsOn: { attributeCode: 'db_engine', effect: 'filter_options' },
      },
      sortOrder: 9,
      isRequired: false,
    })
    await ensureAttribute(em, scope, dbId, {
      code: 'maintenance_window',
      name: 'Maintenance Window (cron)',
      attributeType: 'text',
      sortOrder: 10,
      isRequired: false,
    })
  }

  // --- Workspace ------------------------------------------------------------
  const workspaceId = await productBySku('PUFFIN-WORKSPACE')
  if (workspaceId) {
    await ensureAttribute(em, scope, workspaceId, {
      code: 'seat_count',
      name: 'Seat Count',
      attributeType: 'number',
      constraints: { min: 1, max: 1000, step: 1, default: 10 },
      sortOrder: 0,
      isRequired: true,
    })
    await ensureAttribute(em, scope, workspaceId, {
      code: 'billing_cadence',
      name: 'Billing Cadence',
      attributeType: 'enum',
      options: [
        { value: 'monthly', label: 'Monthly' },
        { value: 'annual_prepay', label: 'Annual (prepay −15%)' },
      ],
      sortOrder: 1,
      isRequired: false,
    })
  }

  // --- Premium Support ------------------------------------------------------
  const premiumId = await productBySku('PUFFIN-PREMIUM-SUPPORT')
  if (premiumId) {
    await ensureAttribute(em, scope, premiumId, {
      code: 'included_tam_hours',
      name: 'Included TAM Hours',
      attributeType: 'number',
      constraints: { min: 0, step: 1, default: 10 },
      sortOrder: 0,
    })
    await ensureAttribute(em, scope, premiumId, {
      code: 'tam_hours_used',
      name: 'TAM Hours Used',
      attributeType: 'number',
      constraints: { min: 0, step: 1 },
      sortOrder: 1,
    })
    await ensureAttribute(em, scope, premiumId, {
      code: 'dedicated_line',
      name: 'Dedicated Phone + 15-min SLA',
      attributeType: 'boolean',
      sortOrder: 2,
    })
    await ensureAttribute(em, scope, premiumId, {
      code: 'reserved_term',
      name: 'Reserved Term',
      attributeType: 'enum',
      options: [
        { value: 'none', label: 'None' },
        { value: '1y', label: 'Reserved 1 year (-10%)' },
        { value: '3y', label: 'Reserved 3 years (-18%)' },
      ],
      sortOrder: 3,
    })
  }

  // --- Bandwidth ------------------------------------------------------------
  const bwId = await productBySku('PUFFIN-BANDWIDTH')
  if (bwId) {
    await ensureAttribute(em, scope, bwId, {
      code: 'monthly_egress_gb',
      name: 'Monthly Egress (GB)',
      attributeType: 'number',
      constraints: { min: 0, step: 100 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  await em.flush()
}
