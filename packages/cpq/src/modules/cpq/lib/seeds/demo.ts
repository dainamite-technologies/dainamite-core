import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Minimal, self-contained CPQ test-data seed.
 *
 * Creates one neutral catalog product with a Specification, an Offering, and
 * a fixed monthly charge — enough to exercise the CPQ admin (Product
 * Specifications / Offerings lists) and quoting locally. Idempotent: every
 * row is matched by a stable `DEMO-CPQ-*` code / sku, so re-running is a
 * no-op rather than a duplicate.
 *
 * Intentionally generic (NOT customer-specific) so it ships with
 * `@dainamite/cpq`. Rich, vertical demo catalogs live in the `demo_<x>`
 * app modules + `mercato demo_tenants seed`.
 */

export type CpqDemoScope = { tenantId: string; organizationId: string }
export type CpqDemoResult = {
  productsCreated: number
  specsCreated: number
  offeringsCreated: number
  chargesCreated: number
}

const PRODUCT_SKU = 'DEMO-CPQ-CLOUD'
const SPEC_CODE = 'DEMO-CPQ-CLOUD-SPEC'
const OFFERING_CODE = 'DEMO-CPQ-CLOUD-OFFER'
const CHARGE_CODE = 'DEMO-CPQ-CLOUD-MRC'

export async function resetCpqDemo(em: EntityManager, scope: CpqDemoScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductCharge } = await import(
    '../../data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
  // Leaves first, roots last.
  await em.nativeDelete(CpqProductCharge, { ...scope, code: CHARGE_CODE } as never)
  await em.nativeDelete(CpqProductOffering, { ...scope, code: OFFERING_CODE } as never)
  await em.nativeDelete(CpqProductSpecification, { ...scope, code: SPEC_CODE } as never)
  await em.nativeDelete(CatalogProduct, { ...scope, sku: PRODUCT_SKU } as never)
}

export async function seedCpqDemo(
  em: EntityManager,
  scope: CpqDemoScope,
  options: { reset?: boolean } = {},
): Promise<CpqDemoResult> {
  if (options.reset) await resetCpqDemo(em, scope)

  const { CpqProductSpecification, CpqProductOffering, CpqProductCharge } = await import(
    '../../data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  const result: CpqDemoResult = {
    productsCreated: 0,
    specsCreated: 0,
    offeringsCreated: 0,
    chargesCreated: 0,
  }

  // ── Catalog product (idempotent by sku) ──
  let product = await em.findOne(CatalogProduct, { ...scope, sku: PRODUCT_SKU, deletedAt: null } as never)
  if (!product) {
    product = em.create(CatalogProduct, {
      ...scope,
      title: 'Demo Cloud Plan',
      sku: PRODUCT_SKU,
      handle: PRODUCT_SKU.toLowerCase(),
      productType: 'configurable',
      description: 'Generic CPQ demo product seeded by `mercato cpq seed`.',
      isConfigurable: true,
      isActive: true,
    })
    em.persist(product)
    await em.flush()
    result.productsCreated += 1
  }

  // ── Specification (idempotent by code) ──
  let spec = await em.findOne(CpqProductSpecification, { ...scope, code: SPEC_CODE, deletedAt: null } as never)
  if (!spec) {
    spec = em.create(CpqProductSpecification, {
      ...scope,
      productId: product.id,
      code: SPEC_CODE,
      name: 'Demo Cloud Specification',
      specType: 'simple',
      lifecycleStatus: 'active',
      isActive: true,
    })
    em.persist(spec)
    await em.flush()
    result.specsCreated += 1
  }

  // ── Offering (idempotent by code) ──
  let offering = await em.findOne(CpqProductOffering, { ...scope, code: OFFERING_CODE, deletedAt: null } as never)
  if (!offering) {
    offering = em.create(CpqProductOffering, {
      ...scope,
      specId: spec.id,
      code: OFFERING_CODE,
      name: 'Demo Cloud Offering',
      offeringType: 'simple',
      designTimeValues: {},
      lifecycleStatus: 'active',
      isActive: true,
    })
    em.persist(offering)
    await em.flush()
    result.offeringsCreated += 1
  }

  // ── Charge (idempotent by offering + code, matching the DB unique
  //    constraint `(org, tenant, offering_id, code)`) — fixed monthly fee ──
  const charge = await em.findOne(CpqProductCharge, {
    ...scope,
    offeringId: offering.id,
    code: CHARGE_CODE,
    deletedAt: null,
  } as never)
  if (!charge) {
    em.persist(
      em.create(CpqProductCharge, {
        ...scope,
        productId: product.id,
        offeringId: offering.id,
        code: CHARGE_CODE,
        name: 'Monthly platform fee',
        chargeType: 'mrc',
        chargeModel: 'flat',
        pricingMethod: 'fixed',
        fixedPrice: '99.0000',
        currencyCode: 'PLN',
        sortOrder: 0,
        isActive: true,
      }),
    )
    result.chargesCreated += 1
  }

  await em.flush()
  return result
}
