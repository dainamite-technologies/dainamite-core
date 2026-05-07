import type { EntityManager } from '@mikro-orm/postgresql'
import { ALL_PRODUCTS } from '../data/products'
import type { SeedScope } from './_types'

/**
 * After seeders/products.ts has created Specifications and Offerings, attach
 * orphan attributes (specId=null) and charges (offeringId=null) to the
 * canonical spec/offering for their product. This mirrors the GIX flow but
 * is generally a no-op for Puffin because we already attach charges to
 * offerings directly in seeders/charges.ts; left in for symmetry and
 * future-proofing.
 */
export async function seedPuffinSpecsLinkage(em: EntityManager, scope: SeedScope): Promise<void> {
  const { CpqProductSpecification, CpqProductOffering, CpqProductAttribute, CpqProductCharge } = await import(
    '../../../cpq/data/entities'
  )
  const { CatalogProduct } = await import('@open-mercato/core/modules/catalog/data/entities')

  for (const def of ALL_PRODUCTS) {
    const product = await em.findOne(CatalogProduct, { ...scope, sku: def.sku, deletedAt: null })
    if (!product) continue
    const spec = await em.findOne(CpqProductSpecification, { ...scope, code: def.specCode })
    if (!spec) continue

    // Default offering for orphan-charge linking — pick the first offering
    // when there's only one (covers attribute-driven products).
    const firstOffering =
      def.offerings.length === 1
        ? await em.findOne(CpqProductOffering, { ...scope, code: def.offerings[0].code, deletedAt: null })
        : null

    const orphanAttrs = await em.find(CpqProductAttribute, { ...scope, productId: product.id, specId: null })
    for (const attr of orphanAttrs) {
      attr.specId = spec.id
    }

    if (firstOffering) {
      const orphanCharges = await em.find(CpqProductCharge, { ...scope, productId: product.id, offeringId: null })
      for (const charge of orphanCharges) {
        charge.offeringId = firstOffering.id
      }
    }
  }
  await em.flush()
}
