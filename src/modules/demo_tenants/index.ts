import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'demo_tenants',
  title: 'Demo Tenants Orchestrator',
  version: '0.1.0',
  description:
    'Walks the CPQ use-case registry and provisions a dedicated tenant per use case during `mercato init`. See XD-276.',
  author: 'Dainamite',
  license: 'Proprietary',
  // Must run AFTER cpq (registry API) and AFTER any demo_<x> module that
  // calls registerCpqUseCase at import time. The runtime side of the
  // orchestrator runs in seedExamples, which is invoked after every
  // module's import and seedDefaults completes.
  requires: ['cpq'],
}
