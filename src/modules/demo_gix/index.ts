// Side-effect import: registers the GIX use case with the CPQ seed registry
// at module load time, before any orchestrator (`demo_tenants`) iterates it.
import './setup'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'demo_gix',
  title: 'Demo — GIX Network Services',
  version: '0.1.0',
  description:
    'Customer-specific demo seed bundle for the GIX (Global Internet eXchange) vertical. Registers a CPQ use case that seeds products, pricing, rules, and bundles into a dedicated tenant.',
  author: 'Dainamite',
  license: 'Proprietary',
  // Depends on cpq for the use-case registry API and on demo_tenants for orchestration.
  // demo_tenants is the runtime orchestrator and runs AFTER this module's import-time
  // registration call.
  requires: ['cpq'],
}
