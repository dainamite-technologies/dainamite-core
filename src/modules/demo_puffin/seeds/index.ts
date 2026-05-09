import type { CpqUseCaseSeedContext } from '@dainamite/cpq/modules/cpq/lib/seeds/api'
import { seedPuffinAttributes } from './seeders/attributes'
import { seedPuffinBundles } from './seeders/bundles'
import { seedPuffinCharges } from './seeders/charges'
import { seedPuffinPriceRules } from './seeders/price-rules'
import { seedPuffinPricingTables } from './seeders/pricing-tables'
import { seedPuffinProducts } from './seeders/products'
import { seedPuffinSpecsLinkage } from './seeders/specs-linkage'
import { seedPuffinWizards } from './seeders/wizards'
import { seedPuffinExamplesImpl } from './seeders/examples'

export async function seedPuffinDefaults(ctx: CpqUseCaseSeedContext): Promise<void> {
  const { em } = ctx
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  await seedPuffinProducts(em, scope)
  await em.flush()
  await seedPuffinPricingTables(em, scope)
  await seedPuffinAttributes(em, scope)
  await seedPuffinCharges(em, scope)
  await seedPuffinSpecsLinkage(em, scope)
  await seedPuffinPriceRules(em, scope)
  await seedPuffinBundles(em, scope)
  await seedPuffinWizards(em, scope)
}

export async function seedPuffinExamples(ctx: CpqUseCaseSeedContext): Promise<void> {
  if (!ctx.withExamples) return
  await seedPuffinExamplesImpl(ctx.em, ctx.container, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
}
