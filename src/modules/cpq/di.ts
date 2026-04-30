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
import { DefaultCpqBundleService } from './services/cpqBundleService'

/**
 * Resolve dependencies from the container closure rather than via destructured
 * factory parameters.  The container uses InjectionMode.CLASSIC, and Turbopack
 * transpiles destructured arrow functions in a way that breaks Awilix's
 * parameter-name parser.  Core modules are unaffected because they ship
 * pre-compiled in node_modules.
 */
export function register(container: AppContainer) {
  container.register({
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
