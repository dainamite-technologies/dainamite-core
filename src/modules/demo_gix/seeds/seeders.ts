import type { EntityManager } from '@mikro-orm/postgresql'
import { DATA_CENTRE_OPTIONS, PRODUCTS } from './data/products'
import {
  ACCESS_PORT_PRICES,
  CLOUD_CONNECT_ENTRIES,
  INTERNET_PEERING_TIERS,
  MOBILE_PEERING_TIERS,
} from './data/pricing'

// Migrated from src/modules/cpq/setup.ts (XD-210). All GIX-specific seed
// logic now lives in this demo module — keeps `cpq` free of customer demo
// data per SPEC-001 / XD-276.

export type SeedScope = { tenantId: string; organizationId: string }

export async function seedGixProducts(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
  for (const p of PRODUCTS) {
    const exists = await em.findOne(CatalogProduct, { ...scope, sku: p.sku, deletedAt: null })
    if (!exists) {
      em.persist(
        em.create(CatalogProduct, {
          ...scope,
          title: p.title,
          sku: p.sku,
          handle: p.sku.toLowerCase(),
          productType: 'configurable',
          description: p.description,
          isConfigurable: true,
          isActive: true,
        }),
      )
    }
  }
  await em.flush()
}

export async function seedGixProductAttributes(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductAttribute } = await import('@dainamite/cpq/modules/cpq/data/entities')
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const productBySku = async (sku: string) => {
    let p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
    if (!p) {
      const handle = sku.toLowerCase()
      p = await em.findOne(CatalogProduct, { ...scope, handle, deletedAt: null })
      if (!p) {
        console.warn(`[demo_gix seed] Product not found for SKU "${sku}" or handle "${handle}" — skipping attributes`)
        return undefined
      }
    }
    return p.id
  }

  const ensure = async (
    productId: string,
    attr: {
      code: string
      name: string
      attributeType: string
      options?: Array<{ value: string; label: string }> | null
      constraints?: Record<string, unknown> | null
      sortOrder: number
      isRequired?: boolean
    },
  ) => {
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
          isRequired: attr.isRequired ?? true,
        }),
      )
    }
  }

  // GIX Access Port
  const accessPortId = await productBySku('GIX-ACCESS-PORT')
  if (accessPortId) {
    await ensure(accessPortId, {
      code: 'data_centre',
      name: 'Data Centre',
      attributeType: 'enum',
      options: DATA_CENTRE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      sortOrder: 0,
      isRequired: true,
    })
    await ensure(accessPortId, {
      code: 'port_size',
      name: 'Port Size',
      attributeType: 'enum',
      options: [
        { value: '1G', label: '1G' },
        { value: '10G', label: '10G' },
        { value: '100G', label: '100G' },
      ],
      constraints: { dependsOn: { attributeCode: 'data_centre', effect: 'filter_options' } },
      sortOrder: 1,
      isRequired: true,
    })
  }

  // GIX Internet Peering
  const internetPeeringId = await productBySku('GIX-INTERNET-PEERING')
  if (internetPeeringId) {
    await ensure(internetPeeringId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  // GIX Mobile Peering
  const mobilePeeringId = await productBySku('GIX-MOBILE-PEERING')
  if (mobilePeeringId) {
    await ensure(mobilePeeringId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 0,
      isRequired: true,
    })
  }

  // GIX Cloud Connect
  const cloudConnectId = await productBySku('GIX-CLOUD-CONNECT')
  if (cloudConnectId) {
    await ensure(cloudConnectId, {
      code: 'cloud_provider',
      name: 'Cloud Provider',
      attributeType: 'enum',
      options: [
        { value: 'AWS', label: 'AWS' },
        { value: 'GCP', label: 'GCP' },
        { value: 'MS Azure', label: 'MS Azure' },
      ],
      sortOrder: 0,
    })
    await ensure(cloudConnectId, {
      code: 'cloud_region',
      name: 'Cloud Region',
      attributeType: 'enum',
      options: null,
      constraints: {
        dependsOn: { attributeCode: 'cloud_provider', effect: 'filter_options' },
        dynamicOptionsSource: {
          type: 'pricing_table',
          tableCode: 'gix_cloud_connect_pricing',
          dimensionKey: 'cloud_region',
          filterByDimension: { cloud_provider: '$cloud_provider' },
        },
      },
      sortOrder: 1,
    })
    await ensure(cloudConnectId, {
      code: 'pricing_model',
      name: 'Pricing Model',
      attributeType: 'enum',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'burstable', label: 'Burstable' },
      ],
      sortOrder: 2,
    })
    await ensure(cloudConnectId, {
      code: 'bandwidth_mb',
      name: 'Bandwidth (MB)',
      attributeType: 'number',
      constraints: { min: 1, step: 1 },
      sortOrder: 3,
    })
  }

  await em.flush()
}

