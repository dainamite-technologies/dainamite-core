import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'cpq',
  title: 'Configure, Price, Quote',
  version: '0.1.0',
  description:
    'Generic CPQ engine — configurable product attributes, multi-charge pricing tables, and guided quoting flows.',
  author: 'App',
  license: 'Proprietary',
  requires: ['auth', 'directory', 'catalog', 'sales', 'customers', 'dictionaries'],
  ejectable: false,
}

export { features } from './acl'
