import type { CpqUseCaseSeedContext } from '../../cpq/lib/seeds/api'
import { seedGixExamples as seedGixExamplesImpl } from './examples'
import {
  seedGixBundleData,
  seedGixPriceRules,
  seedGixProductAttributes,
  seedGixProductCharges,
  seedGixProducts,
  seedGixPricingTables,
  seedGixSpecsAndOfferings,
} from './seeders'
import { seedGixWizards } from './wizards'

/**
 * Seed the GIX catalog into the given tenant scope. Idempotent.
 *
 * Order matters: products → pricing tables → attributes → charges → specs/offerings
 *   (which links charges to offerings) → price rules → bundles → wizards.
 */
export async function seedGixDefaults(ctx: CpqUseCaseSeedContext): Promise<void> {
  const { em } = ctx
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await seedGixProducts(em, scope)
  await em.flush()
  await seedGixPricingTables(em, scope)
  await seedGixProductAttributes(em, scope)
  await seedGixProductCharges(em, scope)
  await seedGixSpecsAndOfferings(em, scope)
  await seedGixPriceRules(em, scope)
  await seedGixBundleData(em, scope)
  await seedGixWizards(em, scope)
}

/**
 * Seed GIX demo customers and quotes into the given tenant scope.
 * Skipped automatically when ctx.withExamples is false.
 */
export async function seedGixExamples(ctx: CpqUseCaseSeedContext): Promise<void> {
  if (!ctx.withExamples) return
  await seedGixExamplesImpl(ctx.em, ctx.container, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
}