export async function seedGixPricingTables(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqPricingTable, CpqPricingTableEntry } = await import('@dainamite/cpq/modules/cpq/data/entities')

  const ensureTable = async (data: {
    code: string
    name: string
    dimensions: Array<{ key: string; label: string }>
    priceColumns: Array<{ key: string; label: string }>
    currencyCodeList: string[]
  }): Promise<string> => {
    let table = await em.findOne(CpqPricingTable, { ...scope, code: data.code })
    if (!table) {
      table = em.create(CpqPricingTable, { ...scope, ...data })
      em.persist(table)
      await em.flush()
    }
    return table.id
  }

  const ensureEntry = async (
    tableId: string,
    lookup: Record<string, unknown>,
    data: Record<string, unknown>,
  ) => {
    const exists = await em.findOne(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, ...lookup })
    if (!exists) {
      em.persist(em.create(CpqPricingTableEntry, { ...scope, pricingTableId: tableId, currencyCode: 'USD', ...data }))
    }
  }

  // Table 1: Access Port pricing
  const accessPortTableId = await ensureTable({
    code: 'gix_access_port_pricing',
    name: 'GIX Access Port Pricing',
    dimensions: [
      { key: 'data_centre', label: 'Data Centre' },
      { key: 'port_size', label: 'Port Size' },
    ],
    priceColumns: [
      { key: 'nrc', label: 'Setup Price (NRC)' },
      { key: 'mrc', label: 'Monthly Recurring (MRC)' },
    ],
    currencyCodeList: ['USD'],
  })

  for (const [dcCode, portSizes] of Object.entries(ACCESS_PORT_PRICES)) {
    for (const [portSize, prices] of Object.entries(portSizes)) {
      const dimValues = { data_centre: dcCode, port_size: portSize }
      await ensureEntry(accessPortTableId, { dimensionValues: dimValues }, {
        dimensionValues: dimValues,
        prices: { nrc: prices.nrc, mrc: prices.mrc },
      })
    }
  }
  await em.flush()

  // Table 2: Internet Peering pricing
  const internetPeeringTableId = await ensureTable({
    code: 'gix_internet_peering_pricing',
    name: 'GIX Internet Peering Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_mb', label: 'Price per MB' }],
    currencyCodeList: ['USD'],
  })

  for (const t of INTERNET_PEERING_TIERS) {
    await ensureEntry(internetPeeringTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_mb: t.per_mb },
    })
  }
  await em.flush()

  // Table 3: Mobile Peering pricing
  const mobilePeeringTableId = await ensureTable({
    code: 'gix_mobile_peering_pricing',
    name: 'GIX Mobile Peering Pricing',
    dimensions: [],
    priceColumns: [{ key: 'per_mb', label: 'Price per MB' }],
    currencyCodeList: ['USD'],
  })

  for (const t of MOBILE_PEERING_TIERS) {
    await ensureEntry(mobilePeeringTableId, { tierNumber: t.tier }, {
      dimensionValues: {},
      tierNumber: t.tier,
      rangeFrom: String(t.from),
      rangeTo: t.to != null ? String(t.to) : null,
      prices: { per_mb: t.per_mb },
    })
  }
  await em.flush()

  // Table 4: Cloud Connect pricing
  const cloudConnectTableId = await ensureTable({
    code: 'gix_cloud_connect_pricing',
    name: 'GIX Cloud Connect Pricing',
    dimensions: [
      { key: 'data_centre_location', label: 'Data Centre Location' },
      { key: 'cloud_provider', label: 'Cloud Provider' },
      { key: 'cloud_region', label: 'Cloud Region' },
    ],
    priceColumns: [
      { key: 'flat_per_mb', label: 'Flat Price per MB' },
      { key: 'commit_per_mb', label: 'Commit Price per MB' },
      { key: 'overage_per_mb', label: 'Overage Price per MB' },
    ],
    currencyCodeList: ['USD'],
  })

  for (const [location, provider, region, flat, commit, overage] of CLOUD_CONNECT_ENTRIES) {
    const dimValues = { data_centre_location: location, cloud_provider: provider, cloud_region: region }
    await ensureEntry(cloudConnectTableId, { dimensionValues: dimValues }, {
      dimensionValues: dimValues,
      prices: { flat_per_mb: flat, commit_per_mb: commit, overage_per_mb: overage },
    })
  }
  await em.flush()
}

