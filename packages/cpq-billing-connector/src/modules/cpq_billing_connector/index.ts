import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'cpq_billing_connector',
  title: 'CPQ → Billing Connector',
  version: '0.1.0',
  description:
    'Wires @dainamite/cpq subscription lifecycle events to @dainamite/billing API calls. ' +
    'Owns proration math (CPQ stays neutral on billing calendar semantics).',
  author: 'Dainamite',
  license: 'MIT',
  // `requires` lists every module whose data we read (directly or via
  // command-bus calls). The connector itself stores no entities — it's
  // pure plumbing — but it does call billing's command bus + needs CPQ
  // events to fire.
  requires: ['cpq', 'billing', 'auth', 'directory'],
  ejectable: false,
}

export { features } from './acl'
