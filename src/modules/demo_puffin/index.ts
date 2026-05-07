// Side-effect import: registers the Puffin Cloud use case with the CPQ
// seed registry at module load time.
import './setup'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'demo_puffin',
  title: 'Demo — Puffin Cloud',
  version: '0.1.0',
  description:
    'Customer-specific demo seed bundle for the Puffin Cloud (cloud-services-provider) use case. Implements the XD-275 catalog: VPS, Compute, storage, CDN, Managed DB, Workspace, DDoS, Premium Support, and three use-case bundles.',
  author: 'Dainamite',
  license: 'Proprietary',
  requires: ['cpq'],
}
