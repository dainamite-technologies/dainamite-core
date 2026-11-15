import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'cpq_billing_connector',
  title: 'CPQ → Billing Connector',
  version: '0.1.0',
  description:
    'Wires @dainamite/cpq subscription lifecycle events to @dainamite/billing API calls. ' +
    'Owns proration math (CPQ stays neutral on billing calendar semantics) and the ' +
    'order billing setup (account choice, new-account overrides, per-line bill start).',
  author: 'Dainamite',
  license: 'MIT',
  // `requires` lists every module whose data we read (directly or via
  // command-bus calls). The connector's only own entity is the order
  // billing setup; everything else is plumbing between CPQ events and
  // billing's command bus.
  requires: ['cpq', 'billing', 'auth', 'directory'],
  ejectable: false,
}

export { features } from './acl'
