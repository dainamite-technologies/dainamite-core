import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

// Side-effect import — registers every CRUD command in the global
// command bus at module load time. The makeCrudRoute factory looks up
// `actions.<verb>.commandId` against this registry at request time, so
// without this import every billing write returns "command not found".
// Pattern mirrors `@open-mercato/core/src/modules/customers/index.ts`.
import './commands'

export const metadata: ModuleInfo = {
  name: 'billing',
  title: 'Billing',
  version: '0.1.0',
  description:
    'Lightweight recurring-billing engine — collects one-time / recurring / usage items, runs Bill Runs, produces draft invoices in core/sales.',
  author: 'Dainamite',
  license: 'MIT',
  requires: ['auth', 'directory', 'dictionaries', 'configs', 'sales'],
  ejectable: false,
}

export { features } from './acl'
