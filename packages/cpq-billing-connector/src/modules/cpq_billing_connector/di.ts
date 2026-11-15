import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CpqBillingOrderSetupService } from './services/orderSetupService'

/**
 * `cpqBillingOrderSetupService` — the order billing setup (account choice,
 * new-account overrides, per-line bill start). It resolves CPQ's
 * `cpqOrderService` lazily from the same container at call time, so the
 * registration order of CPQ and the connector does not matter here.
 */
export function register(container: AppContainer): void {
  container.register({
    cpqBillingOrderSetupService: asFunction(
      () =>
        new CpqBillingOrderSetupService({
          em: container.resolve('em') as EntityManager,
          container,
        }),
    ).scoped(),
  })
}