export async function seedGixProductCharges(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductCharge, CpqPricingTable } = await import('@dainamite/cpq/modules/cpq/data/entities')
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const tableId = async (code: string) => {
    const t = await em.findOne(CpqPricingTable, { ...scope, code })
    return t?.id ?? null
  }

  const productId = async (sku: string) => {
    let p = await em.findOne(CatalogProduct, { ...scope, sku, deletedAt: null })
    if (!p) {
      const handle = sku.toLowerCase()
      p = await em.findOne(CatalogProduct, { ...scope, handle, deletedAt: null })
      if (!p) {
        console.warn(`[demo_gix seed] Product not found for SKU "${sku}" or handle "${handle}" — skipping charges`)
        return undefined
      }
    }
    return p.id
  }

  const ensure = async (
    pid: string,
    charge: {
      code: string
      name: string
      chargeType: string
      pricingMethod: string
      pricingTableId?: string | null
      priceColumnKey?: string | null
      quantityAttributeCode?: string | null
      applicabilityCondition?: Record<string, unknown> | null
      sortOrder: number
    },
  ) => {
    const exists = await em.findOne(CpqProductCharge, { ...scope, productId: pid, code: charge.code })
    if (!exists) {
      em.persist(em.create(CpqProductCharge, { ...scope, productId: pid, ...charge }))
    }
  }

  const accessPortTableId = await tableId('gix_access_port_pricing')
  const internetPeeringTableId = await tableId('gix_internet_peering_pricing')
  const mobilePeeringTableId = await tableId('gix_mobile_peering_pricing')
  const cloudConnectTableId = await tableId('gix_cloud_connect_pricing')

  // GIX Access Port charges
  const accessPortId = await productId('GIX-ACCESS-PORT')
  if (accessPortId) {
    await ensure(accessPortId, {
      code: 'setup_fee',
      name: 'Setup Fee',
      chargeType: 'nrc',
      pricingMethod: 'flat',
      pricingTableId: accessPortTableId,
      priceColumnKey: 'nrc',
      sortOrder: 0,
    })
    await ensure(accessPortId, {
      code: 'monthly_port_fee',
      name: 'Monthly Port Fee',
      chargeType: 'mrc',
      pricingMethod: 'flat',
      pricingTableId: accessPortTableId,
      priceColumnKey: 'mrc',
      sortOrder: 1,
    })
  }

  // GIX Internet Peering charges
  const internetPeeringId = await productId('GIX-INTERNET-PEERING')
  if (internetPeeringId) {
    await ensure(internetPeeringId, {
      code: 'bandwidth_fee',
      name: 'Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'tiered',
      pricingTableId: internetPeeringTableId,
      priceColumnKey: 'per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      sortOrder: 0,
    })
  }

  // GIX Mobile Peering charges
  const mobilePeeringId = await productId('GIX-MOBILE-PEERING')
  if (mobilePeeringId) {
    await ensure(mobilePeeringId, {
      code: 'bandwidth_fee',
      name: 'Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'tiered',
      pricingTableId: mobilePeeringTableId,
      priceColumnKey: 'per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      sortOrder: 0,
    })
  }

  // GIX Cloud Connect charges
  const cloudConnectId = await productId('GIX-CLOUD-CONNECT')
  if (cloudConnectId) {
    await ensure(cloudConnectId, {
      code: 'flat_bandwidth_fee',
      name: 'Flat Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'flat_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'flat' },
      sortOrder: 0,
    })
    await ensure(cloudConnectId, {
      code: 'commit_bandwidth_fee',
      name: 'Committed Bandwidth Fee',
      chargeType: 'mrc',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'commit_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 1,
    })
    await ensure(cloudConnectId, {
      code: 'overage_fee',
      name: 'Overage Fee',
      chargeType: 'usage',
      pricingMethod: 'per_unit',
      pricingTableId: cloudConnectTableId,
      priceColumnKey: 'overage_per_mb',
      quantityAttributeCode: 'bandwidth_mb',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 2,
    })
  }

  await em.flush()
}

