import type { EntityManager } from '@mikro-orm/postgresql'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'
import { COST_PLUS_TOGGLE } from '../../data/costs'
import { QuotingError } from '../cpqQuotingService'

/**
 * Whether the engine can price `cost_plus` charges. Until the cost-plus price
 * step ships (feature spec Implementation Plan step 9) saving a cost-plus
 * charge is refused, so no unpriceable charge can exist.
 */
export const COST_PLUS_PRICING_AVAILABLE = false

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

  /**
   * Gate for writing a charge as `cost_plus` (or changing its markup):
   * `422 COST_PLUS_DISABLED` with the toggle off (R14), then
   * `422 COST_PLUS_NOT_AVAILABLE` until the engine can price it.
   */
  async assertCostPlusChargeWritable(tenantId: string): Promise<void> {
    if (!(await this.enabled(tenantId))) throw new QuotingError(422, 'COST_PLUS_DISABLED')
    if (!COST_PLUS_PRICING_AVAILABLE) throw new QuotingError(422, 'COST_PLUS_NOT_AVAILABLE')
  }
}
