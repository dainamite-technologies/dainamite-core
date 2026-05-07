import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProductDef } from '../data/products'
import { ALL_PRODUCTS } from '../data/products'
import type { SeedScope } from './_types'

/**
 * Seed CatalogProduct + CpqProductSpecification + CpqProductOffering rows
 * for the Puffin Cloud catalog. Idempotent.
 *
 * For each product:
 *   1. Ensure a CatalogProduct row by SKU.
 *   2. Ensure a CpqProductSpecification (`spec_type` defaults to 'simple';
 *      bundles use 'bundle').
 *   3. Ensure each declared offering with its designTimeValues stored in
 *      `metadata.designTimeValues` and `metadata.listedInCalculator: true`
 *      so the public calculator (XD-275 phase 5) picks them up.
 */
export async function seedPuffinProducts(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')
  const { CpqProductSpecification, CpqProductOffering } = await import('../../../cpq/data/entities')

  for (const def of ALL_PRODUCTS) {
    let product = await em.findOne(CatalogProduct, { ...scope, sku: def.sku, deletedAt: null })
    if (!product) {
      product = em.create(CatalogProduct, {
        ...scope,
        title: def.title,
        sku: def.sku,
        handle: def.sku.toLowerCase(),
        productType: def.specType === 'bundle' ? 'bundle' : 'configurable',
        description: def.description,
        isConfigurable: true,
        isActive: true,
      })
      em.persist(product)
      await em.flush()
    }

    let spec = await em.findOne(CpqProductSpecification, { ...scope, code: def.specCode })
    if (!spec) {
      spec = em.create(CpqProductSpecification, {
        ...scope,
        productId: product.id,
        code: def.specCode,
        name: `${def.title} Specification`,
        description: def.description,
        specType: def.specType ?? 'simple',
        lifecycleStatus: 'active',
        version: 1,
      })
      em.persist(spec)
      await em.flush()
    }

    for (const offer of def.offerings) {
      const existing = await em.findOne(CpqProductOffering, { ...scope, code: offer.code })
      if (existing) continue

      const metadata: Record<string, unknown> = {
        listedInCalculator: offer.listedInCalculator ?? true,
      }
      if (offer.designTimeValues) {
        metadata.designTimeValues = offer.designTimeValues
      }

      em.persist(
        em.create(CpqProductOffering, {
          ...scope,
          specId: spec.id,
          code: offer.code,
          name: offer.name,
          description: offer.description,
          offeringType: def.specType === 'bundle' ? 'bundle' : 'simple',
          lifecycleStatus: 'active',
          metadata,
        }),
      )
    }
    await em.flush()
  }
}

export type { ProductDef }