export async function seedGixSpecsAndOfferings(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductAttribute, CpqProductCharge } = await import(
    '@dainamite/cpq/modules/cpq/data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const SPEC_OFFERING_MAP = [
    { sku: 'GIX-ACCESS-PORT', specCode: 'SPEC-GIX-ACCESS-PORT', offerCode: 'OFFER-GIX-ACCESS-PORT' },
    { sku: 'GIX-INTERNET-PEERING', specCode: 'SPEC-GIX-INTERNET-PEERING', offerCode: 'OFFER-GIX-INTERNET-PEERING' },
    { sku: 'GIX-MOBILE-PEERING', specCode: 'SPEC-GIX-MOBILE-PEERING', offerCode: 'OFFER-GIX-MOBILE-PEERING' },
    { sku: 'GIX-CLOUD-CONNECT', specCode: 'SPEC-GIX-CLOUD-CONNECT', offerCode: 'OFFER-GIX-CLOUD-CONNECT' },
  ]

  for (const entry of SPEC_OFFERING_MAP) {
    const product = await em.findOne(CatalogProduct, { ...scope, sku: entry.sku, deletedAt: null })
    if (!product) continue

    let spec = await em.findOne(CpqProductSpecification, { ...scope, code: entry.specCode })
    if (!spec) {
      spec = em.create(CpqProductSpecification, {
        ...scope,
        productId: product.id,
        code: entry.specCode,
        name: `${product.title} Specification`,
        description: product.description ?? null,
        lifecycleStatus: 'active',
        version: 1,
      })
      em.persist(spec)
      await em.flush()
    }

    let offering = await em.findOne(CpqProductOffering, { ...scope, code: entry.offerCode })
    if (!offering) {
      offering = em.create(CpqProductOffering, {
        ...scope,
        specId: spec.id,
        code: entry.offerCode,
        name: `${product.title} Standard Offering`,
        description: `Standard offering for ${product.title}`,
        lifecycleStatus: 'active',
      })
      em.persist(offering)
      await em.flush()
    }

    const attrs = await em.find(CpqProductAttribute, { ...scope, productId: product.id, specId: null })
    for (const attr of attrs) {
      attr.specId = spec.id
    }

    const charges = await em.find(CpqProductCharge, { ...scope, productId: product.id, offeringId: null })
    for (const charge of charges) {
      charge.offeringId = offering.id
    }
  }
  await em.flush()
}

