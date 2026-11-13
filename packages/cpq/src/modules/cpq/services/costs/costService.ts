import type { EntityManager } from '@mikro-orm/postgresql'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { COST_PLUS_TOGGLE } from '../../data/costs'

type Dependencies = {
  em: EntityManager
  featureTogglesService: Pick<FeatureTogglesService, 'getBoolConfig'>
}

/**
 * Cost-plus catalog and quote-cost operations (App Spec §1.4). Registered in DI
 * as `cpqCostService`.
 */
export class CpqCostService {
  constructor(private readonly deps: Dependencies) {}

  /** Whether `cpq.cost_plus` is on for the tenant (R14). Missing / failing toggles count as off. */
  async enabled(tenantId: string): Promise<boolean> {
    const flag = await this.deps.featureTogglesService.getBoolConfig(COST_PLUS_TOGGLE, tenantId)
    return flag.ok && flag.value === true
  }
}
