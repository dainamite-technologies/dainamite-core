import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import { DefaultCpqPricingService } from './services/cpqPricingService'
import { DefaultCpqValidationService } from './services/cpqValidationService'
import { DefaultCpqProductService } from './services/cpqProductService'
import { DefaultCpqQuotingService } from './services/cpqQuotingService'
import { DefaultCpqWizardService } from './services/cpqWizardService'
import { DefaultCpqInventoryService } from './services/cpqInventoryService'
import { DefaultCpqOrderService } from './services/cpqOrderService'
import { CpqAdjustmentService } from './services/priceAdjustments/adjustmentService'
import { DefaultCpqBundleService } from './services/cpqBundleService'
import { CpqCostService } from './services/costs/costService'
import { CpqQuoteCostService } from './services/costs/quoteCostService'
import { CpqCostSourcingService } from './services/costs/costSourcingService'
import { CpqCostRequestQueueService } from './services/costs/costRequestQueue'
import { createSourcingPublisher } from './services/costs/sourcingPublisher'
import { CpqFxRateResolver, type FxExchangeRateService } from './services/costs/fxRateResolver'

/**
 * Resolve dependencies from the container closure rather than via destructured
 * factory parameters.  The container uses InjectionMode.CLASSIC, and Turbopack
 * transpiles destructured arrow functions in a way that breaks Awilix's
 * parameter-name parser.  Core modules are unaffected because they ship
 * pre-compiled in node_modules.
 */
export function register(container: AppContainer) {
  // Publishes the sourcing signals of every committed quote write as the non-broadcast cost_* events (step 12). One
  // instance per scope; every producer (sourcing, quote costs, adjustments, quoting, orders) receives the same one.
  const sourcingPublisher = () => createSourcingPublisher({ em: container.resolve('em') })
  container.register({
    // Dated FX rates (FX spec Q7): `exchangeRateService` belongs to the optional `currencies` module, so it is resolved only
    // when registered; without it the resolver is "unavailable" and foreign costs stay CURRENCY_NO_RATE. One instance per
    // scope, so its memo lives for one request / write.
    cpqFxRateResolver: asFunction(() => new CpqFxRateResolver({
      exchangeRateService: container.hasRegistration('exchangeRateService')
        ? container.resolve('exchangeRateService') as FxExchangeRateService
        : null,
      featureTogglesService: container.resolve('featureTogglesService'),
    })).scoped(),
    cpqAdjustmentService: asFunction(() => new CpqAdjustmentService({
      em: container.resolve('em'),
      quotingService: container.resolve('cpqQuotingService'),
      featureTogglesService: container.resolve('featureTogglesService'),
      costService: container.resolve('cpqCostService'),
      sourcingPublisher: sourcingPublisher(),
    })).scoped(),
    cpqCostService: asFunction(() => new CpqCostService({
      em: container.resolve('em'),
      featureTogglesService: container.resolve('featureTogglesService'),
      fxRateResolver: container.resolve('cpqFxRateResolver'),
      // Resolved lazily: the sourcing service depends on the cost service (toggle check).
      onElementsDeactivated: (elementIds: string[], scope: { organizationId: string; tenantId: string }) =>
        (container.resolve('cpqCostSourcingService') as CpqCostSourcingService).cancelRequestsForElements(elementIds, scope),
    })).scoped(),
    cpqQuoteCostService: asFunction(() => new CpqQuoteCostService({
      em: container.resolve('em'),
      costService: container.resolve('cpqCostService'),
      quotingService: container.resolve('cpqQuotingService'),
      publisher: sourcingPublisher(),
      featureTogglesService: container.resolve('featureTogglesService'),
      fxRateResolver: container.resolve('cpqFxRateResolver'),
    })).scoped(),
    cpqCostRequestQueueService: asFunction(() => new CpqCostRequestQueueService({
      em: container.resolve('em'),
      featureTogglesService: container.resolve('featureTogglesService'),
    })).scoped(),
    cpqCostSourcingService: asFunction(() => new CpqCostSourcingService({
      em: container.resolve('em'),
      fxRateResolver: container.resolve('cpqFxRateResolver'),
      costService: container.resolve('cpqCostService'),
      quotingService: container.resolve('cpqQuotingService'),
      publisher: sourcingPublisher(),
    })).scoped(),
    cpqPricingService: asFunction(({ em }: { em: EntityManager }) => {
      return new DefaultCpqPricingService(em)
    }).scoped().proxy(),
    cpqValidationService: asFunction(({ em }: { em: EntityManager }) => {
      return new DefaultCpqValidationService(em)
    }).scoped().proxy(),
    cpqProductService: asFunction(({ em }: { em: EntityManager }) => {
      return new DefaultCpqProductService(em)
    }).scoped().proxy(),
    cpqQuotingService: asFunction(({
      em,
      cpqPricingService,
      cpqValidationService,
      cpqProductService,
      salesDocumentNumberGenerator,
    }: {
      em: EntityManager
      cpqPricingService: DefaultCpqPricingService
      cpqValidationService: DefaultCpqValidationService
      cpqProductService: DefaultCpqProductService
      salesDocumentNumberGenerator: SalesDocumentNumberGenerator
    }) => {
      return new DefaultCpqQuotingService({
        em: container.resolve('em'),
        cpqPricingService: container.resolve('cpqPricingService'),
        cpqValidationService: container.resolve('cpqValidationService'),
        cpqProductService: container.resolve('cpqProductService'),
        salesDocumentNumberGenerator: container.resolve('salesDocumentNumberGenerator'),
        cpqCostService: container.resolve('cpqCostService'),
        cpqFxRateResolver: container.resolve('cpqFxRateResolver'),
        sourcingPublisher: sourcingPublisher(),
      })
    }).scoped().proxy(),
    cpqInventoryService: asFunction(() => {
      return new DefaultCpqInventoryService(container.resolve('em'))
    }).scoped(),
    cpqOrderService: asFunction(() => {
      return new DefaultCpqOrderService({
        em: container.resolve('em'),
        cpqInventoryService: container.resolve('cpqInventoryService'),
        salesDocumentNumberGenerator: container.resolve('salesDocumentNumberGenerator'),
        cpqCostService: container.resolve('cpqCostService'),
        sourcingPublisher: sourcingPublisher(),
      })
    }).scoped(),
    cpqWizardService: asFunction(({ em }: { em: EntityManager }) => {
      return new DefaultCpqWizardService(em)
    }).scoped().proxy(),
    cpqBundleService: asFunction(() => {
      return new DefaultCpqBundleService(container.resolve('em'))
    }).scoped(),
  })
}