export async function seedGixPriceRules(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqPriceRule, CpqProductOffering } = await import('@dainamite/cpq/modules/cpq/data/entities')

  const offeringId = async (code: string): Promise<string | undefined> => {
    const o = await em.findOne(CpqProductOffering, { ...scope, code, deletedAt: null })
    return o?.id
  }

  const ensure = async (data: {
    code: string
    name: string
    description?: string
    productOfferingId?: string | null
    ruleType: string
    value: string
    chargeTypeFilter?: string | null
    chargeCodeFilter?: string | null
    applicabilityCondition?: Record<string, unknown> | null
    sortOrder: number
    isActive?: boolean
  }) => {
    const exists = await em.findOne(CpqPriceRule, { ...scope, code: data.code })
    if (!exists) {
      em.persist(em.create(CpqPriceRule, { ...scope, ...data }))
    }
  }

  await ensure({
    code: 'early-adopter-nrc-waiver',
    name: 'Early Adopter — NRC Waiver',
    description: 'Waive all setup fees for early-adopter customers',
    ruleType: 'discount_percent',
    value: '100',
    chargeTypeFilter: 'nrc',
    sortOrder: 10,
    isActive: false,
  })

  await ensure({
    code: 'volume-mrc-10pct',
    name: 'Volume Discount — 10% MRC',
    description: 'Standard 10% recurring discount for volume commitments',
    ruleType: 'discount_percent',
    value: '10',
    chargeTypeFilter: 'mrc',
    sortOrder: 20,
    isActive: true,
  })

  await ensure({
    code: 'setup-fee-cap-200',
    name: 'Setup Fee Cap at $200',
    description: 'Override any setup fee above $200 to a flat $200',
    ruleType: 'price_override',
    value: '200',
    chargeCodeFilter: 'setup_fee',
    sortOrder: 5,
    isActive: false,
  })

  await ensure({
    code: 'premium-100g-surcharge',
    name: '100G Port Premium Surcharge',
    description: '$50 surcharge on monthly port fee for 100G ports',
    ruleType: 'surcharge_absolute',
    value: '50',
    chargeCodeFilter: 'monthly_port_fee',
    applicabilityCondition: { attribute: 'port_size', operator: 'eq', value: '100G' },
    sortOrder: 30,
    isActive: true,
  })

  await ensure({
    code: 'cloud-connect-5pct-off',
    name: 'Cloud Connect Promo — 5% Off',
    description: '5% discount on all Cloud Connect charges',
    ruleType: 'discount_percent',
    value: '5',
    chargeCodeFilter: null,
    chargeTypeFilter: null,
    applicabilityCondition: { attribute: 'cloud_provider', operator: 'neq', value: '' },
    sortOrder: 40,
    isActive: true,
  })

  const accessPortOfferingId = await offeringId('OFFER-GIX-ACCESS-PORT')
  if (accessPortOfferingId) {
    await ensure({
      code: 'access-port-nrc-15pct-off',
      name: 'Access Port — 15% Setup Discount',
      description: '15% discount on Access Port setup fees only',
      productOfferingId: accessPortOfferingId,
      ruleType: 'discount_percent',
      value: '15',
      chargeCodeFilter: 'setup_fee',
      sortOrder: 15,
      isActive: true,
    })
  }

  const internetPeeringOfferingId = await offeringId('OFFER-GIX-INTERNET-PEERING')
  if (internetPeeringOfferingId) {
    await ensure({
      code: 'internet-peering-bandwidth-surcharge',
      name: 'Internet Peering — Bandwidth Surcharge',
      description: '$25 flat surcharge on Internet Peering bandwidth fee',
      productOfferingId: internetPeeringOfferingId,
      ruleType: 'surcharge_absolute',
      value: '25',
      chargeCodeFilter: 'bandwidth_fee',
      sortOrder: 35,
      isActive: true,
    })
  }

  const cloudConnectOfferingId = await offeringId('OFFER-GIX-CLOUD-CONNECT')
  if (cloudConnectOfferingId) {
    await ensure({
      code: 'cloud-connect-commit-override',
      name: 'Cloud Connect — Committed Rate Override',
      description: 'Override committed bandwidth rate to $0.40/MB for promotional period',
      productOfferingId: cloudConnectOfferingId,
      ruleType: 'price_override',
      value: '0.40',
      chargeCodeFilter: 'commit_bandwidth_fee',
      applicabilityCondition: { attribute: 'pricing_model', operator: 'eq', value: 'burstable' },
      sortOrder: 25,
      isActive: false,
    })
  }

  await em.flush()
}

