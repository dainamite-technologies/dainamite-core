import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'demo_acme',
  title: 'Demo — ACME (primary tenant)',
  version: '0.1.0',
  description:
    'App-only example data for the primary ACME tenant: CPQ catalog, quotes, an activated order and subscription, billing settings, postpaid and prepaid billing accounts, bill runs, invoices, a payment import and prepaid statements.',
  author: 'Dainamite',
  license: 'Proprietary',
  requires: ['customers', 'catalog', 'cpq', 'billing', 'cpq_billing_connector'],
}
