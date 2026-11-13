import type { CpqUseCaseSeedContext } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { seedGixExamples as seedGixExamplesImpl } from './examples'
import { seedGixPriceAdjustmentExample } from './price-adjustment-examples'
import { seedCpqArcExamples } from './arc-examples'
import { seedGixCostPlusCatalog, seedGixCostPlusExamples } from './cost-plus-examples'
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
 *   (which links charges to offerings) → price rules → bundles → wizards → cost-plus catalog.
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
  // Cost-plus: tenant toggle ON, cross-connect cost table, IP Transit offering (idempotent).
  await seedGixCostPlusCatalog(em, ctx.container, scope)
}

/**
 * Seed GIX demo customers and quotes into the given tenant scope.
 * Skipped automatically when ctx.withExamples is false.
 */
export async function seedGixExamples(ctx: CpqUseCaseSeedContext): Promise<void> {
  if (!ctx.withExamples) return
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await seedGixExamplesImpl(ctx.em, ctx.container, scope)
  // Negotiated-price demo quote (manual price adjustments); idempotent on its own marker.
  await seedGixPriceAdjustmentExample(ctx.em, ctx.container, scope)
  // XD-250 ARC: extra demo customer ("Meridian Connectivity Sp. z o.o.") with
  // a portfolio of subscriptions covering every ARC operator scenario
  // (amend / renew / cancel / multi-target / merge / suspended).
  // Idempotent + self-contained — items use generic name-only inputs so
  // they don't depend on the GIX product catalog.
  await seedCpqArcExamples(ctx.em, ctx.container, scope)
  // Cost-plus demo quotes in the pending / estimated / confirmed / expired cost states.
  await seedGixCostPlusExamples(ctx.em, ctx.container, scope)
}