export async function seedGixBundleData(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductCharge, CpqBundleSlot, CpqOfferingComponent } = await import(
    '@dainamite/cpq/modules/cpq/data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const bundleProduct = await em.findOne(CatalogProduct, { ...scope, sku: 'GIX-CONNECTIVITY-BUNDLE', deletedAt: null })
  if (!bundleProduct) return

  let bundleSpec = await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-CONNECTIVITY-BUNDLE' })
  if (!bundleSpec) {
    bundleSpec = em.create(CpqProductSpecification, {
      ...scope,
      productId: bundleProduct.id,
      code: 'SPEC-GIX-CONNECTIVITY-BUNDLE',
      name: 'GIX Connectivity Bundle Specification',
      description: 'Bundle specification: Access Port + peering/cloud services',
      specType: 'bundle',
      lifecycleStatus: 'active',
      version: 1,
    })
    em.persist(bundleSpec)
    await em.flush()
  }

  const childSpecs = {
    accessPort: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-ACCESS-PORT' }),
    internetPeering: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-INTERNET-PEERING' }),
    mobilePeering: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-MOBILE-PEERING' }),
    cloudConnect: await em.findOne(CpqProductSpecification, { ...scope, code: 'SPEC-GIX-CLOUD-CONNECT' }),
  }
  if (!childSpecs.accessPort || !childSpecs.internetPeering || !childSpecs.mobilePeering || !childSpecs.cloudConnect) {
    console.warn('[demo_gix seed] Missing child specs for bundle — skipping')
    return
  }

  const slotDefs = [
    { key: 'access', targetSpecId: childSpecs.accessPort.id, name: 'Access Port', min: 1, max: 1, sort: 0 },
    { key: 'peering-ip', targetSpecId: childSpecs.internetPeering.id, name: 'Internet Peering', min: 0, max: 1, sort: 1 },
    { key: 'peering-mp', targetSpecId: childSpecs.mobilePeering.id, name: 'Mobile Peering', min: 0, max: 1, sort: 2 },
    { key: 'cloud', targetSpecId: childSpecs.cloudConnect.id, name: 'Cloud Connect', min: 0, max: 2, sort: 3 },
  ]
  const slots = new Map<string, InstanceType<typeof CpqBundleSlot>>()
  for (const sd of slotDefs) {
    let slot = await em.findOne(CpqBundleSlot, { ...scope, specId: bundleSpec.id, targetSpecId: sd.targetSpecId })
    if (!slot) {
      slot = em.create(CpqBundleSlot, {
        ...scope, specId: bundleSpec.id, targetSpecId: sd.targetSpecId,
        componentGroup: sd.key.split('-')[0], name: sd.name,
        cardinalityMin: sd.min, cardinalityMax: sd.max, sortOrder: sd.sort,
      })
      em.persist(slot)
    }
    slots.set(sd.key, slot)
  }
  await em.flush()

  let bundleOffering = await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-CONNECTIVITY-BUNDLE' })
  if (!bundleOffering) {
    bundleOffering = em.create(CpqProductOffering, {
      ...scope, specId: bundleSpec.id,
      code: 'OFFER-GIX-CONNECTIVITY-BUNDLE',
      name: 'GIX Connectivity Bundle — Standard',
      description: 'All-in-one connectivity package with Access Port, peering, and cloud services',
      offeringType: 'bundle', lifecycleStatus: 'active',
    })
    em.persist(bundleOffering)
    await em.flush()
  }

  // Bundle-level charges (discounts are handled via Price Rules, not negative charges)
  const bundleChargeDefs = [
    {
      code: 'bundle_setup_fee', name: 'Bundle Setup Fee',
      chargeType: 'nrc', pricingMethod: 'fixed', fixedPrice: '150', currencyCode: 'USD', sortOrder: 0,
    },
    {
      code: 'bundle_monthly_fee', name: 'Bundle Monthly Platform Fee',
      chargeType: 'mrc', pricingMethod: 'fixed', fixedPrice: '49.99', currencyCode: 'USD', sortOrder: 1,
    },
  ]
  for (const ch of bundleChargeDefs) {
    const exists = await em.findOne(CpqProductCharge, { ...scope, productId: bundleProduct.id, code: ch.code })
    if (!exists) {
      em.persist(em.create(CpqProductCharge, {
        ...scope, productId: bundleProduct.id, offeringId: bundleOffering.id, ...ch,
      }))
    }
  }
  await em.flush()

  const childOfferings = {
    accessPort: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-ACCESS-PORT' }),
    internetPeering: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-INTERNET-PEERING' }),
    mobilePeering: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-MOBILE-PEERING' }),
    cloudConnect: await em.findOne(CpqProductOffering, { ...scope, code: 'OFFER-GIX-CLOUD-CONNECT' }),
  }
  if (!childOfferings.accessPort || !childOfferings.internetPeering || !childOfferings.mobilePeering || !childOfferings.cloudConnect) return

  const compDefs = [
    { slotKey: 'access', child: childOfferings.accessPort, isDefault: true, sort: 0 },
    { slotKey: 'peering-ip', child: childOfferings.internetPeering, isDefault: true, sort: 1 },
    { slotKey: 'peering-mp', child: childOfferings.mobilePeering, isDefault: false, sort: 2 },
    { slotKey: 'cloud', child: childOfferings.cloudConnect, isDefault: false, sort: 3 },
  ]
  for (const cd of compDefs) {
    const slot = slots.get(cd.slotKey)
    if (!slot) continue
    const exists = await em.findOne(CpqOfferingComponent, { ...scope, offeringId: bundleOffering.id, childOfferingId: cd.child.id })
    if (!exists) {
      em.persist(em.create(CpqOfferingComponent, {
        ...scope, offeringId: bundleOffering.id, slotId: slot.id,
        childOfferingId: cd.child.id, isDefault: cd.isDefault, sortOrder: cd.sort,
      }))
    }
  }
  await em.flush()
  console.log('    Bundle seed complete: GIX Connectivity Bundle (4 slots, 4 components, 2 charges)')
}
